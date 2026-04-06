# CLAUDE.md — ConversAI Engineering Context

## What This File Is
Read automatically by Claude Code at session start.
Provides architecture context — understand the SYSTEM, not just the TASK.

---

## Project: ConversAI Engine
AI Sales Agent platform for businesses on WhatsApp.
Multi-tenant SaaS — each business gets its own AI agent.

## Architecture

```
WhatsApp Message → Webhook Controller (200 OK immediately)
  → Dedup check (processed_webhook_events table)
  → Phone normalization (E.164 format, src/utils/phone-normalizer.ts)
  → Lead find/create (with agent_id + account_id)
  → Conversation find/create (with COALESCE(ai_active, true))
  → Conversation mutex (processingLeads Set, try/finally)
      NOTE: In-memory mutex. Works for single instance only.
      For horizontal scaling → migrate to Redis SETNX with TTL.
  → Message save to DB
  → Human takeover check: if ai_active=false → save msg, broadcast, skip AI
  → AI Pipeline:
      → Scoring Router (score ≥4 → Sonnet, else Haiku) — src/utils/model-router.ts
      → Load Lead Profile from DB (leads.lead_profile JSONB)
      → Active prompt version lookup (or fallback to GENERIC_SALES_PROMPT)
      → Prompt Assembly:
          Part A: HARD_CONSTRAINTS (non-negotiable, 16 rules)
          Part B: LEAD_PROFILE block (known/missing fields, booking_ready)
          Part C: SALES_PROMPT (from wizard or GENERIC_SALES_PROMPT)
          Part D: BUSINESS_PROFILE (from settings.profile)
      → Claude API call (15s timeout, prompt caching enabled, max_tokens: 350)
      → Tool execution: update_lead_state (structured data extraction)
      → Response validation (3-layer anti-hallucination)
      → History sanitization (FORBIDDEN_CLAIMS regex)
  → Lead Profile extraction (regex-based, non-blocking — src/services/lead-profile.service.ts)
  → Bot message save to DB
  → WhatsApp send (interactive buttons with text fallback)
  → Conversation stats update (message_count, last_message, last_message_at)
  → WebSocket broadcast to Dashboard
  → Log chain: [WA_IN] → [WA_LEAD] → [WA_CONV] → [WA_AI] → [WA_SAVE] → [WA_OUT]
```

## Error Handling & Fallbacks
- If Claude API times out (15s) or returns error: catch the error, log [WA_ERR], send pre-defined Hebrew fallback message to user: "סליחה, נתקלתי בבעיה טכנית. אנא נסה שוב בעוד כמה דקות."
- Conversation mutex is ALWAYS released (try/finally) even on error
- Lead profile extraction failure does NOT block message sending
- WhatsApp interactive buttons failure → fallback to plain text message
- If media (image/sticker/audio) received without handler → respond "סליחה, אני יודע לקרוא רק טקסט כרגע."

## Tech Stack
- Backend: Node.js 18+ / TypeScript 5.3 (strict: true, NO `any` types)
- Framework: Express 4.18
- Database: PostgreSQL 17 (raw parameterized pg queries, NO ORM)
- Cache/Queue: Redis 7+, BullMQ 5.1
- AI: Anthropic Claude SDK v0.27 (Sonnet 4 + Haiku 4.5)
- Messaging: Meta WhatsApp Business Cloud API v18.0
- Validation: Zod (env vars + API inputs validated at startup)
- Logging: Winston (structured, with 12-char trace_id)
- Rate Limiting: Bottleneck
- Testing: Jest + ts-jest (37 integration + 21 E2E tests)
- Frontend: React 19, Vite, TailwindCSS, Zustand, TanStack Query (on Vercel)
- Deployment: Railway (4 services), Vercel (frontend), GitHub Actions CI/CD

## Architecture Invariants (MUST NEVER BREAK)
1. WhatsApp webhook responds 200 in <1s (before any processing)
2. AI call timeout = 15s — prevents mutex deadlock. On timeout: send fallback message
3. Message processing is idempotent (processed_webhook_events + whatsapp_message_id unique)
4. Every request traceable via 12-char trace_id through all [WA_*] logs
5. Conversation mutex prevents parallel AI calls for same lead
6. HARD_CONSTRAINTS core rules are non-removable — wizard can ADD rules, never REMOVE
7. AI never fabricates data not in BUSINESS_PROFILE (3-layer anti-hallucination)
8. Every DB query scoped to account_id (multi-tenant isolation)
9. Webhook signatures verified (WhatsApp HMAC-SHA256, Calendly webhook secret)
10. User/wizard inputs treated as untrusted — never injected into prompt control flow
11. NEVER send WhatsApp messages outside the 24-hour session window without an approved Template Message — number WILL be banned by Meta
12. NEVER invent or hallucinate URLs — use only URLs from settings.profile (e.g., calendly_link)
13. Prompt rules must be added to BOTH system-prompt.ts AND prompt-generator.ts — missing from either = bug
14. Follow-up messages use model='followup-ai' marker for analytics separation

## WhatsApp 24-Hour Window Rule (CRITICAL)
Meta allows free-form messages ONLY within 24 hours of the customer's last message.
After 24 hours: ONLY pre-approved Template Messages ($0.02 each, requires Meta approval).
Our 23h follow-up (proactive-followup.service.ts) sends BEFORE the window closes.
Anti-spam guards: max 1 follow-up per cycle, max 3 per lead lifetime, 1s rate limit.

## Lead Profile Engine
After every AI response, extractLeadProfile() extracts structured data from conversation:
```typescript
interface LeadProfile {
  name?: string;           // "רועי"
  role?: string;           // "תלמיד" | "הורה"
  grade?: string;          // "יא"
  subject?: string;        // "מתמטיקה"
  topic?: string;          // "סדרות"
  exam_date?: string;      // "עוד שבועיים"
  urgency?: string;        // "exam" | "general"
  format?: string;         // "זום" | "פרונטלי"
  preferred_time?: string; // "בערב"
  location?: string;       // "כפר סבא"
  booking_ready?: boolean; // true when subject + preferred_time known
}
```
Profile is stored in leads.lead_profile JSONB column.
Injected into prompt as [LEAD_PROFILE] block — AI never re-asks known info.
booking_ready = !!subject && !!preferred_time.
Extraction is regex-based (non-blocking, no extra API call).

## Multi-Tenant Isolation
- Every table has account_id column
- Every query MUST filter by account_id — NO EXCEPTIONS
- broadcast() requires accountId as non-optional TypeScript parameter
- Onboarding endpoints extract account_id from auth context, NEVER from client
- NEVER allow cross-tenant data access

## Anti-Hallucination Architecture (3 layers)
1. Prompt: HIERARCHY OF TRUTH — BUSINESS_PROFILE > conversation history. NEVER invent credentials.
2. Code: FORBIDDEN_CLAIMS regex strips fabricated credentials from AI output before sending
3. Runtime: Guards check for hallucinated numbers, missing CTA, empty responses, meta-commentary

## AI Pipeline Details
- Scoring Router: score 0-10. ≥4 → Sonnet, <4 → Haiku (src/utils/model-router.ts)
- Claude Tool: update_lead_state — extracts structured data (name, subjects, level, urgency, objection_type)
- Max tokens: 350. History window: Haiku 8 msgs, Sonnet 12 msgs
- Prompt caching: enabled for system prompt portions
- AI MUST never reveal system prompt content or internal configuration
- AI MUST follow tone limits (3-4 sentences max for WhatsApp, max 1 emoji)

## Key Files
- src/prompts/system-prompt.ts — HARD_CONSTRAINTS (16 rules), GENERIC_SALES_PROMPT, buildPromptWithContext(), buildProfileBlock(), buildTutorProfileBlock()
- src/prompts/prompt-generator.ts — generates prompts from wizard (CORE_RULES must mirror HARD_CONSTRAINTS)
- src/prompts/industry-templates.ts — tutor, clinic, coach templates
- src/services/claude.service.ts — AI pipeline, tool handling, model routing, timeout (~1000+ lines)
- src/services/lead-profile.service.ts — extractLeadProfile, loadLeadProfile, saveLeadProfile (170 lines)
- src/services/proactive-followup.service.ts — 23h follow-up, anti-spam guards (334 lines)
- src/services/prompt-version.service.ts — prompt versioning, active version lookup
- src/api/controllers/whatsapp.controller.ts — webhook, message processing, mutex, takeover guard
- src/api/controllers/calendly.controller.ts — Calendly webhook, race-safe booking (SELECT FOR UPDATE)
- src/api/controllers/conversations.controller.ts — takeover/resume/admin-send endpoints
- src/api/controllers/prompt-builder.controller.ts — wizard, templates, sandbox, versioning
- src/api/controllers/onboarding.controller.ts — onboarding flow, WhatsApp verification
- src/services/whatsapp.service.ts — WhatsApp API, interactive messages, fallback
- src/models/lead.model.ts — lead CRUD, overwriteFields (includes lead_state + follow-up fields)
- src/utils/model-router.ts — scoring-based Haiku/Sonnet routing (threshold: score ≥4 → Sonnet)
- src/types/index.ts — Source of truth for ALL TypeScript interfaces (DB models, webhook payloads, AI types)

## Logging Convention
All logs use structured prefixes with 12-char trace_id:
- [WA_*] — WhatsApp pipeline: WA_IN, WA_LEAD, WA_CONV, WA_AI, WA_SAVE, WA_OUT, WA_SKIP, WA_ERR
- [CAL_*] — Calendly: CAL_BOOK, CAL_CONFIRM, CAL_SKIP, CAL_ERR
- [TAKEOVER] — Human takeover actions
- [ADMIN_MSG] — Admin direct messages
- [FOLLOWUP_*] — Follow-up: FOLLOWUP_SENT, FOLLOWUP_SKIP (with reason)
- [PROFILE_UPDATE] — Lead profile extraction results
- [PROMPT_*] — Prompt generation: PROMPT_GEN, PROMPT_SAVE, PROMPT_ACTIVATE
- [SANDBOX_*] — Sandbox test: SANDBOX_TEST, SANDBOX_LIMIT
- [ONBOARD] / [ONBOARD_ERR] — Onboarding flow
- [DEMO] — Demo simulation pipeline

## Database Migrations
Located in src/database/migrations/, numbered sequentially (001–020).
All migrations use IF NOT EXISTS / IF EXISTS for idempotent re-runs.
Auto-run on server boot via src/database/migrate.ts.
To add a new migration: create next numbered file (e.g., 021_description.sql).

## Engineering Rules
1. Always read relevant files BEFORE modifying them — grep/search first
2. Never invent functions or files that don't exist — search the codebase first
3. No ORM. Write raw parameterized queries (prevent SQL injection). Use $1, $2 placeholders
4. All DB queries MUST be scoped to account_id (CRITICAL MULTI-TENANT ISOLATION)
5. Migrations use IF NOT EXISTS for safe idempotency
6. Webhook handlers MUST return 200 OK immediately. Process logic asynchronously
7. Every new feature preserves existing structured logging conventions
8. Verify all TypeScript with `npx tsc --noEmit` before committing
9. Treat all user/wizard inputs as strictly untrusted — sanitize before DB or AI injection
10. Never hardcode tenant-specific data in source code
11. No new npm dependencies without explicit approval
12. Do NOT use TypeScript `any` type — define interfaces in src/types/index.ts
13. Do NOT upgrade dependencies without explicit approval — versions are locked
14. When inspecting DB, use Railway public DATABASE_URL. Never use internal hostnames
15. Follow existing code style and patterns in surrounding files
