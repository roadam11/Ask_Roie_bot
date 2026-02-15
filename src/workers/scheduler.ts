/**
 * Follow-Up Scheduler
 *
 * Cron-based scheduler that finds due follow-ups and adds them
 * to the BullMQ queue for processing.
 *
 * Runs every 5 minutes to check for follow-ups that need to be sent.
 *
 * @usage
 * npm run worker:scheduler
 * # or
 * tsx src/workers/scheduler.ts
 */

import schedule from 'node-schedule';
import * as FollowUpModel from '../models/followup.model.js';
import { scheduleFollowUp, setupQueueListeners, closeAllQueues } from './queue.js';
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

// ============================================================================
// Scheduler Logic
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
 * Run scheduler immediately (for testing or manual trigger)
 */
export async function runSchedulerNow(): Promise<void> {
  await scheduleDueFollowUps();
}

// ============================================================================
// Scheduler Setup
// ============================================================================

let schedulerJob: schedule.Job | null = null;

/**
 * Start the scheduler
 */
function startScheduler(): void {
  logger.info('Starting follow-up scheduler...', {
    schedule: SCHEDULE_CRON,
    maxPerRun: MAX_FOLLOWUPS_PER_RUN,
  });

  // Setup queue event listeners
  setupQueueListeners();

  // Schedule the job
  schedulerJob = schedule.scheduleJob(SCHEDULE_CRON, async () => {
    logger.debug('Scheduler triggered by cron');
    await scheduleDueFollowUps();
  });

  // Also run immediately on startup
  scheduleDueFollowUps().catch((error) => {
    logger.error('Initial scheduler run failed', { error });
  });

  logger.info('Follow-up scheduler started', {
    nextRun: schedulerJob.nextInvocation()?.toISOString(),
  });
}

/**
 * Stop the scheduler
 */
function stopScheduler(): void {
  if (schedulerJob) {
    schedulerJob.cancel();
    schedulerJob = null;
    logger.info('Follow-up scheduler stopped');
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
  SCHEDULE_CRON,
  MAX_FOLLOWUPS_PER_RUN,
};
