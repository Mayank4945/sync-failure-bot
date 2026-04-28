const axios = require("axios");

/**
 * Fetch SYNC_FAILED bills for a tenant from the last 30 days.
 * Auth: Metabase API key passed as x-api-key header.
 */
async function fetchSyncFailures(tenantId) {
  if (!tenantId || tenantId === "mysa") {
    throw new Error("Invalid tenant_id");
  }

  const sql = `
SELECT
  bed.reference_id                                                     AS reference_id,
  bed.bill_number                                                      AS bill_number,
  bed.vendor_name                                                      AS vendor_name,
  bed.status                                                           AS status,
  COALESCE(meta_data.error.error[0].error::varchar,    '(no type)')   AS error_type,
  COALESCE(meta_data.error.error[0].message::varchar,  '(no message)') AS error_message,
  bed.updated_at                                                       AS updated_at
FROM talipot.bill_eligible_data bed
WHERE bed.tenant_id   = '${tenantId}'
  AND bed.tenant_id  != 'mysa'
  AND bed.status      = 'SYNC_FAILED'
  AND bed.updated_at >= DATEADD(day, -30, CURRENT_DATE)
ORDER BY bed.updated_at DESC
LIMIT 50
  `.trim();

  const res = await axios.post(
    `${process.env.METABASE_URL}/api/dataset`,
    {
      database: Number(process.env.METABASE_DATABASE_ID),
      type: "native",
      native: { query: sql },
    },
    {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.METABASE_API_KEY,
      },
      timeout: 30000,
    }
  );

  const body = res.data;

  // Handle Metabase error responses
  if (body.error) throw new Error(`Metabase query error: ${body.error}`);

  // Format 1: standard API response → { data: { cols, rows } }
  if (body.data?.cols && body.data?.rows) {
    const { cols, rows } = body.data;
    const colNames = cols.map((c) => c.name);
    return rows.map((row) =>
      Object.fromEntries(colNames.map((name, i) => [name, row[i]]))
    );
  }

  // Format 2: object with numeric keys → { "0": {...}, "1": {...} }
  if (body.data && typeof body.data === "object" && body.data["0"]) {
    return Object.values(body.data);
  }

  // Format 3: array directly
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body))      return body;

  console.error("[metabase] Unexpected response shape:", JSON.stringify(body).slice(0, 300));
  throw new Error("Unexpected Metabase response format");
}

module.exports = { fetchSyncFailures };