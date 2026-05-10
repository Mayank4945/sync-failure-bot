# Mysa Sync Failure Bot - Technical Documentation

## Overview

The Mysa Sync Failure Bot is an integrated automation system that detects accounting sync failures, alerts the team via Slack, and provides customers with AI-generated solutions through WhatsApp (Periskope).

**Architecture:** Local Node.js application (Windows) → ngrok tunnel → External webhooks

---

## System Workflow

```
┌─────────────────┐
│  Periskope      │
│  (Chat Message) │
└────────┬────────┘
         │
         │ POST /webhook/periskope
         ▼
┌─────────────────────────────────────┐
│  Sync Failure Bot (Node.js)         │
│  - Receives: event_type, chat_id    │
└────────┬────────────────────────────┘
         │
         ├──────────────────────────┐
         │                          │
         ▼                          ▼
┌──────────────────┐     ┌──────────────────┐
│  Tenant Mapper   │     │  Chat ID Resolver│
│ (chat_id→tenant) │     │                  │
└────────┬─────────┘     └──────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│  Metabase Query                  │
│  - Database: Mysa DB             │
│  - Status: SYNC_FAILED           │
│  - Extracts: ID, Error, Metadata │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│  Slack Alert                         │
│  - Posts numbered list of failures   │
│  - Uploads CSV attachment           │
│  - Creates thread for team response  │
└────────┬─────────────────────────────┘
         │
         │ Team member replies in thread
         │ with instruction/solution
         │
         ▼
┌──────────────────────────────────┐
│  Thread Event Listener           │
│  - Captures team instruction     │
│  - Retrieves cached sync data    │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│  Custom Tool Endpoint            │
│  - Generates professional response│
│  - Combines failures + solution   │
│  - Formats for customer           │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│  Periskope Message Send API      │
│  - Sends formatted message       │
│  - AI Agent processes            │
│  - Replies to customer           │
└──────────────────────────────────┘
```

---

## Component Architecture

### 1. **Core Application** (`index.js`)
- **Express.js server** running on port 3000
- **Webhook receiver** for Periskope events
- **Slack event listener** for thread mentions
- **Custom tool endpoint** for response generation
- **State management** (sync failure cache)

**Key Endpoints:**
- `POST /webhook/periskope` - Receives sync failure alerts from Periskope
- `POST /slack/events` - Listens for Slack app mentions in threads
- `POST /custom-tool/generate-response` - Generates customer-friendly responses

---

### 2. **Metabase Service** (`services/metabase.js`)
**Purpose:** Query accounting database for sync failures

**Features:**
- Connects to Metabase API via HTTPS
- Executes native SQL with 6 CTEs (Common Table Expressions)
- Extracts sync failure details:
  - Reference ID (bill/transaction ID)
  - Identifier name (field that failed)
  - Identifier value (problematic data)
  - Raw error message
- Filters by tenant, status (SYNC_FAILED), and exclusion flag
- Returns up to 50 failures ordered by timestamp

**Database Query:**
- Uses CTE pipeline for data enrichment
- Extracts identifiers from JSON metadata
- Applies regex patterns for parsing complex error structures

---

### 3. **Slack Service** (`services/slack.js`)
**Purpose:** Post alerts and manage Slack integration

**Features:**
- **chat.postMessage API** - Sends main alert messages
- **files.getUploadURLExternal API** - Requests upload slots
- **files.completeUploadExternal API** - Completes file uploads
- Formats failures as numbered list with labels
- Generates CSV export with proper escaping
- Uploads CSV file as attachment to channel

**Message Format:**
```
1. REF: BSGATE260430X431U3
   NAME: Cost Centre
   VALUE: JJ(Fall26)
   ERROR: Record not found...

2. REF: BSGATE260429RPGZWV
   ...
```

**Required Scopes:**
- `chat:write` - Post messages
- `chat:write.public` - Post in public channels
- `files:write` - Upload files
- `channels:read` - List channels
- `groups:read` - Access private channels

---

### 4. **Periskope Service** (`services/periskope.js`)
**Purpose:** Send solutions to customers via WhatsApp

**Features:**
- **sendInstructionToCustomer()** - Main function
  1. Formats sync failures into readable list
  2. Calls custom tool endpoint for response generation
  3. Sends formatted message to Periskope API
  4. Receives queue_id for tracking

**API Used:**
- `POST /v1/message/send` - Sends WhatsApp message
- Authentication: Bearer token + x-phone header
- Returns: queue_id for status tracking

---

### 5. **Tenant Mapper** (`services/tenantMapper.js`)
**Purpose:** Map WhatsApp chat_id to Mysa tenant

**Implementation:** Simple mapping dictionary
```javascript
{
  '918076427750@c.us': 'bsgii',
  '919876543210@c.us': 'swish',
  ...
}
```

---

## Data Flow

### **Phase 1: Sync Detection**
1. Customer sends "Sync fail" message via Periskope
2. Periskope webhook forwards to bot with `chat_id`
3. Bot resolves `chat_id` → `tenant_id`
4. Bot queries Metabase for SYNC_FAILED records

### **Phase 2: Team Alert**
1. Bot caches sync failures (with timestamps)
2. Posts numbered list + CSV to Slack
3. Creates thread for team collaboration
4. Stores failure data in memory (expires after 1 hour)

### **Phase 3: Solution Generation**
1. Team member replies in thread with instruction
   - Example: "Create these ledgers in Tally"
2. Bot captures mention event
3. Bot retrieves cached sync data
4. Calls custom tool endpoint (generates response)
5. Custom tool returns formatted message

### **Phase 4: Customer Communication**
1. Bot sends generated message to Periskope API
2. Message queued for WhatsApp delivery
3. Periskope AI Agent processes (if enabled)
4. Customer receives solution in WhatsApp chat

---

## Technology Stack

### **Backend**
- **Runtime:** Node.js v24.14.1
- **Framework:** Express.js 4.x
- **HTTP Client:** axios
- **Environment:** dotenv
- **Development:** nodemon

### **External Services**
- **Metabase:** Database queries (SQL)
- **Slack:** Team alerts and file uploads
- **Periskope:** WhatsApp integration
- **ngrok:** Public URL tunneling

### **Deployment**
- **Environment:** Windows local machine (on VPN)
- **Port:** 3000
- **Public Access:** ngrok tunnel
- **Network:** VPN-connected for Metabase access

---

## Configuration

### **.env Variables**
```
# Database
METABASE_URL=https://metabase-prod.mysa.io
METABASE_DATABASE_ID=16
METABASE_API_KEY=<api_key>

# Slack
SLACK_BOT_TOKEN=xoxb-<token>
SLACK_CHANNEL=C<channel_id>
SLACK_SIGNING_SECRET=<secret>

# Periskope
PERISKOPE_BASE_URL=https://api.periskope.app/v1
PERISKOPE_PHONE=918197675909
PERISKOPE_API_KEY=<jwt_token>

# Server
PORT=3000
```

---

## Security Implementation

### **Slack Signature Verification**
- Validates every incoming request
- Uses HMAC-SHA256
- Prevents unauthorized webhook calls
- Timestamp validation (5-minute window)

### **Authentication**
- **Metabase:** X-Api-Key header
- **Slack:** Bearer token
- **Periskope:** Bearer token + phone header
- All credentials stored in .env (excluded from git)

### **Network**
- Local deployment (no public exposure of bot logic)
- ngrok tunnel for webhook reception only
- VPN-connected for Metabase access

---

## Error Handling

### **Graceful Failures**
- **Metabase down:** Logs error, notifies team
- **Slack API error:** Logs with response details
- **Periskope delivery:** Queued with retry logic
- **Missing tenant:** Logged, no processing

### **Logging**
- Prefixed logs: `[webhook]`, `[metabase]`, `[slack]`, `[periskope]`, etc.
- Timestamps: ISO format
- Error details: Status codes, response bodies

---

## Performance Characteristics

| Operation | Time | Notes |
|-----------|------|-------|
| Webhook to Slack post | ~2-3 sec | Includes Metabase query |
| CSV upload | ~1-2 sec | File size dependent |
| Thread processing | ~1 sec | Memory lookup |
| Custom tool call | ~500ms | Local endpoint |
| Periskope send | ~2 sec | Queue accepted |

---

## Future Enhancements

1. **OpenAI Integration**
   - Replace custom tool with GPT-4 for smarter responses
   - Context-aware error analysis

2. **Database Persistence**
   - Store sync failures in MongoDB/PostgreSQL
   - Historical analysis and trends

3. **Auto-Remediation**
   - Suggest automatic fixes for common errors
   - Execute fixes with user approval

4. **Multi-Tenant Scaling**
   - Dynamic tenant discovery
   - Separate configurations per tenant

5. **Advanced Analytics**
   - Dashboard for sync failure trends
   - Pattern recognition for root causes

6. **Scheduled Checks**
   - Periodic sync verification
   - Proactive alerts before customers report

---

## Deployment Notes

### **Local Setup**
```bash
npm install
# Update .env with credentials
npm start
```

### **ngrok Tunnel**
```bash
ngrok http 3000
# Copy public URL to Periskope webhook and Slack event subscription
```

### **Auto-Start (Windows)**
Use Task Scheduler or NSSM to auto-run `npm start` on system startup

### **Monitoring**
- Watch console logs in real-time
- Check ngrok dashboard for traffic
- Monitor Slack channel for alerts
- Verify Periskope chat for customer messages

---

## Support & Troubleshooting

| Issue | Solution |
|-------|----------|
| Metabase 404 | Check API key, database ID, VPN connection |
| Slack signature failure | Verify signing secret, check timestamp |
| ngrok URL changes | Update Periskope webhook + Slack event URL |
| Periskope queue_id errors | Verify phone number, API key, base URL |
| Thread not processing | Ensure bot is mentioned with `@` |
| CSV not uploading | Check `files:write` scope, file size |

---

**Document Version:** 1.0  
**Last Updated:** May 2, 2026  
**Maintained By:** Development Team
