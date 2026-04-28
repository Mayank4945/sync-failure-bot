const axios = require("axios");

const HEADERS = {
  "Content-Type": "application/json",
  "mb-api-key": process.env.METABASE_API_KEY,
};

/**
 * Metabase /api/dataset returns 202 + a job token for async queries.
 * We then poll /api/dataset/:token until the result is ready.
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

  // Step 1: Submit the query
  const submitRes = await axios.post(
    `${process.env.METABASE_URL}/api/dataset`,
    {
      database: Number(process.env.METABASE_DATABASE_ID),
      type: "native",
      native: { query: sql },
    },
    { headers: HEADERS, timeout: 30000 }
  );

  // Step 2: If sync response with data, parse immediately
  if (submitRes.data?.data?.cols) {
    console.log("[metabase] Sync response received");
    return parseColsRows(submitRes.data.data);
  }

  // Step 3: Async — get the job token and poll
  const jobToken = submitRes.data?.job_token
    || submitRes.headers?.["x-metabase-job-token"]
    || submitRes.data?.token;

  if (!jobToken) {
    // Last resort — try export endpoint which always returns sync CSV-style JSON
    console.log("[metabase] No job token, trying export endpoint...");
    return fetchViaExport(tenantId, sql);
  }

  console.log(`[metabase] Async job token: ${jobToken} — polling...`);
  return pollJob(jobToken);
}

/**
 * Poll the async job until complete.
 */
async function pollJob(jobToken, attempts = 0) {
  if (attempts > 10) throw new Error("Metabase query timed out after 10 polls");

  await sleep(2000); // wait 2 seconds between polls

  const res = await axios.get(
    `${process.env.METABASE_URL}/api/dataset/${jobToken}`,
    { headers: HEADERS, timeout: 15000 }
  );

  const body = res.data;
  console.log(`[metabase] Poll ${attempts + 1} — status: ${res.status} | keys: ${Object.keys(body || {}).join(", ")}`);

  if (body?.data?.cols) return parseColsRows(body.data);
  if (body?.status === "queued" || body?.status === "running") return pollJob(jobToken, attempts + 1);
  if (body?.error) throw new Error(`Metabase error: ${body.error}`);

  // Still no data — keep polling
  return pollJob(jobToken, attempts + 1);
}

/**
 * Fallback: use the /api/dataset/json export endpoint (always synchronous).
 */
async function fetchViaExport(tenantId, sql) {
  console.log("[metabase] Using export endpoint...");

  const res = await axios.post(
    `${process.env.METABASE_URL}/api/dataset/json`,
    {
      query: JSON.stringify({
        database: Number(process.env.METABASE_DATABASE_ID),
        type: "native",
        native: { query: sql },
      }),
    },
    {
      headers: {
        ...HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 60000,
    }
  );

  if (Array.isArray(res.data)) return res.data;

  console.error("[metabase] Export response:", JSON.stringify(res.data).slice(0, 300));
  throw new Error("Could not get data from Metabase export endpoint");
}

function parseColsRows({ cols, rows }) {
  const colNames = cols.map((c) => c.name);
  return rows.map((row) =>
    Object.fromEntries(colNames.map((name, i) => [name, row[i]]))
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { fetchSyncFailures };