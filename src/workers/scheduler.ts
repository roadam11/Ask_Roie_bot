/**
 * Background Job Scheduler
 *
 * Cron-based scheduler that manages periodic tasks:
 * - Follow-up scheduling (every 5 minutes)
 * - Calendly polling (every 5 minutes)
 * - Idle lead detection (every 15 minutes)
 *
 * @usage
 * npm run worker:scheduler
 * # or
 * tsx src/workers/scheduler.ts
 */

import schedule from 'node-schedule';
import * as FollowUpModel from '../models/followup.model.js';
import { scheduleFollowUp, scheduleCalendlyPoll, setupQueueListeners, closeAllQueues } from './queue.js';
import {
  findIdleLeads,
  scheduleFollowUpForLead,
} from '../services/follow-up-decision.service.js';
import logger from '../utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * How often to check for due follow-ups (in cron format)
 * Every 5 minutes: '0/5 * * * *' (at 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55)
 */
const SCHEDULE_CRON = '*/5 * * * *';

/**
 * Maximum follow-ups to process per run
 */
const MAX_FOLLOWUPS_PER_RUN = 50;

/**
 * Calendly polling schedule (also every 5 minutes, offset by 2 minutes)
 */
const CALENDLY_CRON = '2-57/5 * * * *';

/**
 * Idle lead detection schedule (every 15 minutes, offset by 7 minutes)
 * Detects leads that have been idle for 48-72 hours
 */
const IDLE_DETECTION_CRON = '7,22,37,52 * * * *';

// ============================================================================
// Follow-Up Scheduler Logic
// ============================================================================

/**
 * Find and schedule due follow-ups
 */
async function scheduleDueFollowUps(): Promise<void> {
  const startTime = Date.now();

  try {
    logger.info('Checking for due follow-ups...');

    // Find all pending follow-ups that are due
    const dueFollowUps = await FollowUpModel.findDueFollowUps(MAX_FOLLOWUPS_PER_RUN);

    if (dueFollowUps.length === 0) {
      logger.debug('No due follow-ups found');
      return;
    }

    logger.info(`Found ${dueFollowUps.length} due follow-ups`);

    // Schedule each follow-up
    let scheduled = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const followUp of dueFollowUps) {
      try {
        // Add to queue with small stagger to avoid bursts
        const delay = scheduled * 2000; // 2 seconds between each

        await scheduleFollowUp(
          followUp.lead_id,
          followUp.type as '24h' | '72h' | '7d',
          followUp.id,
          delay
        );

        scheduled++;

        logger.debug('Follow-up scheduled', {
          followUpId: followUp.id,
          leadId: followUp.lead_id,
          type: followUp.type,
          delay,
        });
      } catch (error) {
        // Log error but continue with other follow-ups
        const errorMsg = (error as Error).message;
        errors.push(`${followUp.id}: ${errorMsg}`);
        skipped++;

        logger.error('Failed to schedule follow-up', {
          followUpId: followUp.id,
          error: errorMsg,
        });
      }
    }

    const duration = Date.now() - startTime;

    logger.info('Follow-up scheduling complete', {
      duration: `${duration}ms`,
      scheduled,
      skipped,
      total: dueFollowUps.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error('Error in follow-up scheduler', {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }
}

/**
 * Run follow-up scheduler immediately (for testing or manual trigger)
 */
async function runFollowUpSchedulerNow(): Promise<void> {
  await scheduleDueFollowUps();
}

// ============================================================================
// Calendly Polling Logic
// ============================================================================

/**
 * Schedule a Calendly poll job
 */
async function scheduleCalendlyPollJob(): Promise<void> {
  const startTime = Date.now();

  try {
    logger.info('Scheduling Calendly poll job...');

    await scheduleCalendlyPoll();

    const duration = Date.now() - startTime;

    logger.info('Calendly poll job scheduled', {
      duration: `${duration}ms`,
    });
  } catch (error) {
    logger.error('Error scheduling Calendly poll', {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }
}

/**
 * Run Calendly poll immediately (for testing or manual trigger)
 */
async function runCalendlyPollNow(): Promise<void> {
  await scheduleCalendlyPollJob();
}

// ============================================================================
// Idle Lead Detection Logic
// ============================================================================

/**
 * Find idle leads (48-72h no response) and schedule follow-ups
 * CRITICAL: UTC math only - prevents 2AM messages
 */
async function detectIdleLeads(): Promise<void> {
  const startTime = Date.now();

  try {
    logger.info('Checking for idle leads...');

    // Find leads that are 48-72h idle
    const idleLeads = await findIdleLeads();

    if (idleLeads.length === 0) {
      logger.debug('No idle leads found');
      return;
    }

    logger.info(`Found ${idleLeads.length} idle leads`);

    // Schedule follow-ups for each
    let scheduled = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const lead of idleLeads) {
      try {
        const result = await scheduleFollowUpForLead(lead);

        if (result.success) {
          scheduled++;
          logger.debug('Idle follow-up scheduled', {
            leadId: lead.id,
            jobId: result.jobId,
          });
        } else {
          skipped++;
          logger.debug('Idle follow-up skipped', {
            leadId: lead.id,
            reason: result.error,
          });
        }
      } catch (error) {
        const errorMsg = (error as Error).message;
        errors.push(`${lead.id}: ${errorMsg}`);
        skipped++;

        logger.error('Failed to schedule idle follow-up', {
          leadId: lead.id,
          error: errorMsg,
        });
      }
    }

    const duration = Date.now() - startTime;

    logger.info('Idle lead detection complete', {
      duration: `${duration}ms`,
      scheduled,
      skipped,
      total: idleLeads.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error('Error in idle lead detection', {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }
}

/**
 * Run idle detection immediately (for testing or manual trigger)
 */
async function runIdleDetectionNow(): Promise<void> {
  await detectIdleLeads();
}

// ============================================================================
// Scheduler Setup
// ============================================================================

let followUpSchedulerJob: schedule.Job | null = null;
let calendlySchedulerJob: schedule.Job | null = null;
let idleDetectionJob: schedule.Job | null = null;

/**
 * Start all schedulers
 */
function startScheduler(): void {
  logger.info('Starting background job schedulers...', {
    followUpSchedule: SCHEDULE_CRON,
    calendlySchedule: CALENDLY_CRON,
    idleDetectionSchedule: IDLE_DETECTION_CRON,
    maxFollowUpsPerRun: MAX_FOLLOWUPS_PER_RUN,
  });

  // Setup queue event listeners
  setupQueueListeners();

  // Schedule follow-up jobs
  followUpSchedulerJob = schedule.scheduleJob(SCHEDULE_CRON, async () => {
    logger.debug('Follow-up scheduler triggered by cron');
    await scheduleDueFollowUps();
  });

  // Schedule Calendly polling jobs
  calendlySchedulerJob = schedule.scheduleJob(CALENDLY_CRON, async () => {
    logger.debug('Calendly scheduler triggered by cron');
    await scheduleCalendlyPollJob();
  });

  // Schedule idle lead detection (every 15 minutes)
  idleDetectionJob = schedule.scheduleJob(IDLE_DETECTION_CRON, async () => {
    logger.debug('Idle detection triggered by cron');
    await detectIdleLeads();
  });

  // Run all immediately on startup
  scheduleDueFollowUps().catch((error) => {
    logger.error('Initial follow-up scheduler run failed', { error });
  });

  scheduleCalendlyPollJob().catch((error) => {
    logger.error('Initial Calendly poll failed', { error });
  });

  detectIdleLeads().catch((error) => {
    logger.error('Initial idle detection failed', { error });
  });

  logger.info('All schedulers started', {
    followUpNextRun: followUpSchedulerJob.nextInvocation()?.toISOString(),
    calendlyNextRun: calendlySchedulerJob.nextInvocation()?.toISOString(),
    idleDetectionNextRun: idleDetectionJob.nextInvocation()?.toISOString(),
  });
}

/**
 * Stop all schedulers
 */
function stopScheduler(): void {
  if (followUpSchedulerJob) {
    followUpSchedulerJob.cancel();
    followUpSchedulerJob = null;
    logger.info('Follow-up scheduler stopped');
  }

  if (calendlySchedulerJob) {
    calendlySchedulerJob.cancel();
    calendlySchedulerJob = null;
    logger.info('Calendly scheduler stopped');
  }

  if (idleDetectionJob) {
    idleDetectionJob.cancel();
    idleDetectionJob = null;
    logger.info('Idle detection scheduler stopped');
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  startScheduler();

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down scheduler...`);

    stopScheduler();
    await closeAllQueues();

    logger.info('Scheduler shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Keep process running
  logger.info('Scheduler running. Press Ctrl+C to stop.');
}

// Run if this is the main module
main().catch((error) => {
  logger.error('Failed to start scheduler', { error });
  process.exit(1);
});

// ============================================================================
// Exports
// ============================================================================

export {
  startScheduler,
  stopScheduler,
  scheduleDueFollowUps,
  scheduleCalendlyPollJob,
  detectIdleLeads,
  runFollowUpSchedulerNow,
  runCalendlyPollNow,
  runIdleDetectionNow,
  SCHEDULE_CRON,
  CALENDLY_CRON,
  IDLE_DETECTION_CRON,
  MAX_FOLLOWUPS_PER_RUN,
};
