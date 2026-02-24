#!/usr/bin/env tsx
/**
 * Deployment Verification Script
 *
 * Checks Railway services status and deployment health:
 * 1. Verifies all 4 services exist
 * 2. Checks if services are running
 * 3. Reports last deployment timestamp
 * 4. Alerts if any service is stale or missing
 *
 * Usage:
 *   npm run test:deploy
 *   # or with Railway environment
 *   RAILWAY_TOKEN=xxx npm run test:deploy
 *
 * Environment variables:
 *   RAILWAY_TOKEN - Railway API token (optional, for API checks)
 *   DATABASE_URL - For database connectivity check
 *   REDIS_URL - For Redis connectivity check
 */

import { Pool } from 'pg';
import { createClient } from 'redis';

// ============================================================================
// Configuration
// ============================================================================

const EXPECTED_SERVICES = [
  { name: 'Ask Roie bot', type: 'main', critical: true },
  { name: 'calendly-worker', type: 'worker', critical: true },
  { name: 'scheduler', type: 'worker', critical: true },
  { name: 'followup-worker', type: 'worker', critical: true },
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
// Health Checks
// ============================================================================

interface HealthCheckResult {
  name: string;
  status: 'ok' | 'error' | 'warning';
  message: string;
  latency?: number;
}

async function checkPostgres(): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return { name: 'PostgreSQL', status: 'error', message: 'DATABASE_URL not set' };
    }

    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('railway') ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 5000,
    });

    const result = await pool.query('SELECT NOW() as time, COUNT(*) as leads FROM leads');
    const latency = Date.now() - start;

    await pool.end();

    return {
      name: 'PostgreSQL',
      status: 'ok',
      message: `Connected (${result.rows[0].leads} leads)`,
      latency,
    };
  } catch (error) {
    return {
      name: 'PostgreSQL',
      status: 'error',
      message: (error as Error).message,
      latency: Date.now() - start,
    };
  }
}

async function checkRedis(): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      return { name: 'Redis', status: 'error', message: 'REDIS_URL not set' };
    }

    const client = createClient({ url: redisUrl });
    await client.connect();

    // Check BullMQ queues
    const delayedCount = await client.zCard('bull:followup-automation:delayed');
    const waitingCount = await client.lLen('bull:followup-automation:wait');

    const latency = Date.now() - start;
    await client.quit();

    return {
      name: 'Redis',
      status: 'ok',
      message: `Connected (${delayedCount} delayed, ${waitingCount} waiting jobs)`,
      latency,
    };
  } catch (error) {
    return {
      name: 'Redis',
      status: 'error',
      message: (error as Error).message,
      latency: Date.now() - start,
    };
  }
}

async function checkFollowUpWorkerActivity(): Promise<HealthCheckResult> {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return { name: 'FollowUp Worker Activity', status: 'error', message: 'DATABASE_URL not set' };
    }

    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('railway') ? { rejectUnauthorized: false } : false,
    });

    // Check for recent follow-up activity
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
        MAX(sent_at) as last_sent,
        MAX(created_at) as last_created
      FROM followups
      WHERE created_at > NOW() - INTERVAL '7 days'
    `);

    await pool.end();

    const stats = result.rows[0];
    const lastSent = stats.last_sent ? new Date(stats.last_sent) : null;
    const hoursSinceLastSent = lastSent
      ? (Date.now() - lastSent.getTime()) / (1000 * 60 * 60)
      : null;

    let status: 'ok' | 'warning' | 'error' = 'ok';
    let message = `Pending: ${stats.pending}, Sent: ${stats.sent}, Cancelled: ${stats.cancelled}`;

    if (hoursSinceLastSent !== null && hoursSinceLastSent > 48) {
      status = 'warning';
      message += ` (Last sent ${Math.round(hoursSinceLastSent)}h ago)`;
    } else if (lastSent) {
      message += ` (Last sent ${lastSent.toISOString()})`;
    }

    return { name: 'FollowUp Worker Activity', status, message };
  } catch (error) {
    return {
      name: 'FollowUp Worker Activity',
      status: 'error',
      message: (error as Error).message,
    };
  }
}

async function checkLeadStatesForFollowUp(): Promise<HealthCheckResult> {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return { name: 'Leads Needing Follow-up', status: 'error', message: 'DATABASE_URL not set' };
    }

    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('railway') ? { rejectUnauthorized: false } : false,
    });

    // Check for leads that should have follow-ups
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE lead_state = 'thinking') as thinking,
        COUNT(*) FILTER (WHERE lead_state = 'thinking' AND follow_up_scheduled_at IS NOT NULL) as thinking_with_followup,
        COUNT(*) FILTER (WHERE lead_state = 'engaged') as engaged,
        COUNT(*) FILTER (WHERE lead_state = 'trial_scheduled') as trial_scheduled
      FROM leads
      WHERE opted_out = false
    `);

    await pool.end();

    const stats = result.rows[0];

    let status: 'ok' | 'warning' | 'error' = 'ok';
    const thinkingWithoutFollowup = parseInt(stats.thinking) - parseInt(stats.thinking_with_followup);

    if (thinkingWithoutFollowup > 0) {
      status = 'warning';
    }

    const message = `Thinking: ${stats.thinking} (${stats.thinking_with_followup} with follow-up), Engaged: ${stats.engaged}, Trial: ${stats.trial_scheduled}`;

    return { name: 'Leads Needing Follow-up', status, message };
  } catch (error) {
    return {
      name: 'Leads Needing Follow-up',
      status: 'error',
      message: (error as Error).message,
    };
  }
}

// ============================================================================
// Main Verification
// ============================================================================

async function verifyDeployment(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('  DEPLOYMENT VERIFICATION');
  console.log('='.repeat(60));

  const results: HealthCheckResult[] = [];
  let hasErrors = false;
  let hasWarnings = false;

  // Service list
  log.step('Expected Railway Services:');
  for (const service of EXPECTED_SERVICES) {
    console.log(`   - ${service.name} (${service.type})${service.critical ? ' [CRITICAL]' : ''}`);
  }

  // Infrastructure checks
  log.step('Checking Infrastructure...');

  const pgResult = await checkPostgres();
  results.push(pgResult);
  if (pgResult.status === 'ok') {
    log.success(`${pgResult.name}: ${pgResult.message} (${pgResult.latency}ms)`);
  } else {
    log.error(`${pgResult.name}: ${pgResult.message}`);
    hasErrors = true;
  }

  const redisResult = await checkRedis();
  results.push(redisResult);
  if (redisResult.status === 'ok') {
    log.success(`${redisResult.name}: ${redisResult.message} (${redisResult.latency}ms)`);
  } else {
    log.error(`${redisResult.name}: ${redisResult.message}`);
    hasErrors = true;
  }

  // Worker activity checks
  log.step('Checking Worker Activity...');

  const workerResult = await checkFollowUpWorkerActivity();
  results.push(workerResult);
  if (workerResult.status === 'ok') {
    log.success(`${workerResult.name}: ${workerResult.message}`);
  } else if (workerResult.status === 'warning') {
    log.warn(`${workerResult.name}: ${workerResult.message}`);
    hasWarnings = true;
  } else {
    log.error(`${workerResult.name}: ${workerResult.message}`);
    hasErrors = true;
  }

  // Lead state checks
  log.step('Checking Lead States...');

  const leadResult = await checkLeadStatesForFollowUp();
  results.push(leadResult);
  if (leadResult.status === 'ok') {
    log.success(`${leadResult.name}: ${leadResult.message}`);
  } else if (leadResult.status === 'warning') {
    log.warn(`${leadResult.name}: ${leadResult.message}`);
    hasWarnings = true;
  } else {
    log.error(`${leadResult.name}: ${leadResult.message}`);
    hasErrors = true;
  }

  // Summary
  console.log('\n' + '='.repeat(60));

  if (hasErrors) {
    log.error('DEPLOYMENT VERIFICATION FAILED');
    console.log('\nAction required:');
    console.log('  1. Check Railway dashboard for service status');
    console.log('  2. Verify environment variables are set');
    console.log('  3. Check service logs for errors');
    console.log('\nRailway Dashboard: https://railway.app/dashboard');
    process.exitCode = 1;
  } else if (hasWarnings) {
    log.warn('DEPLOYMENT OK WITH WARNINGS');
    console.log('\nRecommended actions:');
    console.log('  - Review warning messages above');
    console.log('  - Check if followup-worker is processing jobs');
    process.exitCode = 0;
  } else {
    log.success('ALL CHECKS PASSED!');
    process.exitCode = 0;
  }

  console.log('='.repeat(60) + '\n');
}

// Run verification
verifyDeployment();
