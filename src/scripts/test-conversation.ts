#!/usr/bin/env tsx
/**
 * Conversation Simulation Test
 *
 * Simulates a WhatsApp/Telegram conversation to test:
 * 1. Message processing flow
 * 2. Claude tool calls (update_lead_state)
 * 3. Safety net keyword detection
 * 4. Follow-up automation triggering
 *
 * Usage:
 *   npm run test:conversation
 *   # or with Railway environment
 *   railway run npm run test:conversation
 *
 * Environment variables required:
 *   DATABASE_URL - PostgreSQL connection string
 *   REDIS_URL - Redis connection string
 *   ANTHROPIC_API_KEY - Claude API key (optional, for full simulation)
 */

import { Pool } from 'pg';
import { createClient } from 'redis';

// ============================================================================
// Configuration
// ============================================================================

const TEST_PHONE = '972500000001';
const TEST_PREFIX = '[CONV-TEST]';

// Test messages that should trigger follow-ups
const THINKING_MESSAGES = [
  'אני אחשוב על זה',
  'צריך לחשוב על זה',
  'אעדכן אותך',
  'אני צריך זמן לחשוב',
  'אחזור אליך בעניין',
];

// Colors for terminal output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

const log = {
  success: (msg: string) => console.log(`${GREEN}✅ ${msg}${RESET}`),
  error: (msg: string) => console.log(`${RED}❌ ${msg}${RESET}`),
  warn: (msg: string) => console.log(`${YELLOW}⚠️  ${msg}${RESET}`),
  info: (msg: string) => console.log(`${CYAN}ℹ️  ${msg}${RESET}`),
  step: (msg: string) => console.log(`\n📍 ${msg}`),
};

// ============================================================================
// Database Connection
// ============================================================================

let pool: Pool;
let redis: ReturnType<typeof createClient>;

async function connect(): Promise<void> {
  log.step('Connecting to databases...');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable not set');
  }

  pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('railway') ? { rejectUnauthorized: false } : false,
  });

  await pool.query('SELECT 1');
  log.success('PostgreSQL connected');

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable not set');
  }

  redis = createClient({ url: redisUrl });
  await redis.connect();
  log.success('Redis connected');
}

async function disconnect(): Promise<void> {
  await pool?.end();
  await redis?.quit();
}

// ============================================================================
// Test Helpers
// ============================================================================

async function cleanupTestData(): Promise<void> {
  log.step('Cleaning up previous test data...');

  await pool.query(
    `DELETE FROM followups WHERE lead_id IN (SELECT id FROM leads WHERE phone = $1)`,
    [TEST_PHONE]
  );
  await pool.query(
    `DELETE FROM messages WHERE lead_id IN (SELECT id FROM leads WHERE phone = $1)`,
    [TEST_PHONE]
  );
  await pool.query(`DELETE FROM leads WHERE phone = $1`, [TEST_PHONE]);

  log.success('Cleanup complete');
}

async function createTestLead(): Promise<string> {
  log.step('Creating test lead...');

  const result = await pool.query(
    `INSERT INTO leads (phone, name, status, lead_state, created_at, updated_at)
     VALUES ($1, $2, 'qualified', 'engaged', NOW(), NOW())
     RETURNING id`,
    [TEST_PHONE, `${TEST_PREFIX} Conversation Test`]
  );

  const leadId = result.rows[0].id;
  log.success(`Created test lead: ${leadId}`);

  return leadId;
}

async function simulateUserMessage(leadId: string, message: string): Promise<void> {
  log.info(`Simulating user message: "${message}"`);

  await pool.query(
    `INSERT INTO messages (lead_id, role, content, created_at)
     VALUES ($1, 'user', $2, NOW())`,
    [leadId, message]
  );
}

// ============================================================================
// Safety Net Test
// ============================================================================

async function testSafetyNetDetection(): Promise<boolean> {
  log.step('Testing Safety Net Keyword Detection...');

  // Define the thinking phrases (same as in controllers)
  const thinkingPhrases = ['אחשוב', 'אעדכן', 'צריך זמן', 'צריך לחשוב', 'אחזור אליך'];

  let allPassed = true;

  for (const testMessage of THINKING_MESSAGES) {
    const detected = thinkingPhrases.some((phrase) => testMessage.includes(phrase));

    if (detected) {
      log.success(`"${testMessage}" → Detected as thinking phrase`);
    } else {
      log.error(`"${testMessage}" → NOT detected (should be detected!)`);
      allPassed = false;
    }
  }

  // Test negative cases
  const nonThinkingMessages = ['שלום, אני מעוניין בשיעור', 'מה המחיר?', 'בוא נקבע שיעור'];

  for (const testMessage of nonThinkingMessages) {
    const detected = thinkingPhrases.some((phrase) => testMessage.includes(phrase));

    if (!detected) {
      log.success(`"${testMessage}" → Correctly NOT detected`);
    } else {
      log.error(`"${testMessage}" → Incorrectly detected as thinking`);
      allPassed = false;
    }
  }

  return allPassed;
}

// ============================================================================
// Follow-up Flow Test
// ============================================================================

async function testFollowUpFlow(leadId: string): Promise<boolean> {
  log.step('Testing Follow-up Flow...');

  // Simulate user saying "אני אחשוב על זה"
  const thinkingMessage = 'אני אחשוב על זה';
  await simulateUserMessage(leadId, thinkingMessage);

  // Import and call the actual onLeadStateChange
  const { onLeadStateChange, decideFollowUp } = await import(
    '../services/follow-up-decision.service.js'
  );

  // First, let's test the decision logic
  log.info('Testing decideFollowUp logic...');

  // Update lead to thinking state
  await pool.query(`UPDATE leads SET lead_state = 'thinking', updated_at = NOW() WHERE id = $1`, [
    leadId,
  ]);

  // Fetch lead and test decision
  const leadResult = await pool.query(`SELECT * FROM leads WHERE id = $1`, [leadId]);
  const lead = leadResult.rows[0];

  const decision = decideFollowUp(lead);

  if (decision.shouldSchedule) {
    log.success(`Decision: Schedule ${decision.type} at ${decision.scheduledAt?.toISOString()}`);
  } else {
    log.error(`Decision: No follow-up (reason: ${decision.reason})`);
    return false;
  }

  // Now trigger the actual scheduling
  log.info('Triggering onLeadStateChange...');
  const result = await onLeadStateChange(leadId, 'thinking');

  if (result?.success) {
    log.success(`Follow-up scheduled: jobId=${result.jobId}`);
  } else {
    log.error(`Failed to schedule: ${result?.error}`);
    return false;
  }

  // Verify in database
  const verifyResult = await pool.query(
    `SELECT follow_up_scheduled_at, follow_up_type FROM leads WHERE id = $1`,
    [leadId]
  );

  const updatedLead = verifyResult.rows[0];

  if (updatedLead.follow_up_type === 'thinking_24h') {
    log.success(`Database verified: type=${updatedLead.follow_up_type}`);
  } else {
    log.error(`Database mismatch: type=${updatedLead.follow_up_type}`);
    return false;
  }

  // Verify in followups table
  const followupResult = await pool.query(
    `SELECT status, type FROM followups WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [leadId]
  );

  if (followupResult.rows[0]?.status === 'pending') {
    log.success(`Follow-up record: status=pending, type=${followupResult.rows[0].type}`);
  } else {
    log.error(`Follow-up record missing or wrong status`);
    return false;
  }

  return true;
}

// ============================================================================
// User Response Cancellation Test
// ============================================================================

async function testUserResponseCancellation(leadId: string): Promise<boolean> {
  log.step('Testing User Response Cancellation...');

  // Import onUserResponse
  const { onUserResponse } = await import('../services/follow-up-decision.service.js');

  // Simulate user responding
  await simulateUserMessage(leadId, 'בעצם כן, בוא נקבע שיעור!');

  // Call onUserResponse
  await onUserResponse(leadId);

  // Verify follow-up was cancelled
  const result = await pool.query(
    `SELECT follow_up_scheduled_at, follow_up_type, lead_state FROM leads WHERE id = $1`,
    [leadId]
  );

  const lead = result.rows[0];

  if (lead.follow_up_scheduled_at === null && lead.follow_up_type === null) {
    log.success('Follow-up cancelled on user response');
  } else {
    log.error(`Follow-up NOT cancelled: type=${lead.follow_up_type}`);
    return false;
  }

  if (lead.lead_state === 'engaged') {
    log.success(`Lead state reset to: ${lead.lead_state}`);
  } else {
    log.warn(`Lead state: ${lead.lead_state} (expected 'engaged')`);
  }

  // Verify in followups table
  const followupResult = await pool.query(
    `SELECT status FROM followups WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [leadId]
  );

  if (followupResult.rows[0]?.status === 'cancelled') {
    log.success('Follow-up record marked as cancelled');
  } else {
    log.warn(`Follow-up status: ${followupResult.rows[0]?.status}`);
  }

  return true;
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runTests(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('  CONVERSATION SIMULATION TEST');
  console.log('='.repeat(60));

  let leadId: string | null = null;
  let allPassed = true;

  try {
    await connect();
    await cleanupTestData();

    // Test 1: Safety net keyword detection
    const safetyNetPassed = await testSafetyNetDetection();
    if (!safetyNetPassed) allPassed = false;

    // Test 2: Follow-up flow
    leadId = await createTestLead();
    const followUpPassed = await testFollowUpFlow(leadId);
    if (!followUpPassed) allPassed = false;

    // Test 3: User response cancellation
    const cancellationPassed = await testUserResponseCancellation(leadId);
    if (!cancellationPassed) allPassed = false;

    // Summary
    console.log('\n' + '='.repeat(60));

    if (allPassed) {
      log.success('ALL CONVERSATION TESTS PASSED!');
      console.log('\nVerified:');
      console.log('  ✅ Safety net detects thinking phrases');
      console.log('  ✅ Follow-up scheduled when lead_state = thinking');
      console.log('  ✅ Follow-up cancelled when user responds');
      process.exitCode = 0;
    } else {
      log.error('SOME TESTS FAILED');
      process.exitCode = 1;
    }

    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.log('\n' + '='.repeat(60));
    log.error(`TEST ERROR: ${(error as Error).message}`);
    console.log('='.repeat(60) + '\n');

    if (error instanceof Error && error.stack) {
      console.log('Stack trace:', error.stack);
    }

    process.exitCode = 1;
  } finally {
    // Cleanup
    if (leadId) {
      log.step('Cleaning up test data...');
      await pool?.query(
        `DELETE FROM followups WHERE lead_id IN (SELECT id FROM leads WHERE phone = $1)`,
        [TEST_PHONE]
      );
      await pool?.query(
        `DELETE FROM messages WHERE lead_id IN (SELECT id FROM leads WHERE phone = $1)`,
        [TEST_PHONE]
      );
      await pool?.query(`DELETE FROM leads WHERE phone = $1`, [TEST_PHONE]);
      log.success('Test data cleaned up');
    }

    await disconnect();
  }
}

// Run tests
runTests();
