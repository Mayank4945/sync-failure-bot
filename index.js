require("dotenv").config();

const express = require("express");
const { fetchSyncFailures } = require("./services/metabase");
const { postSyncAlert }     = require("./services/slack");
const { resolveTenantId }   = require("./services/tenantMapper");

const app = express();
app.use(express.json({ limit: "10mb" }));

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
  console.log("[3/3] Done ✓");
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Sync Failure Bot running on port ${PORT}`);
  console.log(`   POST /webhook/periskope`);
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