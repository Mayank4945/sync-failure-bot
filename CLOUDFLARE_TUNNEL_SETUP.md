# Cloudflare Tunnel Setup Guide for Metabase Access

This guide will allow your Render deployment to access Metabase through a VPN-connected machine.

## Architecture
```
Render (sync-failure-bot) → Cloudflare Tunnel → Your VPN Machine → Metabase
```

## Prerequisites
- A machine that's always connected to VPN (laptop, desktop, or server)
- A domain (you can use a free Cloudflare domain or existing domain)
- Cloudflare account (free tier is fine)

## Step 1: Create a Cloudflare Account (if needed)
1. Go to https://dash.cloudflare.com/sign-up
2. Sign up with email or existing account
3. Skip domain registration for now (or add your domain if you have one)

## Step 2: Install cloudflared on Your VPN Machine

### Windows:
1. Download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
   - Choose "Windows 64-bit" or "Windows 32-bit" (match your system)
2. Extract `cloudflared.exe` to a folder (e.g., `C:\cloudflared\`)
3. Open PowerShell as Administrator in that folder

### macOS:
```bash
brew install cloudflare/cloudflare/cloudflared
```

### Linux:
```bash
# Ubuntu/Debian
sudo apt-get install cloudflared

# Or download manually from the link above
```

## Step 3: Authenticate cloudflared with Cloudflare

Run this command on your VPN machine:
```bash
cloudflared tunnel login
```

This will:
1. Open a browser window
2. Ask you to select your domain (or create a new one)
3. Generate credentials locally

**Keep the terminal running after this — don't close it yet**

## Step 4: Create the Tunnel

In the same terminal, run:
```bash
cloudflared tunnel create metabase-access
```

This creates a tunnel named "metabase-access" and shows you:
- Tunnel ID
- Credentials file path

**Save the Tunnel ID — you'll need it later**

## Step 5: Create Tunnel Configuration File

Create a file named `config.yml` in the same folder as `cloudflared.exe`:

```yaml
tunnel: metabase-access
credentials-file: C:\path\to\your\.cloudflared\<your-tunnel-id>.json

ingress:
  - hostname: metabase.yourdomain.com
    service: https://metabase-prod.mysa.io
  - service: http_status:404
```

**Important:** Replace:
- `yourdomain.com` with your Cloudflare domain (or actual domain)
- `C:\path\to\your\.cloudflared\` with your actual path

## Step 6: Connect the Tunnel

Run in PowerShell (on your VPN machine):
```bash
cloudflared tunnel run metabase-access
```

You should see output like:
```
2026-05-01 17:35:00.123Z INF Connection established
2026-05-01 17:35:00.456Z INF Tunnel running
```

**This process must stay running.** Options:
- Keep PowerShell window open
- Use Windows Task Scheduler to auto-start it
- Run as Windows Service (advanced)

## Step 7: Update Your Render Environment Variable

1. Go to Render Dashboard: https://dashboard.render.com
2. Select your sync-failure-bot service
3. Click "Environment"
4. Update `METABASE_URL`:
   ```
   https://metabase.yourdomain.com
   ```
   (was: https://metabase-prod.mysa.io)

5. Click "Save Changes" → Render will auto-redeploy

## Step 8: Test It Works

Once Render redeploys, send a test webhook to `/webhook/periskope` with:
```json
{
  "event_type": "message.created",
  "data": {
    "body": "Sync Fail",
    "chat_id": "918076427750@c.us"
  }
}
```

Check Render logs — should show successful Metabase queries now.

## Troubleshooting

### "Connection refused" in cloudflared logs
- Make sure Metabase is accessible on your VPN
- Test: `curl -k -H "X-Api-Key: your-key" https://metabase-prod.mysa.io/api/user/current`

### "502 Bad Gateway" from Render
- The tunnel machine is offline → restart cloudflared
- Check firewall isn't blocking outbound HTTPS

### "404 Not Found" 
- Wrong domain in config.yml
- Cloudflare DNS not pointing to tunnel yet

### Tunnel keeps disconnecting
- Check VPN connection stability
- Run `cloudflared tunnel run metabase-access --loglevel debug` for detailed logs

## Keeping Tunnel Always Running

### Option A: Task Scheduler (Windows)
1. Create a batch file `start-tunnel.bat`:
   ```batch
   @echo off
   cd C:\cloudflared
   cloudflared tunnel run metabase-access
   ```

2. Open Task Scheduler
3. Create task → "Start a program" → point to `start-tunnel.bat`
4. Set to "Run with highest privileges" + "Run whether user is logged in or not"

### Option B: Run as Service (Windows)
```bash
cloudflared service install
cloudflared service start
```

### Option C: Keep laptop/server always powered on
Simple but works — just don't let your machine sleep

## Success Indicators

✅ cloudflared shows "Connection established"
✅ Render logs show HTTP 202 from Metabase (not 404)
✅ Webhook receives sync failure data correctly
✅ Slack notifications appear

---

**Questions?** Check Cloudflare docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
