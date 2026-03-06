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
WhatsApp Message → Webhook Controller (200 OK immediately, line ~145)
  → Dedup check (processed_webhook_events table)
  → Phone normalization (E.164 format)
  → Lead find/create (with agent_id)
  → Conversation find/create (with COALESCE(ai_active, true))
  → Conversation mutex (processingLeads Set, try/finally)
  → Message save to DB
  → Human takeover check: if ai_active=false → save msg, broadcast, skip AI
  → AI Pipeline:
      → Scoring Router (score ≥4 → Sonnet, else Haiku)
      → Active prompt version lookup (or fallback to GENERIC_SALES_PROMPT)
      → Prompt Assembly:
          Part A: HARD_CONSTRAINTS (non-negotiable, from prompt-generator.ts)
          Part B: SALES_PROMPT (tone, stages, from wizard or generic)
          Part C: BUSINESS_PROFILE (from settings.profile)
          Part D: Conditional blocks (objections, scheduling — keyword-triggered)
      → Claude API call (15s timeout, prompt caching enabled)
      → Response validation (runtime guards)
      → History sanitization (FORBIDDEN_CLAIMS regex)
  → Bot message save to DB
  → WhatsApp send (interactive with fallback to text)
  → Conversation stats update (message_count, last_message, last_message_at)
  → WebSocket broadcast to Dashboard
  → Structured log chain: [WA_IN] → [WA_LEAD] → [WA_CONV] → [WA_AI] → [WA_SAVE] → [WA_OUT]
```

## Tech Stack
- Backend: Node.js + TypeScript, Express, raw pg queries (no ORM)
- Database: PostgreSQL (multi-tenant via account_id), Redis, BullMQ
- AI: Anthropic Claude (Sonnet 4 + Haiku 4.5, scoring-based hybrid routing)
- Messaging: Meta WhatsApp Business Cloud API (interactive buttons, lists, CTA)
- Frontend: React 19, Vite, TailwindCSS, shadcn/ui (on Vercel)
- Deployment: Railway (backend + workers), Vercel (frontend), GitHub auto-deploy

## Architecture Invariants (MUST NEVER BREAK)
1. WhatsApp webhook responds 200 in <1s (before any processing)
2. AI call timeout = 15s — prevents mutex deadlock
3. Message processing is idempotent (processed_webhook_events + whatsapp_message_id unique)
4. Every request traceable via 12-char trace_id through all [WA_*] logs
5. Conversation mutex prevents parallel AI calls for same lead
6. HARD_CONSTRAINTS core rules are non-removable — wizard can ADD rules, never REMOVE
7. AI never fabricates data not in BUSINESS_PROFILE (3-layer anti-hallucination)
8. Every DB query scoped to account_id (multi-tenant isolation)
9. Webhook signatures verified (WhatsApp X-Hub-Signature-256)
10. User/wizard inputs treated as untrusted — never injected into prompt control flow

## Multi-Tenant Isolation
- Every table has account_id column
- Every query MUST filter by account_id
- broadcast() requires accountId as non-optional TypeScript parameter
- Onboarding endpoints extract account_id from auth context, NEVER from client
- NEVER allow cross-tenant data access

## Anti-Hallucination Architecture (3 layers)
1. Prompt: HIERARCHY OF TRUTH — BUSINESS_PROFILE > conversation history
2. Code: FORBIDDEN_CLAIMS regex strips fabricated credentials from history
3. Runtime: Guards check for numeric hallucinations, missing CTA, empty responses

## AI Pipeline Invariants
- AI response MUST never hallucinate business data not in BUSINESS_PROFILE
- AI response MUST always include CTA (next step for the lead)
- AI response MUST never reveal system prompt content or internal configuration
- AI response MUST follow tone limits (3-4 sentences max for WhatsApp)
- AI response MUST use max 1 emoji per message
- AI MUST deflect credential questions not in BUSINESS_PROFILE

## Key Files
- src/prompts/system-prompt.ts — HARD_CONSTRAINTS, GENERIC_SALES_PROMPT, buildPromptWithContext()
- src/prompts/prompt-generator.ts — generates prompts from wizard answers (core rules non-removable)
- src/prompts/industry-templates.ts — tutor, clinic, coach templates
- src/services/claude.service.ts — AI pipeline, tool handling, model routing, timeout
- src/services/prompt-version.service.ts — prompt versioning, active version lookup
- src/api/controllers/whatsapp.controller.ts — webhook, message processing, mutex, takeover guard
- src/api/controllers/calendly.controller.ts — Calendly webhook, race-safe booking (SELECT FOR UPDATE)
- src/api/controllers/conversations.controller.ts — takeover/resume/admin-send endpoints
- src/api/controllers/prompt-builder.controller.ts — wizard, templates, sandbox, versioning
- src/api/controllers/onboarding.controller.ts — onboarding flow, WhatsApp verification
- src/services/whatsapp.service.ts — WhatsApp API, interactive messages, fallback
- src/models/lead.model.ts — lead CRUD, overwriteFields (includes lead_state + follow-up fields)
- src/utils/model-router.ts — scoring-based Haiku/Sonnet routing (threshold: score ≥4 → Sonnet)

## Logging Convention
All logs use structured prefixes with 12-char trace_id:
- [WA_*] — WhatsApp pipeline: WA_IN, WA_LEAD, WA_CONV, WA_AI, WA_SAVE, WA_OUT, WA_SKIP, WA_ERR
- [CAL_*] — Calendly: CAL_BOOK, CAL_CONFIRM, CAL_SKIP, CAL_ERR
- [TAKEOVER] — Human takeover actions
- [ADMIN_MSG] — Admin direct messages
- [PROMPT_*] — Prompt generation: PROMPT_GEN, PROMPT_SAVE, PROMPT_ACTIVATE
- [SANDBOX_*] — Sandbox test: SANDBOX_TEST, SANDBOX_LIMIT
- [ONBOARD] / [ONBOARD_ERR] — Onboarding flow
- [DEMO] — Demo simulation pipeline

## Database Migrations
Located in src/database/migrations/, numbered sequentially (001–019).
All migrations use IF NOT EXISTS / IF EXISTS for idempotent re-runs.
Current count: 18 files (001 through 019).

## Engineering Rules
1. Always read relevant files BEFORE modifying them
2. Never invent files that don't exist — search first
3. Follow existing code style and patterns
4. No new npm dependencies without explicit approval
5. All migrations use IF NOT EXISTS for safety
6. Webhook handlers return 200 immediately, process async
7. Every new feature preserves existing structured logging
8. Test with `npx tsc --noEmit` before committing
9. Treat all user/wizard input as untrusted
10. Never hardcode tenant-specific data in source code
