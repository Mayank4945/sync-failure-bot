const axios = require("axios");

/**
 * Classify whether a Periskope message is an accounting sync issue.
 * Works with text, image (base64), or both.
 */
async function classifyMessage({ text, imageB64, mediaType = "image/jpeg" }) {
  const contentParts = [];

  if (imageB64) {
    contentParts.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: imageB64 },
    });
  }

  contentParts.push({
    type: "text",
    text: `You are a strict classifier for Mysa AP platform support tickets.
${text ? `Customer message: "${text}"` : ""}
${imageB64 ? "Also analyse the attached screenshot." : ""}

Classify whether this is an accounting sync or ERP sync failure report.

Flag is_sync_issue TRUE if the message mentions ANY of:
- sync failed / sync error / sync issue / sync not working
- bills not syncing / accounting tab not working
- ERP sync / Tally sync / Zoho sync failure
- SYNC_FAILED status

Flag is_sync_issue FALSE for:
- Greetings or pleasantries (hi, hello, congrats, thanks, good morning)
- Unrelated questions, payment issues, login problems
- Anything with no mention of sync

Return ONLY valid JSON, no extra text:
{
  "is_sync_issue": true or false,
  "confidence": "high" | "medium" | "low",
  "summary": "one sentence describing what the customer reported",
  "tenant_hint": "company name if visible, else empty string"
}`,
  });

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      messages: [{ role: "user", content: contentParts }],
    },
    {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
    }
  );

  const raw = response.data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return {
      isSyncIssue: !!parsed.is_sync_issue,
      confidence:  parsed.confidence  || "low",
      summary:     parsed.summary     || "",
      tenantHint:  parsed.tenant_hint || "",
    };
  } catch {
    console.error("[classifier] Parse error:", raw);
    return { isSyncIssue: false, confidence: "low", summary: "Parse error", tenantHint: "" };
  }
}

module.exports = { classifyMessage };
