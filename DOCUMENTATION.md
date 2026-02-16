# Ask ROIE Bot - WhatsApp AI Sales Agent
## Project Overview & Documentation

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Data Flow](#3-data-flow)
4. [Modules & Services](#4-modules--services)
5. [Key Features](#5-key-features)
6. [Design Decisions](#6-design-decisions)
7. [Production Readiness Features](#7-production-readiness-features)
8. [Strengths & Weaknesses](#8-strengths--weaknesses)
9. [Future Improvements](#9-future-improvements)
10. [API Reference](#10-api-reference)
11. [Environment Variables Reference](#11-environment-variables-reference)
12. [Deployment Guide](#12-deployment-guide)

---

## 1. Executive Summary

### What is Ask ROIE Bot?

Ask ROIE Bot is an AI-powered WhatsApp sales agent designed specifically for **Ask ROIE**, a private tutoring service. The bot autonomously handles incoming WhatsApp inquiries, qualifies leads, answers questions about tutoring services, and guides potential customers toward booking trial lessons.

### Business Problem It Solves

Private tutoring services face several challenges:
- **24/7 Availability**: Parents inquire at all hours; missing a message means losing a potential student
- **Lead Qualification**: Manually qualifying leads is time-consuming and inconsistent
- **Follow-up Fatigue**: Sales teams forget to follow up, leading to lost opportunities
- **Hebrew Market**: Most chatbot solutions don't support Hebrew well

Ask ROIE Bot solves these by:
- Responding instantly to WhatsApp messages, 24/7
- Automatically qualifying leads based on conversation context
- Scheduling and sending follow-up messages automatically
- Optimizing for Hebrew language conversations

### Key Features

- **Intelligent Conversations**: Powered by Claude AI (claude-3-5-sonnet) with Hebrew optimization
- **Lead Management**: Automatic lead creation, qualification scoring, and state tracking
- **Follow-up Automation**: Scheduled follow-ups at 24h, 72h, and 7 days
- **Booking Detection**: Calendly integration to detect when leads book trial lessons
- **Analytics**: Full conversation history, token tracking, and cost calculation
- **Admin API**: Protected endpoints for lead management and analytics

### Tech Stack Overview

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+ with TypeScript |
| Web Framework | Express.js |
| Database | PostgreSQL 16 |
| Cache/Queue | Redis 7 + BullMQ |
| AI | Anthropic Claude API |
| Messaging | WhatsApp Cloud API |
| Scheduling | Calendly API |
| Deployment | Railway (Nixpacks) |

---

## 2. System Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL SERVICES                               │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│   WhatsApp      │    Calendly     │   Claude AI     │      Meta Cloud       │
│   Business      │      API        │     API         │        API            │
│   (Incoming)    │   (Polling)     │  (Intelligence) │      (Outgoing)       │
└────────┬────────┴────────┬────────┴────────┬────────┴───────────┬───────────┘
         │                 │                 │                     │
         ▼                 ▼                 ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            EXPRESS SERVER (:3000)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Webhook    │  │   Admin     │  │   Health    │  │     Middleware      │ │
│  │  Controller │  │   Routes    │  │   Checks    │  │  (Auth, Logging,    │ │
│  │  /webhook/* │  │   /admin/*  │  │  /health/*  │  │   Error Handling)   │ │
│  └──────┬──────┘  └──────┬──────┘  └─────────────┘  └─────────────────────┘ │
│         │                │                                                   │
│         ▼                ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         SERVICE LAYER                                │    │
│  ├─────────────┬─────────────┬─────────────┬─────────────┬─────────────┤    │
│  │   Lead      │  Message    │   Claude    │  WhatsApp   │  Calendly   │    │
│  │  Service    │  Service    │  Service    │  Service    │  Service    │    │
│  └──────┬──────┴──────┬──────┴──────┬──────┴──────┬──────┴──────┬──────┘    │
│         │             │             │             │             │            │
└─────────┼─────────────┼─────────────┼─────────────┼─────────────┼────────────┘
          │             │             │             │             │
          ▼             ▼             ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER                                      │
├───────────────────────────────────┬─────────────────────────────────────────┤
│         PostgreSQL 16             │              Redis 7                     │
│  ┌─────────────────────────────┐  │  ┌─────────────────────────────────────┐│
│  │  leads                      │  │  │  BullMQ Queues:                     ││
│  │  messages                   │  │  │  - followup-queue                   ││
│  │  follow_ups                 │  │  │  - calendly-queue                   ││
│  │  analytics_events           │  │  │                                     ││
│  └─────────────────────────────┘  │  │  Message Deduplication Cache        ││
│                                   │  └─────────────────────────────────────┘│
└───────────────────────────────────┴─────────────────────────────────────────┘
          ▲                                           │
          │                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BACKGROUND WORKERS                                │
├─────────────────────────┬─────────────────────────┬─────────────────────────┤
│    Scheduler Worker     │    Follow-up Worker     │    Calendly Worker      │
│  (node-schedule cron)   │   (BullMQ processor)    │   (BullMQ processor)    │
│  - Queue follow-ups     │   - Send messages       │   - Poll bookings       │
│  - Poll Calendly        │   - Update lead state   │   - Match to leads      │
└─────────────────────────┴─────────────────────────┴─────────────────────────┘
```

### Components Breakdown

#### Express Server (API Layer)
The main HTTP server handling all incoming requests:
- **Webhook Controller**: Receives WhatsApp messages via Meta's webhook
- **Admin Routes**: Protected CRUD operations for leads and analytics
- **Health Checks**: Liveness and readiness probes for Railway

#### PostgreSQL (Data Persistence)
Primary data store with 4 tables:
- `leads`: Customer information and qualification status
- `messages`: Full conversation history
- `follow_ups`: Scheduled follow-up tracking
- `analytics_events`: Event logging for metrics

#### Redis (Queues & Caching)
- **BullMQ Queues**: Reliable job processing with retries
- **Message Deduplication**: Prevents processing same WhatsApp message twice
- **Session State**: (Future) Conversation context caching

#### BullMQ Workers (Background Jobs)
Separate processes for async operations:
- **Scheduler**: Cron jobs to queue follow-ups and poll Calendly
- **Follow-up Worker**: Processes and sends follow-up messages
- **Calendly Worker**: Detects bookings and updates lead status

#### Claude AI (Conversation Intelligence)
- Model: `claude-3-5-sonnet-20241022`
- Hebrew-optimized system prompt
- Context-aware responses using conversation history
- Automatic qualification assessment

#### WhatsApp Cloud API (Messaging)
- Receives messages via webhook
- Sends responses via Graph API
- Handles 24-hour messaging window
- Supports text messages (expandable to templates)

#### Calendly API (Booking Detection)
- Polls for recent scheduled events
- Extracts invitee phone numbers
- Matches bookings to existing leads
- Updates lead state to "booked"

---

## 3. Data Flow

### Incoming Message Flow (13 Steps)

```
Step 1:  Parent sends WhatsApp message to Ask ROIE business number
         │
Step 2:  Meta Cloud API receives message
         │
Step 3:  Meta sends webhook POST to /webhook/whatsapp
         │
Step 4:  Express server validates webhook signature
         │
Step 5:  WhatsApp controller extracts message data
         │
Step 6:  Check Redis for message_id deduplication
         ├── If duplicate → Return 200 OK, stop processing
         │
Step 7:  LeadService.findOrCreate() - Get or create lead by phone
         │
Step 8:  MessageService.saveMessage() - Store incoming message
         │
Step 9:  MessageService.getConversationHistory() - Load context
         │
Step 10: ClaudeService.generateResponse() - AI generates reply
         │
Step 11: WhatsAppService.sendMessage() - Send response to user
         │
Step 12: MessageService.saveMessage() - Store bot response
         │
Step 13: LeadService.updateQualification() - Update lead score
         │
         └── Return 200 OK to Meta
```

### Follow-up Scheduling Flow

```
Step 1:  Scheduler runs every 5 minutes (cron: */5 * * * *)
         │
Step 2:  Query follow_ups table for pending follow-ups where:
         - scheduled_at <= NOW()
         - status = 'pending'
         │
Step 3:  For each follow-up, add job to followup-queue
         │
Step 4:  BullMQ Follow-up Worker picks up job
         │
Step 5:  Check if lead.last_message_at > 24 hours ago
         ├── If outside window → Update status to 'window_expired'
         │
Step 6:  Generate contextual follow-up message via Claude
         │
Step 7:  Send message via WhatsApp Cloud API
         │
Step 8:  Update follow_up status to 'sent'
         │
Step 9:  Log analytics event
```

### Calendly Booking Detection Flow

```
Step 1:  Scheduler runs every 5 minutes (cron: 2,7,12... */5+2)
         │
Step 2:  Add job to calendly-queue
         │
Step 3:  Calendly Worker picks up job
         │
Step 4:  CalendlyService.getRecentBookings() - Fetch last 24h events
         │
Step 5:  For each booking:
         │
Step 6:  Extract invitee phone number from booking data
         │
Step 7:  Normalize phone number (+972...)
         │
Step 8:  LeadService.findByPhone() - Match to existing lead
         ├── If no match → Log and continue
         │
Step 9:  Update lead:
         - state = 'booked'
         - calendly_event_id = event.uri
         │
Step 10: Log analytics event (lead_booked)
```

### Lead Qualification Logic

The bot automatically qualifies leads based on conversation analysis:

```typescript
Qualification Score (0-100):
├── Has child's age mentioned?        +20 points
├── Has grade/class mentioned?        +15 points
├── Has subject mentioned?            +20 points
├── Asked about pricing?              +15 points
├── Asked about scheduling?           +15 points
├── Expressed urgency?                +10 points
└── Multiple messages exchanged?      +5 points per message (max 20)

State Transitions:
new → engaged → qualified → booked → converted
      │         │           │
      └─────────┴───────────┴──→ lost (after 3 failed follow-ups)
```

---

## 4. Modules & Services

### config/ - Configuration Management

**File: `src/config/index.ts`**

Centralized configuration using Zod for runtime validation:

```typescript
// Structure
config = {
  server: { port, nodeEnv, isProduction, isDevelopment },
  database: { url },
  redis: { url },
  whatsapp: { phoneNumberId, businessAccountId, accessToken, webhookVerifyToken },
  anthropic: { apiKey, model, maxTokens },
  calendly: { accessToken, organizationUri, eventTypeUri },
  admin: { username, password },
  logging: { level }
}
```

**Key Features:**
- Environment variable validation at startup
- Fails fast with clear error messages
- Type-safe access throughout application
- Optional fields for WhatsApp/Calendly (deployment flexibility)

---

### models/ - Database Models

**Lead Model (`src/models/lead.model.ts`)**

```typescript
interface Lead {
  id: string;                    // UUID
  phone: string;                 // Normalized: +972XXXXXXXXX
  name: string | null;           // Extracted from conversation
  child_name: string | null;     // Student's name
  child_grade: string | null;    // Grade level
  subjects: string[];            // Subjects of interest
  state: LeadState;              // new|engaged|qualified|booked|converted|lost
  qualification_score: number;   // 0-100
  source: string;                // whatsapp
  last_message_at: Date;         // For 24h window tracking
  calendly_event_id: string | null;
  created_at: Date;
  updated_at: Date;
}
```

**Message Model (`src/models/message.model.ts`)**

```typescript
interface Message {
  id: string;
  lead_id: string;
  direction: 'inbound' | 'outbound';
  content: string;
  message_type: 'text' | 'template' | 'image' | 'audio';
  whatsapp_message_id: string | null;
  tokens_used: number | null;
  created_at: Date;
}
```

**FollowUp Model (`src/models/followup.model.ts`)**

```typescript
interface FollowUp {
  id: string;
  lead_id: string;
  type: 'initial_24h' | 'reminder_72h' | 'final_7d';
  status: 'pending' | 'sent' | 'cancelled' | 'window_expired';
  scheduled_at: Date;
  sent_at: Date | null;
  message_id: string | null;
  created_at: Date;
}
```

**Analytics Model (`src/models/analytics.model.ts`)**

```typescript
interface AnalyticsEvent {
  id: string;
  event_type: string;           // message_received, response_sent, lead_qualified, etc.
  lead_id: string | null;
  metadata: Record<string, any>;
  created_at: Date;
}
```

---

### services/ - Business Logic

**LeadService (`src/services/lead.service.ts`)**

Core lead management operations:

```typescript
// Key methods
findOrCreate(phone: string): Promise<Lead>
findById(id: string): Promise<Lead | null>
findByPhone(phone: string): Promise<Lead | null>
updateState(id: string, state: LeadState): Promise<Lead>
updateQualification(id: string, score: number, data: Partial<Lead>): Promise<Lead>
getLeadsForFollowUp(): Promise<Lead[]>
```

**MessageService (`src/services/message.service.ts`)**

Conversation management:

```typescript
// Key methods
saveMessage(data: CreateMessageInput): Promise<Message>
getConversationHistory(leadId: string, limit?: number): Promise<Message[]>
getMessageCount(leadId: string): Promise<number>
```

**ClaudeService (`src/services/claude.service.ts`)**

AI integration with Hebrew optimization:

```typescript
// Key methods
generateResponse(lead: Lead, conversationHistory: Message[], newMessage: string): Promise<{
  response: string;
  tokensUsed: number;
}>

// System prompt includes:
// - Business context (Ask ROIE tutoring)
// - Hebrew language instructions
// - Response guidelines
// - Qualification triggers
```

**WhatsAppService (`src/services/whatsapp.service.ts`)**

WhatsApp Cloud API integration:

```typescript
// Key methods
sendMessage(to: string, message: string): Promise<string>  // Returns message_id
verifyWebhook(mode: string, token: string, challenge: string): string | null
parseWebhookPayload(body: any): WebhookMessage | null
isWithin24HourWindow(lastMessageAt: Date | null): boolean
```

**CalendlyService (`src/services/calendly.service.ts`)**

Calendly API integration:

```typescript
// Key methods
getRecentBookings(since: Date): Promise<CalendlyEvent[]>
extractPhoneFromInvitee(invitee: CalendlyInvitee): string | null
```

---

### api/ - REST Endpoints

**Webhook Routes (`src/api/routes/whatsapp.routes.ts`)**

```
GET  /webhook/whatsapp     - Webhook verification (Meta setup)
POST /webhook/whatsapp     - Receive incoming messages
```

**Admin Routes (`src/api/routes/admin.routes.ts`)**

```
GET  /admin/health         - Detailed health check
GET  /admin/leads          - List leads (with filters)
GET  /admin/leads/:id      - Get single lead with messages
PUT  /admin/leads/:id      - Update lead
GET  /admin/analytics      - Analytics summary
```

**Middleware:**
- `auth.ts` - Basic Auth for admin routes
- `error-handler.ts` - Centralized error handling
- `request-logger.ts` - Request/response logging

---

### workers/ - Background Jobs

**Scheduler (`src/workers/scheduler.ts`)**

Cron-based job scheduling:

```typescript
// Schedules
'*/5 * * * *'     - Queue pending follow-ups (every 5 min)
'2,7,12... * * *' - Poll Calendly bookings (every 5 min, offset)
```

**Follow-up Worker (`src/workers/followup.worker.ts`)**

Processes follow-up queue:

```typescript
// Job data
{ leadId: string, followUpId: string, type: FollowUpType }

// Processing steps:
1. Load lead and follow-up from DB
2. Check 24h window
3. Generate contextual message
4. Send via WhatsApp
5. Update status
```

**Calendly Worker (`src/workers/calendly.worker.ts`)**

Polls for bookings:

```typescript
// Job data
{ since: Date }  // Poll window start

// Processing steps:
1. Fetch events from Calendly
2. For each event, extract phone
3. Match to leads
4. Update lead state to 'booked'
```

---

### utils/ - Helpers

**Logger (`src/utils/logger.ts`)**

Winston-based structured logging:

```typescript
// Log levels: error, warn, info, debug
// Format: JSON in production, colorized in development
// Includes: timestamp, level, message, metadata

logger.info('Message sent', { leadId, messageId, tokens });
```

**Phone Normalizer (`src/utils/phone.ts`)**

Israeli phone number normalization:

```typescript
normalizePhone('0501234567')    // → '+972501234567'
normalizePhone('+972501234567') // → '+972501234567'
normalizePhone('972501234567')  // → '+972501234567'
```

**Validators (`src/utils/validators.ts`)**

Input validation using Zod:

```typescript
validateCreateLeadInput(data): { valid: boolean, errors?: string[] }
validateUpdateLeadInput(data): { valid: boolean, errors?: string[] }
validateMessageInput(data): { valid: boolean, errors?: string[] }
```

---

## 5. Key Features

### Hebrew Language Support

The Claude system prompt is optimized for Hebrew:
- Instructions to respond in Hebrew
- Understanding of Israeli education system (grades 1-12)
- Cultural context for tutoring expectations
- Hebrew-specific formatting

### Auto-Qualification Algorithm

Leads are automatically scored based on:

| Signal | Points | Detection |
|--------|--------|-----------|
| Child's age | +20 | Regex for age patterns |
| Grade level | +15 | "כיתה א׳/ב׳/ג׳..." |
| Subject mention | +20 | מתמטיקה, אנגלית, etc. |
| Pricing inquiry | +15 | "מחיר", "עלות", "כמה" |
| Scheduling interest | +15 | "מתי", "שעות", "זמינות" |
| Urgency signals | +10 | "דחוף", "מהר", "בקרוב" |
| Engagement depth | +5/msg | Up to +20 points |

### 24-Hour WhatsApp Window Awareness

WhatsApp Business API has a 24-hour messaging window:
- Free-form messages allowed within 24h of user's last message
- After 24h, only pre-approved templates can be sent
- System tracks `last_message_at` for each lead
- Follow-ups respect window; mark as `window_expired` if outside

### Idempotency (Duplicate Prevention)

WhatsApp may send the same webhook multiple times:
- Each message has a unique `whatsapp_message_id`
- Redis stores processed message IDs (TTL: 24h)
- Duplicate webhooks return 200 OK without processing

### Progressive Lead Profiling

Information is extracted incrementally:
- First message: Create lead with phone only
- Subsequent messages: Extract name, child info, subjects
- AI updates profile based on conversation context
- No upfront forms required

### Automatic Follow-ups

Three-stage follow-up sequence:

| Stage | Timing | Purpose |
|-------|--------|---------|
| initial_24h | +24 hours | Re-engage after initial contact |
| reminder_72h | +72 hours | Gentle reminder with value prop |
| final_7d | +7 days | Final outreach before marking lost |

### Calendly Integration

Automatic booking detection:
- Polls Calendly every 5 minutes
- Matches bookings by phone number
- Updates lead state to "booked"
- Logs analytics event

---

## 6. Design Decisions

### TypeScript (Type Safety)

**Why TypeScript over JavaScript?**
- Catch errors at compile time, not runtime
- Better IDE support (autocomplete, refactoring)
- Self-documenting code with interfaces
- Required for production-grade systems

### PostgreSQL (Relational Data)

**Why PostgreSQL over MongoDB/NoSQL?**
- Lead data has clear relationships (lead → messages, follow-ups)
- Need ACID transactions for state changes
- Complex queries for analytics
- Mature, battle-tested database

### Redis + BullMQ (Reliable Job Processing)

**Why BullMQ over simple setTimeout?**
- Jobs survive server restarts
- Built-in retry with backoff
- Concurrency control
- Job progress tracking
- Dead letter queue for failed jobs

### Railway (Easy Deployment)

**Why Railway over AWS/Heroku?**
- Simple GitHub integration
- Automatic deployments on push
- Built-in PostgreSQL and Redis
- Reasonable pricing for small scale
- Good developer experience

### Zod (Runtime Validation)

**Why Zod over Joi/Yup?**
- TypeScript-first design
- Type inference from schemas
- Composable schemas
- Better error messages
- Smaller bundle size

### Winston (Structured Logging)

**Why Winston over console.log?**
- JSON format for log aggregation
- Log levels for filtering
- Transport flexibility (file, cloud)
- Metadata attachment
- Production-ready

---

## 7. Production Readiness Features

### Health Checks

Three-tier health check system:

```
GET /health       - Basic check (is process running?)
GET /health/live  - Liveness probe (should container be restarted?)
GET /health/ready - Readiness probe (can we accept traffic?)
```

Readiness check verifies:
- PostgreSQL connection
- Redis connection

### Error Handling

Seven custom error classes:

```typescript
ValidationError     // 400 - Invalid input
UnauthorizedError   // 401 - Missing/invalid auth
ForbiddenError      // 403 - Insufficient permissions
NotFoundError       // 404 - Resource not found
ConflictError       // 409 - Duplicate resource
RateLimitError      // 429 - Too many requests
InternalError       // 500 - Server error
```

Centralized error handler:
- Converts errors to consistent JSON format
- Logs errors with stack trace
- Hides internal details in production

### Request Logging

Every request logged with:
- Method, URL, status code
- Response time
- Request ID (for tracing)
- User agent
- IP address (if needed)

Health check routes excluded to reduce noise.

### Token Tracking & Cost Calculation

Every Claude API call records:
- Input tokens
- Output tokens
- Total tokens
- Estimated cost

Enables:
- Per-lead cost tracking
- Monthly cost reports
- Optimization insights

### Graceful Shutdown

On SIGTERM/SIGINT:
1. Stop accepting new connections
2. Complete in-flight requests
3. Close database connections
4. Close Redis connections
5. Exit cleanly

30-second timeout for forced shutdown.

### Auto-Restart on Failure

Railway configuration:
```json
{
  "restartPolicyType": "ON_FAILURE",
  "restartPolicyMaxRetries": 10
}
```

### Database Connection Pooling

PostgreSQL connection pool:
- Min connections: 2
- Max connections: 10
- Idle timeout: 30s
- Connection timeout: 10s

---

## 8. Strengths & Weaknesses

### Strengths

| Strength | Description |
|----------|-------------|
| Enterprise-grade architecture | Clean separation of concerns, service layer, proper error handling |
| Production-ready error handling | 7 custom error classes, centralized handler, proper logging |
| Scalable design | Workers can scale independently, stateless API layer |
| Hebrew optimization | System prompt tuned for Hebrew, Israeli phone handling |
| Cost tracking | Every AI call tracked with token counts |
| Full audit trail | Analytics events for all significant actions |
| Resilient job processing | BullMQ with retries, dead letter queue |
| Type safety | TypeScript throughout, Zod validation |

### Weaknesses

| Weakness | Impact | Mitigation |
|----------|--------|------------|
| No conversation caching | Each response loads full history from DB | Add Redis cache for active conversations |
| Single-threaded workers | Can't parallelize within worker | Scale horizontally with multiple instances |
| No rate limiting on admin API | Potential for abuse | Add express-rate-limit middleware |
| Hebrew only | Can't serve English-speaking customers | Add language detection and multi-lang prompts |
| Manual migrations | Schema changes require manual SQL | Add Prisma or Knex migrations |
| No unit tests | Harder to refactor safely | Add Jest test suite |
| No CI/CD pipeline | Manual deployment verification | Add GitHub Actions |

---

## 9. Future Improvements

### Near-term (v1.1)

- [ ] **Conversation Caching**: Redis cache for last 10 messages per lead
- [ ] **Rate Limiting**: Add express-rate-limit to admin routes
- [ ] **Unit Tests**: Jest tests for services and utils
- [ ] **CI/CD Pipeline**: GitHub Actions for lint, test, deploy

### Mid-term (v1.5)

- [ ] **Multi-language Support**: Language detection, English/Russian prompts
- [ ] **Admin Dashboard**: React-based admin panel
- [ ] **Template Messages**: Support for WhatsApp templates (outside 24h window)
- [ ] **Image/Audio Support**: Handle non-text messages

### Long-term (v2.0)

- [ ] **SMS/Telegram Adapters**: Multi-channel communication
- [ ] **A/B Testing Framework**: Test different prompts and follow-up sequences
- [ ] **Conversation Analytics Dashboard**: Visualize metrics
- [ ] **CRM Integration**: Sync with Salesforce/HubSpot
- [ ] **Voice Call Handling**: Integrate with telephony provider

---

## 10. API Reference

### Health Endpoints

#### GET /health
Basic health check.

**Response 200:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600
}
```

#### GET /health/live
Liveness probe for container orchestration.

**Response 200:**
```json
{
  "status": "ok"
}
```

#### GET /health/ready
Readiness probe checking database connections.

**Response 200:**
```json
{
  "status": "ready",
  "postgres": "connected",
  "redis": "connected"
}
```

**Response 503:**
```json
{
  "status": "not ready",
  "postgres": "disconnected",
  "redis": "connected"
}
```

---

### Webhook Endpoints

#### GET /webhook/whatsapp
Webhook verification for Meta setup.

**Query Parameters:**
- `hub.mode`: Must be "subscribe"
- `hub.verify_token`: Must match WHATSAPP_WEBHOOK_VERIFY_TOKEN
- `hub.challenge`: Challenge string to echo back

**Response 200:** Returns `hub.challenge` value

**Response 403:** Token mismatch

#### POST /webhook/whatsapp
Receive incoming WhatsApp messages.

**Headers:**
- `X-Hub-Signature-256`: HMAC signature (optional validation)

**Body:** WhatsApp webhook payload

**Response 200:**
```json
{
  "status": "processed"
}
```

---

### Admin Endpoints

All admin endpoints require Basic Authentication.

**Header:** `Authorization: Basic base64(username:password)`

#### GET /admin/health
Detailed system health check.

**Response 200:**
```json
{
  "status": "healthy",
  "uptime": 3600,
  "memory": {
    "used": 50000000,
    "total": 100000000
  },
  "database": {
    "postgres": "connected",
    "redis": "connected"
  }
}
```

#### GET /admin/leads
List leads with optional filters.

**Query Parameters:**
- `state`: Filter by state (new|engaged|qualified|booked|converted|lost)
- `limit`: Max results (default: 50)
- `offset`: Pagination offset (default: 0)

**Response 200:**
```json
{
  "leads": [
    {
      "id": "uuid",
      "phone": "+972501234567",
      "name": "שרה",
      "state": "qualified",
      "qualification_score": 75,
      "created_at": "2024-01-15T10:00:00.000Z"
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

#### GET /admin/leads/:id
Get single lead with conversation history.

**Response 200:**
```json
{
  "lead": {
    "id": "uuid",
    "phone": "+972501234567",
    "name": "שרה",
    "child_name": "יוסי",
    "child_grade": "ד׳",
    "subjects": ["מתמטיקה"],
    "state": "qualified",
    "qualification_score": 75,
    "last_message_at": "2024-01-15T10:30:00.000Z",
    "created_at": "2024-01-15T10:00:00.000Z"
  },
  "messages": [
    {
      "id": "uuid",
      "direction": "inbound",
      "content": "שלום, מחפשת מורה פרטי למתמטיקה",
      "created_at": "2024-01-15T10:00:00.000Z"
    }
  ],
  "followUps": [
    {
      "id": "uuid",
      "type": "initial_24h",
      "status": "pending",
      "scheduled_at": "2024-01-16T10:00:00.000Z"
    }
  ]
}
```

**Response 404:**
```json
{
  "error": "Lead not found"
}
```

#### PUT /admin/leads/:id
Update lead information.

**Body:**
```json
{
  "name": "שרה כהן",
  "state": "qualified",
  "qualification_score": 80
}
```

**Response 200:**
```json
{
  "lead": { ... }
}
```

#### GET /admin/analytics
Analytics summary.

**Query Parameters:**
- `from`: Start date (ISO format)
- `to`: End date (ISO format)

**Response 200:**
```json
{
  "period": {
    "from": "2024-01-01T00:00:00.000Z",
    "to": "2024-01-31T23:59:59.000Z"
  },
  "leads": {
    "total": 150,
    "by_state": {
      "new": 30,
      "engaged": 50,
      "qualified": 40,
      "booked": 20,
      "converted": 10
    }
  },
  "messages": {
    "total": 1500,
    "inbound": 800,
    "outbound": 700
  },
  "tokens": {
    "total": 500000,
    "estimated_cost_usd": 7.50
  }
}
```

---

## 11. Environment Variables Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `ANTHROPIC_API_KEY` | Claude API key | `sk-ant-...` |
| `ADMIN_USERNAME` | Admin panel username | `admin` |
| `ADMIN_PASSWORD` | Admin panel password (min 8 chars) | `SecurePass123!` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment mode | `development` |
| `LOG_LEVEL` | Winston log level | `info` |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta phone number ID | `''` |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta business account ID | `''` |
| `WHATSAPP_ACCESS_TOKEN` | Meta access token | `''` |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Webhook verification token | `''` |
| `CALENDLY_ACCESS_TOKEN` | Calendly API token | `''` |
| `CALENDLY_ORGANIZATION_URI` | Calendly organization URI | `''` |
| `CALENDLY_EVENT_TYPE_URI` | Calendly event type URI | `''` |

---

## 12. Deployment Guide

### Railway Deployment (Recommended)

#### Prerequisites
1. GitHub repository with code
2. Railway account (https://railway.app)
3. Anthropic API key

#### Step 1: Create Railway Project
1. Go to Railway Dashboard
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Authorize Railway and select your repository

#### Step 2: Add PostgreSQL
1. In project, click "New"
2. Select "Database" → "Add PostgreSQL"
3. Copy `DATABASE_URL` from Variables tab

#### Step 3: Add Redis
1. Click "New" → "Database" → "Add Redis"
2. Copy `REDIS_URL` from Variables tab

#### Step 4: Configure Environment Variables
1. Click on your service
2. Go to "Variables" tab
3. Add required variables:
   - `DATABASE_URL` (from PostgreSQL)
   - `REDIS_URL` (from Redis)
   - `ANTHROPIC_API_KEY`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`

#### Step 5: Deploy
1. Railway auto-deploys on push to main
2. Check "Deployments" tab for status
3. Once deployed, click "Settings" → "Domains"
4. Generate domain or add custom domain

#### Step 6: Configure WhatsApp Webhook
1. Go to Meta Developer Console
2. Add webhook URL: `https://your-domain.railway.app/webhook/whatsapp`
3. Add verification token (same as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`)
4. Subscribe to messages

### Health Check Verification

After deployment, verify:

```bash
# Basic health
curl https://your-domain.railway.app/health

# Readiness (database connections)
curl https://your-domain.railway.app/health/ready

# Admin API (with auth)
curl -u admin:yourpassword https://your-domain.railway.app/admin/health
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Deployment fails | Check build logs; ensure TypeScript compiles |
| Health check fails | Verify DATABASE_URL and REDIS_URL are set |
| Webhook returns 403 | Verify WHATSAPP_WEBHOOK_VERIFY_TOKEN matches Meta |
| No AI responses | Check ANTHROPIC_API_KEY is valid |
| Messages not saving | Check PostgreSQL connection and migrations |

---

## Appendix: File Structure

```
ask-roie-bot/
├── src/
│   ├── api/
│   │   ├── controllers/
│   │   │   ├── admin.controller.ts
│   │   │   └── whatsapp.controller.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   ├── error-handler.ts
│   │   │   └── request-logger.ts
│   │   └── routes/
│   │       ├── admin.routes.ts
│   │       └── whatsapp.routes.ts
│   ├── config/
│   │   └── index.ts
│   ├── database/
│   │   ├── connection.ts
│   │   └── migrations/
│   │       └── 001_initial_schema.sql
│   ├── models/
│   │   ├── analytics.model.ts
│   │   ├── followup.model.ts
│   │   ├── lead.model.ts
│   │   └── message.model.ts
│   ├── services/
│   │   ├── calendly.service.ts
│   │   ├── claude.service.ts
│   │   ├── lead.service.ts
│   │   ├── message.service.ts
│   │   └── whatsapp.service.ts
│   ├── utils/
│   │   ├── logger.ts
│   │   ├── phone.ts
│   │   └── validators.ts
│   ├── workers/
│   │   ├── calendly.worker.ts
│   │   ├── followup.worker.ts
│   │   ├── queue.ts
│   │   └── scheduler.ts
│   └── server.ts
├── .env.example
├── .gitignore
├── docker-compose.yml
├── DOCUMENTATION.md
├── package.json
├── Procfile
├── railway.json
├── README.md
└── tsconfig.json
```

---

*Documentation generated for Ask ROIE Bot v1.0.0*
*Last updated: January 2024*
