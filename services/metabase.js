const axios = require("axios");

/**
 * Fetch SYNC_FAILED bills for a tenant from the last 30 days.
 * Auth: Metabase API key — tries both header formats.
 */
async function fetchSyncFailures(tenantId) {
  if (!tenantId || tenantId === "mysa") {
    throw new Error("Invalid tenant_id");
  }

  const sql = `
SELECT
  bed.reference_id                                                      AS reference_id,
  bed.bill_number                                                       AS bill_number,
  bed.vendor_name                                                       AS vendor_name,
  bed.status                                                            AS status,
  COALESCE(meta_data.error.error[0].error::varchar,    '(no type)')    AS error_type,
  COALESCE(meta_data.error.error[0].message::varchar,  '(no message)') AS error_message,
  bed.updated_at                                                        AS updated_at
FROM talipot.bill_eligible_data bed
WHERE bed.tenant_id   = '${tenantId}'
  AND bed.tenant_id  != 'mysa'
  AND bed.status      = 'SYNC_FAILED'
  AND bed.updated_at >= DATEADD(day, -30, CURRENT_DATE)
ORDER BY bed.updated_at DESC
LIMIT 50
  `.trim();

  const payload = {
    database: Number(process.env.METABASE_DATABASE_ID),
    type: "native",
    native: { query: sql },
  };

  // Metabase uses 'mb-api-key' header (newer versions)
  // Fall back to 'x-api-key' if that fails
  let res;
  try {
    res = await axios.post(
      `${process.env.METABASE_URL}/api/dataset`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "mb-api-key": process.env.METABASE_API_KEY,
        },
        timeout: 30000,
      }
    );
  } catch (err) {
    // Log full error for debugging
    console.error("[metabase] Request failed:", err.response?.status, JSON.stringify(err.response?.data || err.message).slice(0, 300));
    throw err;
  }

  const body = res.data;
  console.log("[metabase] Response status:", res.status, "| body keys:", Object.keys(body || {}).join(", "));

  if (!body) throw new Error("Empty response from Metabase");
  if (body.error) throw new Error(`Metabase error: ${body.error}`);

  // Standard format: { data: { cols, rows } }
  if (body.data?.cols && body.data?.rows) {
    const { cols, rows } = body.data;
    const colNames = cols.map((c) => c.name);
    return rows.map((row) =>
      Object.fromEntries(colNames.map((name, i) => [name, row[i]]))
    );
  }

  // Numeric-keyed object: { "0": {...}, "1": {...} }
  if (body.data && typeof body.data === "object" && body.data["0"]) {
    return Object.values(body.data);
  }

  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body))      return body;

  console.error("[metabase] Unexpected shape:", JSON.stringify(body).slice(0, 300));
  throw new Error("Unexpected Metabase response format");
}

module.exports = { fetchSyncFailures };