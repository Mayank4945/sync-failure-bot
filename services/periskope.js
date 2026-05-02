const axios = require("axios");

/**
 * Send message to Periskope AI and get response
 */
async function sendToPeriskopeAI(chatId, syncFailures, teamInstruction) {
  const prompt = `
You are a helpful customer support AI assistant for Mysa accounting sync failures.

A customer reported sync failures in their accounting software. The team has reviewed the issues and provided guidance.

**Sync Failures:**
${syncFailures}

**Team Instruction/Solution:**
${teamInstruction}

Please compose a professional, friendly message to inform the customer about the solution. Include:
1. Acknowledgment of their issue
2. The recommended actions they need to take
3. Clear step-by-step instructions
4. Offer further assistance if needed

Keep the message concise but comprehensive.`;

  try {
    const endpoint = `${process.env.PERISKOPE_BASE_URL}/message/send`;
    console.log(`[periskope] Calling: POST ${endpoint}`);
    
    const response = await axios.post(
      endpoint,
      {
        chat_id: chatId,
        message: prompt,
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
      console.log(`[periskope] ✓ Message queued — queue_id: ${response.data.queue_id}`);
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

module.exports = { sendToPeriskopeAI, formatSyncFailuresForAI };
