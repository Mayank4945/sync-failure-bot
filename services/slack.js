const axios = require("axios");
const qs = require("qs");

/**
 * Convert rows to formatted table with proper spacing and alignment
 */
function rowsToTable(rows) {
  if (!rows.length) return "No sync failures found";

  // Format each row on separate lines for clarity
  const formatted = rows.map((r, idx) => {
    const ref = (r.reference_id || "—").substring(0, 50);
    const idname = (r.identifier_name || "—").substring(0, 30);
    const idval = (r.identifier_value || "—").substring(0, 40);
    const err = (r.raw_error || "—").substring(0, 150);
    
    return `${idx + 1}. REF: ${ref}
   NAME: ${idname}
   VALUE: ${idval}
   ERROR: ${err}`;
  }).join("\n\n");

  return formatted;
}

/**
 * Convert rows to CSV format with proper escaping
 */
function rowsToCSV(rows) {
  if (!rows.length) return "reference_id,identifier_name,identifier_value,raw_error\n";
  
  const headers = ["reference_id", "identifier_name", "identifier_value", "raw_error"];
  const csvRows = rows.map(r => [
    `"${(r.reference_id || "").replace(/"/g, '""')}"`,
    `"${(r.identifier_name || "").replace(/"/g, '""')}"`,
    `"${(r.identifier_value || "").replace(/"/g, '""')}"`,
    `"${(r.raw_error || "").replace(/"/g, '""')}"`
  ].join(","));
  
  return headers.join(",") + "\n" + csvRows.join("\n");
}

/**
 * Post the sync failure alert to Slack with formatted list
 */
async function postSyncAlert(rows, tenantId, summary) {
  if (!rows.length) {
    const res = await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: process.env.SLACK_CHANNEL,
        text: `*🟢 Accounting Sync Status — \`${tenantId}\`*\n_No sync failures found (Excluded = 0)_`,
        unfurl_links: false,
        unfurl_media: false,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        },
      }
    );
    if (!res.data.ok) throw new Error(`Slack error: ${res.data.error}`);
    return res.data.ts;
  }

  const table = rowsToTable(rows);
  const csv = rowsToCSV(rows);
  const timestamp = new Date().toISOString().split('T')[0];
  const csvFilename = `sync-failures-${tenantId}-${timestamp}.csv`;

  const text = `*🔴 Accounting Sync Failures — \`${tenantId}\`*
_${summary || `${rows.length} bill(s) failing sync`}_

\`\`\`
${table}
\`\`\`

_Total: ${rows.length} bill(s) · Excluded = 0 · Mysa Sync Bot_`;

  const msgRes = await axios.post(
    "https://slack.com/api/chat.postMessage",
    {
      channel: process.env.SLACK_CHANNEL,
      text,
      unfurl_links: false,
      unfurl_media: false,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
    }
  );

  if (!msgRes.data.ok) throw new Error(`Slack error: ${msgRes.data.error}`);
  console.log(`[slack] Posted for ${tenantId} — ts: ${msgRes.data.ts}`);
  console.log(`[csv] ${csvFilename}\n${csv}`);

  // Upload CSV file to Slack using new API
  try {
    const csvBuffer = Buffer.from(csv);
    const fileSize = csvBuffer.length;

    // Step 1: Get upload URL
    const urlRes = await axios.post('https://slack.com/api/files.getUploadURLExternal', 
      qs.stringify({ filename: csvFilename, length: fileSize }),
      {
        headers: {
          'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (!urlRes.data.ok) {
      console.error(`[slack] Failed to get upload URL:`, urlRes.data);
      return msgRes.data.ts;
    }

    const uploadUrl = urlRes.data.upload_url;
    const fileId = urlRes.data.file_id;

    // Step 2: Upload file to URL
    await axios.post(uploadUrl, csvBuffer, {
      headers: { 'Content-Type': 'text/csv' },
    });

    // Step 3: Complete upload
    const completeRes = await axios.post('https://slack.com/api/files.completeUploadExternal',
      qs.stringify({
        files: JSON.stringify([{
          id: fileId,
          title: `Sync Failures — ${tenantId} (${timestamp})`,
        }]),
        channel_id: process.env.SLACK_CHANNEL,
      }),
      {
        headers: {
          'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (!completeRes.data.ok) {
      console.error(`[slack] Failed to complete upload:`, completeRes.data);
    } else {
      console.log(`[slack] CSV uploaded successfully`);
    }
  } catch (err) {
    console.error(`[slack] File upload failed:`, err.message);
  }

  return msgRes.data.ts;
}

module.exports = { postSyncAlert };
