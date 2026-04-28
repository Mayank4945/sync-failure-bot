const axios = require("axios");

/**
 * Build a Slack message with a monospaced table.
 * error_message is never truncated — long messages word-wrap with indent.
 */
function buildSlackTable(rows, tenantId, summary) {
  const W_REF    = 32;
  const W_STATUS = 13;
  const INDENT   = " ".repeat(W_REF + W_STATUS + 2);
  const pad      = (s, n) => String(s ?? "—").padEnd(n);

  const header  = `${pad("Bill Reference ID", W_REF)}│${pad("Status", W_STATUS)}│Error Message`;
  const divider = `${"─".repeat(W_REF)}┼${"─".repeat(W_STATUS)}┼${"─".repeat(50)}`;
  const rowSep  = "─".repeat(W_REF + W_STATUS + 52);

  const lines = rows.map((r) => {
    const prefix  = `${pad(r.reference_id || r.bill_number || "—", W_REF)}│${pad(r.status, W_STATUS)}│`;
    const message = String(r.error_message || "—");

    if (message.length <= 60) return `${prefix}${message}`;

    // Word-wrap long error messages
    const words  = message.split(" ");
    const chunks = [];
    let line     = "";
    for (const word of words) {
      if (line.length + word.length > 58) { chunks.push(line.trim()); line = ""; }
      line += word + " ";
    }
    if (line.trim()) chunks.push(line.trim());

    return `${prefix}${chunks[0]}\n${chunks.slice(1).map((l) => INDENT + l).join("\n")}`;
  });

  return `*🔴 Accounting Sync Failures — \`${tenantId}\`*
_${summary || `${rows.length} bill(s) failing sync`}_

\`\`\`
${header}
${divider}
${lines.join("\n" + rowSep + "\n")}
\`\`\`
_${rows.length} bill(s) · Last 30 days · Mysa Sync Bot_`;
}

/**
 * Post the sync failure alert to Slack.
 */
async function postSyncAlert(rows, tenantId, summary) {
  const text = buildSlackTable(rows, tenantId, summary);

  const res = await axios.post(
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

  if (!res.data.ok) throw new Error(`Slack error: ${res.data.error}`);
  console.log(`[slack] Posted for ${tenantId} — ts: ${res.data.ts}`);
  return res.data.ts;
}

module.exports = { postSyncAlert };
