/**
 * Maps Periskope chat_id → Mysa tenant_id slug.
 *
 * chat_id format from Periskope payload (data.chat_id):
 *   Individual: "918076427750@c.us"    (@c.us)
 *   Group:      "120363xxxxxxxxx@g.us" (@g.us)
 *
 * HOW TO ADD A NEW TENANT:
 * 1. Customer sends a message → server logs:
 *    [2/4] Could not resolve tenant for chat_id: 918076427750@c.us
 * 2. Add that chat_id here mapped to the Mysa tenant slug
 * 3. git push → Railway redeploys automatically
 */
const CHAT_TENANT_MAP = {
  "918076427750@c.us":    "bsgii",
  "916360587278@c.us":    "bimatech",

  // "120363012345678@g.us": "xyzltd",
  
};

function sanitise(s) {
  return s.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32);
}

function resolveTenantId(chatId, tenantHint = "") {
  // 1. Explicit map — most reliable
  if (chatId && CHAT_TENANT_MAP[chatId]) return CHAT_TENANT_MAP[chatId];

  // 2. Claude spotted a company name in the message/screenshot
  if (tenantHint) return sanitise(tenantHint);

  return null;
}

module.exports = { resolveTenantId };
