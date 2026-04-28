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

  const { cols, rows } = res.data.data;
  const colNames = cols.map((c) => c.name);
  return rows.map((row) =>
    Object.fromEntries(colNames.map((name, i) => [name, row[i]]))
  );
}

module.exports = { fetchSyncFailures };
