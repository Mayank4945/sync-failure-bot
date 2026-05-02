const https = require("https");
const url = require("url");

async function fetchSyncFailures(tenantId) {
  if (!tenantId || tenantId === "mysa") throw new Error("Invalid tenant_id");

  const sql = `
WITH base AS (
  SELECT
    tenant_id,
    reference_id,
    type,
    status,
    comments,
    vendor_id,
    updated_at,
    meta_data,
    last_modified_by,
    zoho_id
  FROM talipot.bill_eligible_data
  WHERE status = 'SYNC_FAILED'
    AND excluded = 0
    AND (
      tenant_id IS NULL
      OR tenant_id NOT IN (
        'aemt','akdemo','akmtyes','arnavdemo','demotally','prof','qaprod',
        'rudrademo','saidemo','testassembly','testaugnito','testdpd',
        'testgurujana','testhackerearth','testkouzina','testmdepot','testprime',
        'testrigi','testsep','testjeevika','testultra','tlqa','trof','vmysa'
      )
    )
),

error_data AS (
  SELECT
    b.reference_id,
    ed.value::VARCHAR AS err_msg
  FROM base b,
       b.meta_data.error.errorData AS ed
),

info_data AS (
  SELECT
    b.reference_id,
    inf.value::VARCHAR AS err_msg
  FROM base b,
       b.meta_data.error.error[0].information AS inf
),

final_errors AS (
  SELECT
    b.tenant_id,
    b.reference_id,
    b.type,
    b.status,
    COALESCE(
      ed.err_msg,
      inf.err_msg,
      b.meta_data.error.error[0].message::VARCHAR,
      b.meta_data.error.status.statusMessage::VARCHAR,
      b.comments
    ) AS full_error,
    b.vendor_id,
    b.zoho_id,
    b.updated_at,
    b.last_modified_by
  FROM base b
  LEFT JOIN error_data ed ON b.reference_id = ed.reference_id
  LEFT JOIN info_data  inf ON b.reference_id = inf.reference_id
)

SELECT
  c.reference_id,
  c.full_error AS raw_error,
  CASE
    WHEN c.full_error ILIKE '%type=%'
    THEN REGEXP_REPLACE(
           REGEXP_REPLACE(c.full_error, '.*type=', ''),
           '[,}].*',
           ''
         )
    WHEN c.full_error LIKE '%:::%:::%'
    THEN REGEXP_REPLACE(
           REGEXP_REPLACE(c.full_error, '.*:::[ ]*', ''),
           '[ ]*:::.*',
           ''
         )
    WHEN c.full_error ILIKE '%Ledger%' AND c.full_error ILIKE '%does not exist%'
    THEN 'Ledger'
    ELSE NULL
  END AS identifier_name,
  CASE
    WHEN c.full_error ILIKE '%Ledger %does not exist%'
    THEN REGEXP_REPLACE(
           REGEXP_REPLACE(c.full_error, '.*Ledger ''', ''),
           '''.*',
           ''
         )
    WHEN c.full_error LIKE '%[%]%'
    THEN REGEXP_REPLACE(
           REGEXP_REPLACE(c.full_error, '.*\\\\[', ''),
           '\\\\].*',
           ''
         )
    WHEN c.full_error ILIKE '%mysaId=%'
    THEN REGEXP_REPLACE(
           REGEXP_REPLACE(c.full_error, '.*mysaId=', ''),
           '[,}].*',
           ''
         )
    WHEN c.full_error ILIKE '%zohoId=%'
    THEN REGEXP_REPLACE(
           REGEXP_REPLACE(c.full_error, '.*zohoId=', ''),
           '[,}].*',
           ''
         )
    WHEN c.full_error ILIKE '%identifier %'
    THEN REGEXP_REPLACE(
           REGEXP_REPLACE(c.full_error, '.*identifier ', ''),
           '[ ,].*',
           ''
         )
    ELSE NULL
  END AS identifier_value

FROM final_errors c
WHERE c.tenant_id = '${tenantId}'
ORDER BY c.updated_at DESC
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

  const responseBody = res.data;
  if (!responseBody || (typeof responseBody === "string" && responseBody.trim() === "")) throw new Error(`Empty response (HTTP ${res.statusCode})`);
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