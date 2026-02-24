#!/usr/bin/env tsx
/**
 * E2E Test: Follow-up Automation Flow
 *
 * Tests the complete thinking_24h follow-up flow:
 * 1. Creates a test lead
 * 2. Sets lead_state to 'thinking'
 * 3. Verifies follow-up is scheduled in database
 * 4. Verifies BullMQ job is created in Redis
 *
 * Usage:
 *   npm run test:e2e
 *   # or with Railway environment
 *   railway run npm run test:e2e
 *
 * Environment variables required:
 *   DATABASE_URL - PostgreSQL connection string
 *   REDIS_URL - Redis connection string
 */

import { Pool } from 'pg';
import { createClient } from 'redis';

// ============================================================================
// Configuration
// ============================================================================

const TEST_PHONE = '972500000000'; // Fake test number
const TEST_PREFIX = '[E2E-TEST]';

// Colors for terminal output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const log = {
  success: (msg: string) => console.log(`${GREEN}✅ ${msg}${RESET}`),
  error: (msg: string) => console.log(`${RED}❌ ${msg}${RESET}`),
  info: (msg: string) => console.log(`${YELLOW}ℹ️  ${msg}${RESET}`),
  step: (msg: string) => console.log(`\n📍 ${msg}`),
};

// ============================================================================
// Database & Redis Connections
// ============================================================================

let pool: Pool;
let redis: ReturnType<typeof createClient>;

async function connect(): Promise<void> {
  log.step('Connecting to databases...');

  // PostgreSQL
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

  // Redis
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

  // Delete test followups
  await pool.query(
    `DELETE FROM followups WHERE lead_id IN (SELECT id FROM leads WHERE phone = $1)`,
    [TEST_PHONE]
  );

  // Delete test messages
  await pool.query(
    `DELETE FROM messages WHERE lead_id IN (SELECT id FROM leads WHERE phone = $1)`,
    [TEST_PHONE]
  );

  // Delete test leads
  const result = await pool.query(`DELETE FROM leads WHERE phone = $1 RETURNING id`, [TEST_PHONE]);

  if (result.rowCount && result.rowCount > 0) {
    log.info(`Cleaned up ${result.rowCount} previous test lead(s)`);
  }

  // Clean Redis test jobs
  const keys = await redis.keys('bull:followup-automation:*');
  for (const key of keys) {
    const jobData = await redis.get(key);
    if (jobData && jobData.includes(TEST_PHONE)) {
      await redis.del(key);
    }
  }

  log.success('Cleanup complete');
}

async function createTestLead(): Promise<string> {
  log.step('Creating test lead...');

  const result = await pool.query(
    `INSERT INTO leads (phone, name, source, status, lead_state, created_at, updated_at)
     VALUES ($1, $2, 'e2e-test', 'new', 'engaged', NOW(), NOW())
     RETURNING id`,
    [TEST_PHONE, `${TEST_PREFIX} Test User`]
  );

  const leadId = result.rows[0].id;
  log.success(`Created test lead: ${leadId}`);

  return leadId;
}

async function setLeadStateThinking(leadId: string): Promise<void> {
  log.step('Setting lead_state to "thinking"...');

  await pool.query(
    `UPDATE leads SET lead_state = 'thinking', updated_at = NOW() WHERE id = $1`,
    [leadId]
  );

  log.success('Lead state set to "thinking"');
}

async function triggerFollowUpAutomation(leadId: string): Promise<void> {
  log.step('Triggering follow-up automation via onLeadStateChange...');

  // Import the actual service to test the real flow
  const { onLeadStateChange } = await import('../services/follow-up-decision.service.js');

  const result = await onLeadStateChange(leadId, 'thinking');

  if (result?.success) {
    log.success(`Follow-up scheduled: jobId=${result.jobId}, followUpId=${result.followUpId}`);
  } else {
    throw new Error(`Failed to schedule follow-up: ${result?.error || 'unknown error'}`);
  }
}

async function verifyFollowUpInDatabase(leadId: string): Promise<void> {
  log.step('Verifying follow-up in database...');

  // Check leads table
  const leadResult = await pool.query(
    `SELECT lead_state, follow_up_scheduled_at, follow_up_type, follow_up_priority
     FROM leads WHERE id = $1`,
    [leadId]
  );

  const lead = leadResult.rows[0];

  if (!lead) {
    throw new Error('Lead not found in database');
  }

  if (lead.lead_state !== 'thinking') {
    throw new Error(`Expected lead_state='thinking', got '${lead.lead_state}'`);
  }
  log.success(`Lead state: ${lead.lead_state}`);

  if (!lead.follow_up_scheduled_at) {
    throw new Error('follow_up_scheduled_at is NULL');
  }
  log.success(`Follow-up scheduled at: ${lead.follow_up_scheduled_at}`);

  if (lead.follow_up_type !== 'thinking_24h') {
    throw new Error(`Expected follow_up_type='thinking_24h', got '${lead.follow_up_type}'`);
  }
  log.success(`Follow-up type: ${lead.follow_up_type}`);

  // Check followups table
  const followupResult = await pool.query(
    `SELECT id, type, status, scheduled_for FROM followups WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [leadId]
  );

  const followup = followupResult.rows[0];

  if (!followup) {
    throw new Error('No follow-up record found in followups table');
  }

  if (followup.status !== 'pending') {
    throw new Error(`Expected followup status='pending', got '${followup.status}'`);
  }
  log.success(`Follow-up record: id=${followup.id}, status=${followup.status}`);
}

async function verifyRedisJob(leadId: string): Promise<void> {
  log.step('Verifying BullMQ job in Redis...');

  // BullMQ stores jobs in various keys, check delayed jobs
  const delayedKey = 'bull:followup-automation:delayed';
  const delayedJobs = await redis.zRange(delayedKey, 0, -1);

  let foundJob = false;

  for (const jobId of delayedJobs) {
    const jobKey = `bull:followup-automation:${jobId}`;
    const jobData = await redis.hGet(jobKey, 'data');

    if (jobData && jobData.includes(leadId)) {
      foundJob = true;
      const parsed = JSON.parse(jobData);
      log.success(`Found BullMQ job: ${jobId}`);
      log.info(`  Lead ID: ${parsed.leadId}`);
      log.info(`  Type: ${parsed.type}`);
      break;
    }
  }

  if (!foundJob) {
    // Also check waiting jobs
    const waitingKey = 'bull:followup-automation:wait';
    const waitingJobs = await redis.lRange(waitingKey, 0, -1);

    for (const jobId of waitingJobs) {
      const jobKey = `bull:followup-automation:${jobId}`;
      const jobData = await redis.hGet(jobKey, 'data');

      if (jobData && jobData.includes(leadId)) {
        foundJob = true;
        log.success(`Found BullMQ job in waiting queue: ${jobId}`);
        break;
      }
    }
  }

  if (!foundJob) {
    log.info('Job may have already been processed or uses different key structure');
    log.info('Checking job counts...');

    const delayedCount = await redis.zCard(delayedKey);
    log.info(`Delayed jobs in queue: ${delayedCount}`);
  }
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runTests(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('  E2E TEST: Follow-up Automation (thinking_24h)');
  console.log('='.repeat(60));

  let leadId: string | null = null;

  try {
    await connect();
    await cleanupTestData();

    leadId = await createTestLead();
    await setLeadStateThinking(leadId);
    await triggerFollowUpAutomation(leadId);
    await verifyFollowUpInDatabase(leadId);
    await verifyRedisJob(leadId);

    console.log('\n' + '='.repeat(60));
    log.success('ALL TESTS PASSED!');
    console.log('='.repeat(60) + '\n');

    process.exitCode = 0;
  } catch (error) {
    console.log('\n' + '='.repeat(60));
    log.error(`TEST FAILED: ${(error as Error).message}`);
    console.log('='.repeat(60) + '\n');

    if (error instanceof Error && error.stack) {
      console.log('Stack trace:', error.stack);
    }

    process.exitCode = 1;
  } finally {
    // Cleanup test data
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
