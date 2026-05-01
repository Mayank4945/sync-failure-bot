const axios = require("axios");

const HEADERS = {
  "Content-Type": "application/json",
  "X-Api-Key": process.env.METABASE_API_KEY,
};

async function fetchSyncFailures(tenantId) {
  if (!tenantId || tenantId === "mysa") throw new Error("Invalid tenant_id");

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
LIMIT 50`.trim();

  const url = `${process.env.METABASE_URL}/api/dataset`;
  console.log(`[metabase] POST ${url}`);

  const res = await axios.post(
    url,
    { database: Number(process.env.METABASE_DATABASE_ID), type: "native", native: { query: sql } },
    { headers: HEADERS, timeout: 60000, maxRedirects: 5, validateStatus: () => true }
  );

  console.log(`[metabase] Status: ${res.status} | Content-Type: ${res.headers["content-type"]} | Body length: ${JSON.stringify(res.data).length}`);
  console.log(`[metabase] Body preview: ${JSON.stringify(res.data).slice(0, 500)}`);

  const body = res.data;
  if (!body || (typeof body === "string" && body.trim() === "")) throw new Error(`Empty response (HTTP ${res.status})`);
  if (body.error) throw new Error(`Metabase: ${body.error}`);
  if (body.data?.cols) return parseColsRows(body.data);
  if (body.data?.["0"]) return Object.values(body.data);
  if (Array.isArray(body)) return body;

  throw new Error(`Unexpected format. Keys: ${Object.keys(body || {}).join(", ")}`);
}

function parseColsRows({ cols, rows }) {
  const colNames = cols.map((c) => c.name);
  return rows.map((row) => Object.fromEntries(colNames.map((name, i) => [name, row[i]])));
}

module.exports = { fetchSyncFailures };