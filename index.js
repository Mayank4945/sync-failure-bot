require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const { fetchSyncFailures } = require("./services/metabase");
const { postSyncAlert }     = require("./services/slack");
const { resolveTenantId }   = require("./services/tenantMapper");
const { sendToPeriskopeAI, formatSyncFailuresForAI } = require("./services/periskope");

const app = express();

// ── Capture raw body for Slack signature verification ────────────────────────
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf.toString(encoding || 'utf8');
  },
  limit: '10mb'
}));

// ── State: Store latest sync failures by tenant ────────────────────────────────
const syncFailureCache = new Map();

// ── Verify Slack signature ────────────────────────────────────────────────────
function verifySlackSignature(req) {
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
  const slackRequestTimestamp = req.headers["x-slack-request-timestamp"];
  const slackSignature = req.headers["x-slack-signature"];

  if (!slackRequestTimestamp || !slackSignature) {
    console.warn("[slack] Missing signature headers");
    return false;
  }

  // Check timestamp is within 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(slackRequestTimestamp)) > 300) {
    console.warn("[slack] Signature verification failed: timestamp too old");
    return false;
  }

  // Use raw body, not parsed JSON
  const baseString = `v0:${slackRequestTimestamp}:${req.rawBody}`;
  const mySignature = "v0=" + crypto
    .createHmac("sha256", slackSigningSecret)
    .update(baseString)
    .digest("hex");

  // Convert both to buffers for timingSafeEqual
  const mySignatureBuf = Buffer.from(mySignature);
  const slackSignatureBuf = Buffer.from(slackSignature);

  try {
    const isValid = crypto.timingSafeEqual(mySignatureBuf, slackSignatureBuf);
    if (!isValid) {
      console.warn("[slack] Signature mismatch");
    }
    return isValid;
  } catch (err) {
    console.warn("[slack] Signature comparison failed:", err.message);
    return false;
  }
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── Periskope webhook ─────────────────────────────────────────────────────────
// No classifier needed — Periskope rule already filters sync failure messages
// before firing this webhook. Whatever arrives here IS a sync issue.
//
// Payload shape (confirmed from webhook.site):
// {
//   "event_type": "message.created",
//   "data": {
//     "body":    "Sync Fail",
//     "chat_id": "918076427750@c.us",
//   }
// }
app.post("/webhook/periskope", async (req, res) => {
  res.sendStatus(200); // acknowledge immediately

  if (req.body.event_type !== "message.created") return;

  const msg = req.body.data;
  if (!msg) return;

  const text   = msg.body    || "";
  const chatId = msg.chat_id || "";

  if (!text && !chatId) return;

  console.log(`[webhook] Received — chat_id: ${chatId} | "${text.slice(0, 80)}"`);

  try {
    await handleMessage({ chatId, text });
  } catch (err) {
    console.error("[webhook] Pipeline error:", err.message);
  }
});

// ── Pipeline ──────────────────────────────────────────────────────────────────
async function handleMessage({ chatId, text }) {
  // Step 1: Resolve tenant from chat_id
  const tenantId = resolveTenantId(chatId);
  if (!tenantId) {
    console.error(`[1/3] Could not resolve tenant for chat_id: ${chatId}`);
    console.error(`[1/3] Add this chat_id to CHAT_TENANT_MAP in services/tenantMapper.js`);
    return;
  }
  console.log(`[1/3] Tenant: ${tenantId}`);

  // Step 2: Fetch sync failures from Metabase
  console.log(`[2/3] Querying Metabase for ${tenantId}...`);
  let rows;
  try {
    rows = await fetchSyncFailures(tenantId);
  } catch (err) {
    console.error("[2/3] Metabase error:", err.message);
    return;
  }

  if (!rows || rows.length === 0) {
    console.log(`[2/3] No SYNC_FAILED rows found for ${tenantId} in last 30 days`);
    return;
  }
  console.log(`[2/3] Found ${rows.length} failure(s)`);

  // Step 3: Post to Slack
  console.log("[3/3] Posting to Slack...");
  await postSyncAlert(rows, tenantId, `Customer reported: "${text.slice(0, 100)}"`);
  
  // Cache sync failures for thread processing
  syncFailureCache.set(tenantId, {
    rows: rows,
    timestamp: Date.now(),
    chatId: chatId,
  });
  
  console.log("[3/3] Done ✓");
}

// ── Slack Events API ──────────────────────────────────────────────────────────
// Listens for messages in threads of bot's sync failure posts
app.post("/slack/events", (req, res) => {
  console.log("[slack-events] Received request");
  console.log(`[slack-events] Headers: timestamp=${req.headers['x-slack-request-timestamp']}, signature=${req.headers['x-slack-signature']?.substring(0, 20)}...`);
  
  // Verify Slack signature
  try {
    if (!verifySlackSignature(req)) {
      console.warn("[slack-events] Invalid signature");
      return res.status(403).json({ error: "Unauthorized" });
    }
    console.log("[slack-events] ✓ Signature verified");
  } catch (err) {
    console.error("[slack-events] Signature verification error:", err.message);
    return res.status(403).json({ error: "Unauthorized" });
  }

  // Handle Slack URL verification (needed for initial setup)
  if (req.body.type === "url_verification") {
    console.log("[slack-events] ✓ URL verification challenge received");
    return res.json({ challenge: req.body.challenge });
  }

  // Handle events
  if (req.body.type === "event_callback") {
    const event = req.body.event;
    console.log(`[slack-events] Event type: ${event.type}`);

    // Only handle app_mention events (team member mentions bot in thread)
    if (event.type === "app_mention" && event.thread_ts) {
      console.log(`[slack-events] Thread mention — thread_ts: ${event.thread_ts}`);
      console.log(`[slack-events] Message: ${event.text}`);

      // Process in background
      handleSlackThreadMessage(event).catch(err => {
        console.error("[slack-events] Error processing thread:", err.message);
      });
    }
  }

  // Always respond with 200 to Slack
  res.status(200).json({ ok: true });
});

// ── Handle Slack Thread Message ────────────────────────────────────────────────
async function handleSlackThreadMessage(event) {
  const { text: threadMessage, channel, thread_ts, user } = event;

  if (!threadMessage || !channel || !thread_ts) {
    console.error("[slack-thread] Missing required thread data");
    return;
  }

  // Find the tenant from cache based on channel + thread timing
  // For now, we'll look through the cache for the most recent entry
  let tenantId = null;
  let syncFailures = null;

  // Simple heuristic: get the most recent entry in cache
  // In production, you might want to store thread_ts in the cache for accurate matching
  for (const [tId, data] of syncFailureCache.entries()) {
    if (Date.now() - data.timestamp < 3600000) { // within 1 hour
      tenantId = tId;
      syncFailures = data;
      break;
    }
  }

  if (!tenantId || !syncFailures) {
    console.warn("[slack-thread] Could not find cached sync failures for thread");
    return;
  }

  console.log(`[slack-thread] Processing instruction for ${tenantId}...`);
  console.log(`[slack-thread] Team instruction: "${threadMessage.slice(0, 100)}..."`);

  try {
    // Format sync failures for AI
    const formattedFailures = formatSyncFailuresForAI(syncFailures.rows);

    // Send to Periskope AI
    await sendToPeriskopeAI(syncFailures.chatId, formattedFailures, threadMessage);

    console.log(`[slack-thread] ✓ Periskope message sent to customer`);
  } catch (err) {
    console.error("[slack-thread] Failed to process:", err.message);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Sync Failure Bot running on port ${PORT}`);
  console.log(`   POST /webhook/periskope`);
  console.log(`   POST /slack/events`);
});

// ── Debug endpoint — remove after fixing ─────────────────────────────────────
app.get("/debug-metabase", async (_req, res) => {
  try {
    const axios = require("axios");
    const testRes = await axios.get(
      `${process.env.METABASE_URL}/api/user/current`,
      {
        headers: { "mb-api-key": process.env.METABASE_API_KEY },
        validateStatus: () => true,
        maxRedirects: 5,
      }
    );
    res.json({
      status: testRes.status,
      contentType: testRes.headers["content-type"],
      body: typeof testRes.data === "string" ? testRes.data.slice(0, 300) : testRes.data,
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});