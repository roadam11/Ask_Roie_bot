# Ask ROIE Bot

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Claude API](https://img.shields.io/badge/Claude-API-orange?logo=anthropic)](https://www.anthropic.com/)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Cloud%20API-25D366?logo=whatsapp)](https://developers.facebook.com/docs/whatsapp/cloud-api/)
[![License](https://img.shields.io/badge/License-Private-red)]()

**WhatsApp AI Sales Agent for Ask ROIE Private Tutoring Service**

An intelligent conversational agent that qualifies leads, handles objections, and books trial lessons via WhatsApp - powered by Claude AI.

---

## Features

| Feature | Description |
|---------|-------------|
| **Automated Lead Qualification** | Identifies subject, level, urgency, and contact type through natural conversation |
| **Intelligent Conversation Flow** | 3-step sales process: Qualify → Match & Value → Price & Booking |
| **Smart Follow-up System** | Automated follow-ups at 24h, 72h, and 7d intervals |
| **Calendly Integration** | Direct booking links sent via interactive WhatsApp messages |
| **Claude AI Powered** | Natural Hebrew conversations with context awareness |
| **Objection Handling** | Built-in responses for price, time, format, and trust objections |
| **Human Handoff** | Automatic escalation for complex cases |
| **Analytics & Tracking** | Event tracking with cost analysis |
| **Opt-out Management** | GDPR-compliant unsubscribe handling |

---

## Tech Stack

### Core
- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.3
- **Web Framework**: Express.js

### Database & Cache
- **Primary Database**: PostgreSQL 15+
- **Caching & Sessions**: Redis 7+
- **Job Queue**: BullMQ

### External APIs
- **AI**: Claude API (Anthropic) - claude-3-sonnet
- **Messaging**: WhatsApp Cloud API (Meta)
- **Scheduling**: Calendly API

### Development
- **Testing**: Jest + ts-jest
- **Linting**: ESLint + TypeScript ESLint
- **Formatting**: Prettier

---

## Installation

### Prerequisites

- Node.js 18.0.0 or higher
- PostgreSQL 15+
- Redis 7+
- WhatsApp Business Account with Cloud API access
- Anthropic API key
- Calendly account with API access

### Setup Steps

```bash
# 1. Clone the repository
git clone https://github.com/your-org/ask-roie-bot.git
cd ask-roie-bot

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env

# 4. Configure environment variables (see below)
nano .env

# 5. Setup PostgreSQL database
createdb askroie

# 6. Run database migrations
npm run db:migrate

# 7. Start development server
npm run dev
```

---

## Environment Variables

Create a `.env` file based on `.env.example`:

### Server Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment mode | `development` / `production` |

### Database

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/askroie` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |

### WhatsApp Cloud API

| Variable | Description | How to Get |
|----------|-------------|------------|
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID | Meta Business Suite → WhatsApp → API Setup |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Business account ID | Meta Business Suite → Settings |
| `WHATSAPP_ACCESS_TOKEN` | Permanent access token | Meta Developer Portal → System Users |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Webhook verification token | Any secure random string you create |

### Claude API

| Variable | Description | How to Get |
|----------|-------------|------------|
| `ANTHROPIC_API_KEY` | Anthropic API key | [console.anthropic.com](https://console.anthropic.com/) |

### Calendly

| Variable | Description | How to Get |
|----------|-------------|------------|
| `CALENDLY_ACCESS_TOKEN` | Personal access token | Calendly → Integrations → API |
| `CALENDLY_ORGANIZATION_URI` | Organization URI | Calendly API → `/users/me` endpoint |
| `CALENDLY_EVENT_TYPE_URI` | Event type for trial lessons | Calendly API → `/event_types` endpoint |

### Admin

| Variable | Description | Example |
|----------|-------------|---------|
| `ADMIN_USERNAME` | Admin dashboard username | `roie` |
| `ADMIN_PASSWORD` | Admin dashboard password | Strong password |

### Logging

| Variable | Description | Options |
|----------|-------------|---------|
| `LOG_LEVEL` | Winston log level | `error` / `warn` / `info` / `debug` |

---

## Project Structure

```
ask-roie-bot/
├── src/
│   ├── database/
│   │   └── migrations/
│   │       └── 001_initial_schema.sql    # Database schema
│   ├── prompts/
│   │   └── system-prompt.ts              # Claude system prompt
│   ├── types/
│   │   └── index.ts                      # TypeScript interfaces
│   └── server.ts                         # Main entry point
├── scripts/
│   └── setup-db.ts                       # Database setup script
├── tests/                                # Jest test files
├── dist/                                 # Compiled JavaScript (gitignored)
├── .env                                  # Environment variables (gitignored)
├── .env.example                          # Environment template
├── .gitignore                            # Git ignore rules
├── package.json                          # Dependencies & scripts
├── tsconfig.json                         # TypeScript configuration
└── README.md                             # This file
```

### Key Directories (to be created)

| Directory | Purpose |
|-----------|---------|
| `src/services/` | WhatsApp, Claude, Calendly service clients |
| `src/handlers/` | Webhook and message handlers |
| `src/jobs/` | BullMQ job processors (follow-ups) |
| `src/routes/` | Express route definitions |
| `src/utils/` | Utility functions and helpers |
| `src/middleware/` | Express middleware (auth, logging) |

---

## Running

### Development Mode

```bash
# Start with hot reload
npm run dev

# Run type checking
npm run typecheck

# Run linting
npm run lint

# Format code
npm run format
```

### Production Mode

```bash
# Build TypeScript
npm run build

# Start production server
npm start
```

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm test -- --coverage
```

### Database

```bash
# Run migrations
npm run db:migrate

# Connect to database (requires psql)
psql $DATABASE_URL
```

---

## Deployment

### Railway Setup

1. **Create Railway Project**
   ```bash
   # Install Railway CLI
   npm install -g @railway/cli

   # Login to Railway
   railway login

   # Initialize project
   railway init
   ```

2. **Add Services**
   - Add PostgreSQL plugin
   - Add Redis plugin

3. **Configure Environment**
   ```bash
   # Set environment variables
   railway variables set NODE_ENV=production
   railway variables set ANTHROPIC_API_KEY=sk-ant-...
   # ... set all other variables
   ```

4. **Deploy**
   ```bash
   railway up
   ```

5. **Configure WhatsApp Webhook**
   - URL: `https://your-app.railway.app/webhook/whatsapp`
   - Verify Token: Your `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
   - Subscribe to: `messages`

### Railway Configuration

Create `railway.json`:
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm start",
    "healthcheckPath": "/health",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

### Production Checklist

- [ ] All environment variables configured
- [ ] Database migrations run
- [ ] WhatsApp webhook verified
- [ ] Calendly webhook configured
- [ ] SSL/HTTPS enabled
- [ ] Logging configured
- [ ] Error monitoring setup (Sentry recommended)
- [ ] Rate limiting configured

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/webhook/whatsapp` | WhatsApp webhook verification |
| `POST` | `/webhook/whatsapp` | WhatsApp incoming messages |
| `POST` | `/webhook/calendly` | Calendly booking events |
| `GET` | `/admin/leads` | List all leads (protected) |
| `GET` | `/admin/analytics` | Analytics dashboard (protected) |

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   WhatsApp      │────▶│   Express       │────▶│   Claude API    │
│   Cloud API     │◀────│   Server        │◀────│   (Anthropic)   │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
            ┌───────────┐ ┌───────────┐ ┌───────────┐
            │ PostgreSQL│ │   Redis   │ │  BullMQ   │
            │  (Data)   │ │  (Cache)  │ │  (Jobs)   │
            └───────────┘ └───────────┘ └───────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │   Calendly      │
                                    │   Integration   │
                                    └─────────────────┘
```

---

## Contributing

1. Create a feature branch
2. Make changes with tests
3. Run `npm run lint && npm test`
4. Submit pull request

---

## Support

For issues or questions, contact the development team.

---

## License

Private - All rights reserved.
