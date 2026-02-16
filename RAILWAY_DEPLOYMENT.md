# Railway Deployment Guide

## Overview

Ask ROIE Bot requires **4 services** running in Railway:

| Service | Purpose | Start Command |
|---------|---------|---------------|
| **web** | Express server, webhooks, admin API | `npm run start` |
| **scheduler** | Cron jobs (queue follow-ups, poll Calendly) | `npm run worker:scheduler` |
| **followup-worker** | Process follow-up message queue | `npm run worker:followup` |
| **calendly-worker** | Process Calendly booking detection | `npm run worker:calendly` |

All services share the same PostgreSQL and Redis databases.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         RAILWAY PROJECT                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  PostgreSQL  │  │    Redis     │  │   Shared Variables       │  │
│  │   Database   │  │    Cache     │  │   (linked to all)        │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────────┘  │
│         │                 │                                         │
│         └────────┬────────┘                                         │
│                  │                                                   │
│    ┌─────────────┼─────────────┬─────────────┬─────────────┐       │
│    │             │             │             │             │        │
│    ▼             ▼             ▼             ▼             ▼        │
│ ┌──────┐   ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│ │ web  │   │scheduler │  │followup- │  │calendly- │                │
│ │      │   │          │  │ worker   │  │ worker   │                │
│ │:3000 │   │  cron    │  │  BullMQ  │  │  BullMQ  │                │
│ └──────┘   └──────────┘  └──────────┘  └──────────┘                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Step-by-Step Deployment

### Step 1: Create Railway Project

1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Authorize Railway and select `Ask_Roie_bot` repository
5. Railway will create the first service automatically

### Step 2: Add PostgreSQL Database

1. In your project, click **"+ New"**
2. Select **"Database"** → **"Add PostgreSQL"**
3. Wait for provisioning (takes ~30 seconds)
4. Note: The `DATABASE_URL` will be auto-generated

### Step 3: Add Redis Database

1. Click **"+ New"**
2. Select **"Database"** → **"Add Redis"**
3. Wait for provisioning
4. Note: The `REDIS_URL` will be auto-generated

### Step 4: Configure the Web Service

1. Click on the first service (your GitHub repo)
2. Go to **"Settings"** tab
3. Set **"Service Name"** to `web`
4. Under **"Deploy"** section:
   - **Start Command**: `npm run start`
   - **Restart Policy**: `On Failure` (max 10)
   - **Health Check Path**: `/health`
5. Go to **"Variables"** tab and add:

```
# Required
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
ANTHROPIC_API_KEY=sk-ant-your-key-here
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password

# Optional (add when ready)
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
CALENDLY_ACCESS_TOKEN=
CALENDLY_ORGANIZATION_URI=
CALENDLY_EVENT_TYPE_URI=

# Optional settings
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
```

### Step 5: Create Scheduler Service

1. Click **"+ New"** in your project
2. Select **"GitHub Repo"**
3. Select the same `Ask_Roie_bot` repository
4. Click on the new service
5. Go to **"Settings"**:
   - **Service Name**: `scheduler`
   - **Start Command**: `npm run worker:scheduler`
   - **Restart Policy**: `On Failure` (max 10)
6. Go to **"Variables"** tab and click **"Add Reference"**:
   - Add references to all variables from the `web` service
   - Or use **"Shared Variables"** (see Step 8)

### Step 6: Create Follow-up Worker Service

1. Click **"+ New"** → **"GitHub Repo"**
2. Select `Ask_Roie_bot` repository
3. Configure in **"Settings"**:
   - **Service Name**: `followup-worker`
   - **Start Command**: `npm run worker:followup`
   - **Restart Policy**: `On Failure` (max 10)
4. Link variables (same as scheduler)

### Step 7: Create Calendly Worker Service

1. Click **"+ New"** → **"GitHub Repo"**
2. Select `Ask_Roie_bot` repository
3. Configure in **"Settings"**:
   - **Service Name**: `calendly-worker`
   - **Start Command**: `npm run worker:calendly`
   - **Restart Policy**: `On Failure` (max 10)
4. Link variables (same as scheduler)

### Step 8: Share Variables Across Services (Recommended)

Instead of duplicating variables, use Railway's **Shared Variables**:

1. In your project, click **"+ New"**
2. Select **"Empty Service"** (or use project settings)
3. Actually, better method - use **Variable References**:

**Method A: Variable References (Recommended)**

For each worker service, in Variables tab, add:
```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
ANTHROPIC_API_KEY=${{web.ANTHROPIC_API_KEY}}
ADMIN_USERNAME=${{web.ADMIN_USERNAME}}
ADMIN_PASSWORD=${{web.ADMIN_PASSWORD}}
WHATSAPP_PHONE_NUMBER_ID=${{web.WHATSAPP_PHONE_NUMBER_ID}}
WHATSAPP_BUSINESS_ACCOUNT_ID=${{web.WHATSAPP_BUSINESS_ACCOUNT_ID}}
WHATSAPP_ACCESS_TOKEN=${{web.WHATSAPP_ACCESS_TOKEN}}
WHATSAPP_WEBHOOK_VERIFY_TOKEN=${{web.WHATSAPP_WEBHOOK_VERIFY_TOKEN}}
CALENDLY_ACCESS_TOKEN=${{web.CALENDLY_ACCESS_TOKEN}}
CALENDLY_ORGANIZATION_URI=${{web.CALENDLY_ORGANIZATION_URI}}
CALENDLY_EVENT_TYPE_URI=${{web.CALENDLY_EVENT_TYPE_URI}}
NODE_ENV=${{web.NODE_ENV}}
LOG_LEVEL=${{web.LOG_LEVEL}}
```

**Method B: Shared Variables Group**

1. Go to **Project Settings** → **Variables**
2. Create shared variables at project level
3. All services automatically inherit them

### Step 9: Generate Domain for Web Service

1. Click on `web` service
2. Go to **"Settings"** → **"Networking"**
3. Click **"Generate Domain"**
4. Your URL will be: `https://your-project.up.railway.app`

### Step 10: Run Database Migrations

1. In Railway, click on `web` service
2. Go to **"Deployments"** tab
3. Find latest deployment and click **"View Logs"**
4. Or use Railway CLI:

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to project
railway link

# Run migrations (connects to Railway's PostgreSQL)
railway run npx tsx src/database/migrate.ts
```

---

## Service Configuration Reference

### Web Service
| Setting | Value |
|---------|-------|
| Service Name | `web` |
| Start Command | `npm run start` |
| Restart Policy | On Failure (10 retries) |
| Health Check | `/health` |
| Port | 3000 (auto-detected) |

### Scheduler Service
| Setting | Value |
|---------|-------|
| Service Name | `scheduler` |
| Start Command | `npm run worker:scheduler` |
| Restart Policy | On Failure (10 retries) |
| Health Check | None (no HTTP) |

### Follow-up Worker Service
| Setting | Value |
|---------|-------|
| Service Name | `followup-worker` |
| Start Command | `npm run worker:followup` |
| Restart Policy | On Failure (10 retries) |
| Health Check | None (no HTTP) |

### Calendly Worker Service
| Setting | Value |
|---------|-------|
| Service Name | `calendly-worker` |
| Start Command | `npm run worker:calendly` |
| Restart Policy | On Failure (10 retries) |
| Health Check | None (no HTTP) |

---

## Environment Variables

### Shared by All Services

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `NODE_ENV` | No | `production` recommended |
| `LOG_LEVEL` | No | `info` or `debug` |

### Web Service Only

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Defaults to 3000 |
| `ADMIN_USERNAME` | Yes | Admin panel login |
| `ADMIN_PASSWORD` | Yes | Admin panel password |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | For webhook | Webhook verification |

### Workers Only

| Variable | Required | Description |
|----------|----------|-------------|
| `WHATSAPP_PHONE_NUMBER_ID` | For messaging | Send messages |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | For messaging | Meta account |
| `WHATSAPP_ACCESS_TOKEN` | For messaging | Meta API token |
| `CALENDLY_ACCESS_TOKEN` | For Calendly | Calendly API |
| `CALENDLY_ORGANIZATION_URI` | For Calendly | Organization URI |
| `CALENDLY_EVENT_TYPE_URI` | For Calendly | Event type URI |

---

## Scaling

### When to Scale

| Scenario | Solution |
|----------|----------|
| High message volume | Scale `web` horizontally (add replicas) |
| Follow-up backlog | Scale `followup-worker` (add replicas) |
| Slow bookings detection | Keep single `calendly-worker` (polling) |
| Slow scheduling | Keep single `scheduler` (cron jobs) |

### How to Scale in Railway

1. Click on a service
2. Go to **"Settings"**
3. Under **"Deploy"**, set **"Replicas"** count
4. For workers, ensure job locking (BullMQ handles this)

> **Note**: `scheduler` should always have exactly 1 replica to avoid duplicate cron triggers.

---

## Monitoring

### Check Service Health

```bash
# Web service health
curl https://your-project.up.railway.app/health

# Readiness (database connections)
curl https://your-project.up.railway.app/health/ready

# Admin health (with auth)
curl -u admin:password https://your-project.up.railway.app/admin/health
```

### View Logs

1. Click on any service
2. Go to **"Deployments"** tab
3. Click on a deployment
4. Click **"View Logs"**

Or use Railway CLI:
```bash
railway logs -s web
railway logs -s scheduler
railway logs -s followup-worker
railway logs -s calendly-worker
```

### Check Job Queues

Access BullMQ queues via admin endpoint (future feature) or Redis CLI:
```bash
railway run redis-cli
> KEYS bull:*
> LLEN bull:followup-queue:wait
```

---

## Troubleshooting

### Service Won't Start

| Error | Solution |
|-------|----------|
| `MODULE_NOT_FOUND` | Check `npm run build` runs first |
| `DATABASE_URL undefined` | Link PostgreSQL variable |
| `REDIS_URL undefined` | Link Redis variable |
| `Port already in use` | Remove PORT from workers |

### Workers Not Processing

| Issue | Check |
|-------|-------|
| Jobs stuck in queue | Redis connected? `REDIS_URL` correct? |
| Follow-ups not sending | `WHATSAPP_ACCESS_TOKEN` set? |
| Calendly not detecting | `CALENDLY_ACCESS_TOKEN` set? |

### Database Connection Failed

```bash
# Test connection via Railway CLI
railway run npx tsx -e "
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.query('SELECT NOW()').then(console.log).catch(console.error);
"
```

### View Recent Errors

```bash
# Via Railway CLI
railway logs -s web --since 1h | grep -i error
```

---

## Cost Estimation

Railway pricing (as of 2024):

| Resource | Cost |
|----------|------|
| Hobby Plan | $5/month (includes $5 credit) |
| PostgreSQL | ~$5-10/month (usage-based) |
| Redis | ~$3-5/month (usage-based) |
| Services | ~$0.01/GB-hour |

**Estimated monthly cost for Ask ROIE Bot:**
- Light usage: $15-20/month
- Medium usage: $25-35/month
- High usage: $40-60/month

---

## Quick Reference Commands

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to project
railway link

# Deploy manually
railway up

# View logs
railway logs -s <service-name>

# Run command in Railway environment
railway run <command>

# Open Railway dashboard
railway open
```

---

## Checklist

Before going live:

- [ ] PostgreSQL created and connected
- [ ] Redis created and connected
- [ ] Web service deployed and healthy
- [ ] Scheduler service running
- [ ] Follow-up worker running
- [ ] Calendly worker running
- [ ] All environment variables set
- [ ] Database migrations run
- [ ] Domain generated for web service
- [ ] WhatsApp webhook configured (Meta)
- [ ] Health check passing: `/health/ready`

---

*Last updated: January 2024*
