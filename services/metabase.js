const https = require("https");
const url = require("url");

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

  const apiUrl = `${process.env.METABASE_URL}/api/dataset`;
  console.log(`[metabase] POST ${apiUrl}`);

  const body = JSON.stringify({
    database: Number(process.env.METABASE_DATABASE_ID),
    type: "native",
    native: { query: sql }
  });

  const parsedUrl = new url.URL(apiUrl);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.pathname + parsedUrl.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "X-Api-Key": process.env.METABASE_API_KEY,
      "Accept": "application/json"
    },
    timeout: 60000
  };

  const res = await new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        console.log(`[metabase] Status: ${res.statusCode}`);
        console.log(`[metabase] Headers: ${JSON.stringify(res.headers)}`);
        console.log(`[metabase] Body preview: ${data.slice(0, 500)}`);
        resolve({ statusCode: res.statusCode, data, headers: res.headers });
      });
    });
    req.on("error", reject);
    req.setTimeout(60000, () => req.abort());
    req.write(body);
    req.end();
  });

  try {
    var parsedData = JSON.parse(res.data);
  } catch (e) {
    parsedData = res.data;
  }

  const body = res.data;
  if (!body || (typeof body === "string" && body.trim() === "")) throw new Error(`Empty response (HTTP ${res.statusCode})`);
  if (parsedData.error) throw new Error(`Metabase: ${parsedData.error}`);
  if (parsedData.data?.cols) return parseColsRows(parsedData.data);
  if (parsedData.data?.["0"]) return Object.values(parsedData.data);
  if (Array.isArray(parsedData)) return parsedData;

  throw new Error(`Unexpected format. Keys: ${Object.keys(parsedData || {}).join(", ")}`);
}

function parseColsRows({ cols, rows }) {
  const colNames = cols.map((c) => c.name);
  return rows.map((row) => Object.fromEntries(colNames.map((name, i) => [name, row[i]])));
}

module.exports = { fetchSyncFailures };