# Production Test Checklist

Comprehensive testing guide for the Ask ROIE bot follow-up automation system.

## Quick Commands

```bash
# Run automated tests
npm run test:e2e           # Full E2E flow test
npm run test:conversation  # Conversation simulation
npm run test:deploy        # Deployment health check

# View logs (Railway)
railway logs -s ask-roie-bot
railway logs -s followup-worker

# Database queries (Railway)
railway run psql $DATABASE_URL
```

---

## Test 1: Complete Booking Flow

**Goal:** Verify the happy path from first contact to booking.

### Steps

- [ ] **User sends:** "היי אני צריך עזרה במתמטיקה"
- [ ] **Bot responds:** Asks diagnostic questions (level, grade, format)
- [ ] **User sends:** "כיתה ט׳"
- [ ] **Bot responds:** Provides value proposition, mentions experience
- [ ] **User sends:** "בוא נקבע"
- [ ] **Bot responds:** Sends Calendly link with button

### Verification

```bash
# Check logs for tool calls
railway logs -s ask-roie-bot | grep "update_lead_state"

# Verify database state
railway run psql $DATABASE_URL -c "
SELECT phone, name, status, subjects, level, trial_offered
FROM leads
WHERE phone = 'USER_PHONE'
ORDER BY updated_at DESC
LIMIT 1;
"
```

### Expected Results

| Field | Expected Value |
|-------|----------------|
| status | `ready_to_book` |
| subjects | `['מתמטיקה']` |
| level | `high_school` |
| trial_offered | `true` |

---

## Test 2: Thinking Flow (Follow-up Scheduling)

**Goal:** Verify follow-up is scheduled when user says they'll think about it.

### Steps

- [ ] Complete initial conversation (user is engaged)
- [ ] **User sends:** "אני אחשוב על זה"
- [ ] **Bot responds:** Acknowledges, optionally includes Calendly link

### Verification

```bash
# Check logs for lead_state change
railway logs -s ask-roie-bot | grep -E "lead_state|follow-up"

# Expected log entries:
# "update_lead_state called" { input: { lead_state: 'thinking' } }
# "lead_state explicitly set" { newLeadState: 'thinking' }
# "Triggering follow-up automation" { newLeadState: 'thinking' }
# "Follow-up scheduled successfully" { type: 'thinking_24h' }
```

```bash
# Verify database state
railway run psql $DATABASE_URL -c "
SELECT
  phone,
  lead_state,
  follow_up_type,
  follow_up_scheduled_at,
  follow_up_count
FROM leads
WHERE phone = 'USER_PHONE';
"
```

### Expected Results

| Field | Expected Value |
|-------|----------------|
| lead_state | `thinking` |
| follow_up_type | `thinking_24h` |
| follow_up_scheduled_at | `[NOW + 24 hours]` |
| follow_up_count | `0` |

```bash
# Verify followup record
railway run psql $DATABASE_URL -c "
SELECT id, type, status, scheduled_for
FROM followups
WHERE lead_id = (SELECT id FROM leads WHERE phone = 'USER_PHONE')
ORDER BY created_at DESC
LIMIT 1;
"
```

| Field | Expected Value |
|-------|----------------|
| type | `thinking_24h` |
| status | `pending` |

---

## Test 3: Follow-up Delivery

**Goal:** Verify follow-up message is actually sent after delay.

### Steps (Fast-Forward Test)

```bash
# 1. Get lead ID
railway run psql $DATABASE_URL -c "
SELECT id FROM leads WHERE phone = 'USER_PHONE';
"

# 2. Fast-forward the scheduled time to NOW
railway run psql $DATABASE_URL -c "
UPDATE leads
SET follow_up_scheduled_at = NOW() - INTERVAL '1 minute'
WHERE phone = 'USER_PHONE';

UPDATE followups
SET scheduled_for = NOW() - INTERVAL '1 minute'
WHERE lead_id = (SELECT id FROM leads WHERE phone = 'USER_PHONE')
  AND status = 'pending';
"
```

- [ ] Wait 2-3 minutes for worker to process
- [ ] **User receives:** Follow-up message with Calendly link

### Verification

```bash
# Check followup-worker logs
railway logs -s followup-worker | grep -E "Processing|Sending|sent"

# Verify database updated
railway run psql $DATABASE_URL -c "
SELECT
  lead_state,
  follow_up_type,
  follow_up_scheduled_at,
  follow_up_count,
  last_followup_sent_at
FROM leads
WHERE phone = 'USER_PHONE';
"
```

### Expected Results

| Field | Expected Value |
|-------|----------------|
| follow_up_type | `NULL` |
| follow_up_scheduled_at | `NULL` |
| follow_up_count | `1` |
| last_followup_sent_at | `[recent timestamp]` |

```bash
# Verify followup record marked as sent
railway run psql $DATABASE_URL -c "
SELECT status, sent_at
FROM followups
WHERE lead_id = (SELECT id FROM leads WHERE phone = 'USER_PHONE')
ORDER BY created_at DESC
LIMIT 1;
"
```

| Field | Expected Value |
|-------|----------------|
| status | `sent` |
| sent_at | `[recent timestamp]` |

---

## Test 4: Cancellation on User Response

**Goal:** Verify follow-up is cancelled when user responds before delivery.

### Steps

1. Schedule a follow-up (Test 2)
2. Before 24 hours pass, **User sends:** "בעצם כן, בוא נקבע שיעור!"

### Verification

```bash
# Check logs for cancellation
railway logs -s ask-roie-bot | grep -E "cancel|Cancelled"

# Expected log:
# "Cancelled all follow-ups for lead" { leadId: '...', jobsCancelled: 1 }
```

```bash
# Verify database cleared
railway run psql $DATABASE_URL -c "
SELECT
  lead_state,
  follow_up_type,
  follow_up_scheduled_at
FROM leads
WHERE phone = 'USER_PHONE';
"
```

### Expected Results

| Field | Expected Value |
|-------|----------------|
| lead_state | `engaged` |
| follow_up_type | `NULL` |
| follow_up_scheduled_at | `NULL` |

```bash
# Verify followup record cancelled
railway run psql $DATABASE_URL -c "
SELECT status
FROM followups
WHERE lead_id = (SELECT id FROM leads WHERE phone = 'USER_PHONE')
ORDER BY created_at DESC
LIMIT 1;
"
```

| Field | Expected Value |
|-------|----------------|
| status | `cancelled` |

---

## Test 5: Max Follow-ups Limit (3)

**Goal:** Verify system blocks 4th follow-up.

### Setup

```bash
# Set follow_up_count to 3 (simulating 3 already sent)
railway run psql $DATABASE_URL -c "
UPDATE leads
SET follow_up_count = 3
WHERE phone = 'USER_PHONE';
"
```

### Steps

- [ ] **User sends:** "אני אחשוב על זה"
- [ ] Bot responds normally

### Verification

```bash
# Check logs for max follow-ups
railway logs -s ask-roie-bot | grep -i "max"

# Expected log:
# "No follow-up scheduled" { reason: 'Max follow-ups reached (3)' }
```

```bash
# Verify no new follow-up scheduled
railway run psql $DATABASE_URL -c "
SELECT
  follow_up_count,
  follow_up_type,
  follow_up_scheduled_at
FROM leads
WHERE phone = 'USER_PHONE';
"
```

### Expected Results

| Field | Expected Value |
|-------|----------------|
| follow_up_count | `3` (unchanged) |
| follow_up_type | `NULL` |
| follow_up_scheduled_at | `NULL` |

### Cleanup

```bash
# Reset for future tests
railway run psql $DATABASE_URL -c "
UPDATE leads SET follow_up_count = 0 WHERE phone = 'USER_PHONE';
"
```

---

## Test 6: Safety Net Keyword Detection

**Goal:** Verify safety net catches thinking phrases even if Claude forgets to set lead_state.

### Steps

- [ ] **User sends:** "צריך זמן לחשוב על זה"
- [ ] Bot responds

### Verification

```bash
# Check logs for safety net activation
railway logs -s ask-roie-bot | grep -i "safety net"

# Expected log:
# "Safety net: User said thinking phrase but Claude did not set lead_state - forcing it"
```

### Expected Results

Even if Claude didn't set `lead_state: 'thinking'`, the safety net should:
- [ ] Detect the thinking phrase
- [ ] Force `lead_state = 'thinking'`
- [ ] Schedule follow-up

---

## Test 7: Opt-Out Blocks Follow-ups

**Goal:** Verify opted-out leads don't receive follow-ups.

### Steps

- [ ] **User sends:** "הסר אותי מהרשימה"
- [ ] Bot confirms opt-out
- [ ] (Later) Try to schedule follow-up

### Verification

```bash
railway run psql $DATABASE_URL -c "
SELECT opted_out, follow_up_scheduled_at
FROM leads
WHERE phone = 'USER_PHONE';
"
```

### Expected Results

| Field | Expected Value |
|-------|----------------|
| opted_out | `true` |
| follow_up_scheduled_at | `NULL` |

---

## Test 8: Human Override Blocks Automation

**Goal:** Verify follow-ups blocked for 48h after human contact.

### Setup

```bash
# Simulate human contacted the lead
railway run psql $DATABASE_URL -c "
UPDATE leads
SET human_contacted_at = NOW()
WHERE phone = 'USER_PHONE';
"
```

### Steps

- [ ] **User sends:** "אני אחשוב על זה"

### Verification

```bash
# Check logs
railway logs -s ask-roie-bot | grep -i "human"

# Expected log:
# "No follow-up scheduled" { reason: 'Human contacted Xh ago (wait 48h)' }
```

### Cleanup

```bash
railway run psql $DATABASE_URL -c "
UPDATE leads SET human_contacted_at = NULL WHERE phone = 'USER_PHONE';
"
```

---

## Automated Test Commands

### Run All Tests

```bash
# Local with Railway env
npm run test:e2e
npm run test:conversation
npm run test:deploy

# Or via Railway
railway run npm run test:e2e
railway run npm run test:conversation
```

### Expected Output

```
============================================================
  E2E TEST: Follow-up Automation (thinking_24h)
============================================================

✅ PostgreSQL connected
✅ Redis connected
✅ Test lead created
✅ Lead state set to "thinking"
✅ Follow-up scheduled
✅ Database verified
✅ ALL TESTS PASSED!
```

---

## Troubleshooting

### Follow-up Not Scheduled

1. **Check logs for errors:**
   ```bash
   railway logs -s ask-roie-bot | grep -i error
   ```

2. **Verify lead eligibility:**
   ```bash
   railway run psql $DATABASE_URL -c "
   SELECT opted_out, lead_state, follow_up_count, human_contacted_at
   FROM leads WHERE phone = 'USER_PHONE';
   "
   ```

3. **Check if Claude called update_lead_state:**
   ```bash
   railway logs -s ask-roie-bot | grep "update_lead_state called"
   ```

### Follow-up Not Delivered

1. **Check followup-worker is running:**
   ```bash
   railway logs -s followup-worker | tail -20
   ```

2. **Check Redis queue:**
   ```bash
   railway run redis-cli ZCARD bull:followup-automation:delayed
   railway run redis-cli LLEN bull:followup-automation:wait
   ```

3. **Check followup record:**
   ```bash
   railway run psql $DATABASE_URL -c "
   SELECT * FROM followups WHERE status = 'pending' ORDER BY scheduled_for;
   "
   ```

### Safety Net Not Triggering

1. **Check exact phrase matching:**
   - Phrases: `אחשוב`, `אעדכן`, `צריך זמן`, `צריך לחשוב`, `אחזור אליך`

2. **Verify user message contains phrase:**
   ```bash
   railway run psql $DATABASE_URL -c "
   SELECT content FROM messages
   WHERE lead_id = (SELECT id FROM leads WHERE phone = 'USER_PHONE')
   ORDER BY created_at DESC LIMIT 5;
   "
   ```

---

## Sign-Off Checklist

Before deploying to production, verify:

- [ ] Test 1: Booking flow works
- [ ] Test 2: Follow-up scheduled on "אחשוב"
- [ ] Test 3: Follow-up delivered after 24h
- [ ] Test 4: Follow-up cancelled on response
- [ ] Test 5: Max 3 follow-ups enforced
- [ ] Test 6: Safety net catches missed cases
- [ ] Test 7: Opt-out blocks follow-ups
- [ ] Test 8: Human override blocks automation
- [ ] All automated tests pass (`npm run test:e2e`)

**Tested by:** ________________
**Date:** ________________
**Commit:** ________________
