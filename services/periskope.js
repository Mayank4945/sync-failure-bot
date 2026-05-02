const axios = require("axios");

/**
 * Send message to customer with sync failures + team instruction
 * Periskope AI Agent will automatically respond based on activation rules
 */
async function sendInstructionToCustomer(chatId, syncFailures, teamInstruction) {
  try {
    // Format the message with sync failures and team instruction
    const formattedFailures = formatSyncFailuresForAI(syncFailures);
    
    const message = `*🔴 Sync Failures Report*\n\n${formattedFailures}\n\n*Team Solution:*\n${teamInstruction}\n\nPlease implement the recommended actions to resolve these sync failures.`;

    console.log(`[periskope] Sending instruction to customer — chat_id: ${chatId}`);
    
    const response = await axios.post(
      `${process.env.PERISKOPE_BASE_URL}/message/send`,
      {
        chat_id: chatId,
        message: message,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.PERISKOPE_API_KEY}`,
          'x-phone': process.env.PERISKOPE_PHONE,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.status === 200 || response.status === 201) {
      console.log(`[periskope] ✓ Message sent — queue_id: ${response.data.queue_id}`);
      console.log(`[periskope] ℹ️ Periskope AI Agent will process and respond automatically`);
      return response.data;
    } else {
      console.error(`[periskope] Failed to send message:`, response.data);
      throw new Error(`Periskope error: ${response.statusText}`);
    }
  } catch (err) {
    console.error(`[periskope] API call failed:`, err.message);
    console.error(`[periskope] Status:`, err.response?.status);
    console.error(`[periskope] Data:`, err.response?.data);
    throw err;
  }
}

/**
 * Format sync failures for AI prompt
 */
function formatSyncFailuresForAI(rows) {
  if (!rows.length) return "No sync failures found";

  return rows
    .map((r) => {
      const ref = r.reference_id || "—";
      const idname = r.identifier_name || "—";
      const idval = r.identifier_value || "—";
      const err = r.raw_error || "—";
      return `• Bill ID: ${ref}\n  Field: ${idname}\n  Value: ${idval}\n  Error: ${err}`;
    })
    .join("\n\n");
}

module.exports = { sendInstructionToCustomer, formatSyncFailuresForAI };
