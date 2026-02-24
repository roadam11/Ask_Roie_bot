/**
 * BullMQ Queue Setup
 *
 * Configures job queues for background processing including
 * follow-ups, Calendly polling, and other async tasks.
 *
 * @example
 * import { followupQueue, calendlyQueue } from './workers/queue.js';
 *
 * await followupQueue.add('send-followup', { leadId, type: '24h' });
 */

import { Queue, QueueEvents } from 'bullmq';
import config from '../config/index.js';
import logger from '../utils/logger.js';

// ============================================================================
// Redis Connection Options
// ============================================================================

/**
 * Parse Redis URL to connection object
 */
function parseRedisUrl(url: string): {
  host: string;
  port: number;
  password?: string;
  db?: number;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || 6379,
    password: parsed.password || undefined,
    db: parsed.pathname ? parseInt(parsed.pathname.slice(1), 10) : undefined,
  };
}

const connectionOptions = parseRedisUrl(config.redis.url);

// ============================================================================
// Queue Definitions
// ============================================================================

/**
 * Follow-up queue for sending scheduled follow-up messages
 *
 * Job data: { leadId: string, type: '24h' | '72h' | '7d', followUpId: string }
 */
export const followupQueue = new Queue('followup', {
  connection: connectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5 seconds initial delay
    },
    removeOnComplete: {
      count: 1000, // Keep last 1000 completed jobs
      age: 24 * 60 * 60, // Keep for 24 hours
    },
    removeOnFail: {
      count: 5000, // Keep last 5000 failed jobs
      age: 7 * 24 * 60 * 60, // Keep for 7 days
    },
  },
});

/**
 * Calendly polling queue for checking new bookings
 *
 * Job data: { timestamp: number }
 */
export const calendlyQueue = new Queue('calendly', {
  connection: connectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 10000, // 10 seconds initial delay
    },
    removeOnComplete: {
      count: 100,
      age: 60 * 60, // Keep for 1 hour
    },
    removeOnFail: {
      count: 500,
      age: 24 * 60 * 60, // Keep for 24 hours
    },
  },
});

/**
 * Analytics queue for tracking events asynchronously
 *
 * Job data: { eventType: string, leadId?: string, metadata?: object, costUsd?: number }
 */
export const analyticsQueue = new Queue('analytics', {
  connection: connectionOptions,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 1000,
    },
    removeOnComplete: {
      count: 500,
      age: 60 * 60,
    },
    removeOnFail: {
      count: 1000,
      age: 24 * 60 * 60,
    },
  },
});

// ============================================================================
// Queue Events
// ============================================================================

/**
 * Setup queue event listeners for monitoring
 */
export function setupQueueListeners(): void {
  // Follow-up queue events
  const followupEvents = new QueueEvents('followup', {
    connection: connectionOptions,
  });

  followupEvents.on('completed', ({ jobId, returnvalue }) => {
    logger.info('Follow-up job completed', {
      queue: 'followup',
      jobId,
      result: returnvalue,
    });
  });

  followupEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error('Follow-up job failed', {
      queue: 'followup',
      jobId,
      error: failedReason,
    });
  });

  followupEvents.on('stalled', ({ jobId }) => {
    logger.warn('Follow-up job stalled', {
      queue: 'followup',
      jobId,
    });
  });

  // Calendly queue events
  const calendlyEvents = new QueueEvents('calendly', {
    connection: connectionOptions,
  });

  calendlyEvents.on('completed', ({ jobId }) => {
    logger.debug('Calendly poll job completed', {
      queue: 'calendly',
      jobId,
    });
  });

  calendlyEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error('Calendly poll job failed', {
      queue: 'calendly',
      jobId,
      error: failedReason,
    });
  });

  // Analytics queue events
  const analyticsEvents = new QueueEvents('analytics', {
    connection: connectionOptions,
  });

  analyticsEvents.on('failed', ({ jobId, failedReason }) => {
    logger.warn('Analytics job failed', {
      queue: 'analytics',
      jobId,
      error: failedReason,
    });
  });

  logger.info('Queue event listeners initialized');
}

// ============================================================================
// Queue Management
// ============================================================================

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  followup: { waiting: number; active: number; completed: number; failed: number };
  calendly: { waiting: number; active: number; completed: number; failed: number };
  analytics: { waiting: number; active: number; completed: number; failed: number };
}> {
  const [followupCounts, calendlyCounts, analyticsCounts] = await Promise.all([
    followupQueue.getJobCounts(),
    calendlyQueue.getJobCounts(),
    analyticsQueue.getJobCounts(),
  ]);

  return {
    followup: {
      waiting: followupCounts.waiting || 0,
      active: followupCounts.active || 0,
      completed: followupCounts.completed || 0,
      failed: followupCounts.failed || 0,
    },
    calendly: {
      waiting: calendlyCounts.waiting || 0,
      active: calendlyCounts.active || 0,
      completed: calendlyCounts.completed || 0,
      failed: calendlyCounts.failed || 0,
    },
    analytics: {
      waiting: analyticsCounts.waiting || 0,
      active: analyticsCounts.active || 0,
      completed: analyticsCounts.completed || 0,
      failed: analyticsCounts.failed || 0,
    },
  };
}

/**
 * Pause all queues
 */
export async function pauseAllQueues(): Promise<void> {
  await Promise.all([
    followupQueue.pause(),
    calendlyQueue.pause(),
    analyticsQueue.pause(),
  ]);
  logger.info('All queues paused');
}

/**
 * Resume all queues
 */
export async function resumeAllQueues(): Promise<void> {
  await Promise.all([
    followupQueue.resume(),
    calendlyQueue.resume(),
    analyticsQueue.resume(),
  ]);
  logger.info('All queues resumed');
}

/**
 * Close all queue connections
 */
export async function closeAllQueues(): Promise<void> {
  await Promise.all([
    followupQueue.close(),
    calendlyQueue.close(),
    analyticsQueue.close(),
  ]);
  logger.info('All queue connections closed');
}

// ============================================================================
// Job Helpers
// ============================================================================

/**
 * Add a follow-up job to the queue
 */
export async function scheduleFollowUp(
  leadId: string,
  type: '24h' | '72h' | '7d',
  followUpId: string,
  delay?: number
): Promise<string> {
  const job = await followupQueue.add(
    'send-followup',
    { leadId, type, followUpId },
    {
      delay: delay || 0,
      jobId: `followup-${followUpId}`, // Prevent duplicate jobs
    }
  );

  logger.debug('Follow-up job scheduled', {
    jobId: job.id,
    leadId,
    type,
    followUpId,
    delay,
  });

  return job.id!;
}

/**
 * Add a Calendly poll job to the queue
 */
export async function scheduleCalendlyPoll(delay?: number): Promise<string> {
  const job = await calendlyQueue.add(
    'poll-bookings',
    { timestamp: Date.now() },
    {
      delay: delay || 0,
    }
  );

  return job.id!;
}

/**
 * Add an analytics event job to the queue
 */
export async function trackEventAsync(
  eventType: string,
  leadId?: string,
  metadata?: Record<string, unknown>,
  costUsd?: number
): Promise<void> {
  await analyticsQueue.add('track-event', {
    eventType,
    leadId,
    metadata,
    costUsd,
  });
}

// ============================================================================
// Automation Follow-up Helpers
// CRITICAL: UTC math only - prevents 2AM messages
// ============================================================================

import type { AutomationFollowUpType } from '../types/index.js';

/**
 * Deterministic job ID patterns for each follow-up type
 * Using deterministic IDs prevents duplicate jobs when rescheduling
 *
 * Pattern: followup-${leadId}-${type_suffix}
 */
const JOB_ID_PATTERNS: Record<AutomationFollowUpType, (leadId: string) => string> = {
  'thinking_24h': (leadId) => `followup-${leadId}-thinking_24h`,
  'trial_reminder_2h': (leadId) => `followup-${leadId}-trial_reminder`,
  'trial_followup_24h': (leadId) => `followup-${leadId}-trial_followup`,
  'idle_48h': (leadId) => `followup-${leadId}-idle_48h`,
};

/**
 * Get the deterministic job ID for a follow-up type and lead
 */
export function getAutomationJobId(type: AutomationFollowUpType, leadId: string): string {
  return JOB_ID_PATTERNS[type](leadId);
}

/**
 * Schedule an automation follow-up with reschedule safety
 *
 * CRITICAL: UTC math only - prevents 2AM messages
 *
 * @param leadId - Lead UUID
 * @param type - Automation follow-up type
 * @param scheduledAt - When to send (MUST be UTC Date object)
 * @param followUpId - Database follow-up record ID
 * @returns Job ID
 */
export async function scheduleAutomationFollowUp(
  leadId: string,
  type: AutomationFollowUpType,
  scheduledAt: Date,
  followUpId: string
): Promise<string> {
  // CRITICAL: UTC math only - prevents 2AM messages
  const now = new Date();
  const delayMs = Math.max(0, scheduledAt.getTime() - now.getTime());

  // Use deterministic jobId to prevent duplicates on reschedule
  const jobId = getAutomationJobId(type, leadId);

  // Check if job exists and remove it (reschedule scenario)
  const existingJob = await followupQueue.getJob(jobId);
  if (existingJob) {
    logger.info('Removing existing follow-up job for reschedule', {
      jobId,
      leadId,
      type,
      oldScheduledFor: existingJob.opts.delay,
    });
    await existingJob.remove();
  }

  // Add new job with deterministic ID
  const job = await followupQueue.add(
    'send-automation-followup',
    {
      leadId,
      type,
      followUpId,
      scheduledAtUtc: scheduledAt.toISOString(), // Store UTC for logging
    },
    {
      delay: delayMs,
      jobId, // Deterministic ID prevents duplicates
    }
  );

  logger.info('Automation follow-up scheduled', {
    jobId: job.id,
    leadId,
    type,
    followUpId,
    scheduledAtUtc: scheduledAt.toISOString(),
    delayMs,
  });

  return job.id!;
}

/**
 * Cancel an automation follow-up by type and lead
 *
 * @param leadId - Lead UUID
 * @param type - Automation follow-up type to cancel
 * @returns true if job was found and removed
 */
export async function cancelAutomationFollowUp(
  leadId: string,
  type: AutomationFollowUpType
): Promise<boolean> {
  const jobId = getAutomationJobId(type, leadId);
  const job = await followupQueue.getJob(jobId);

  if (job) {
    await job.remove();
    logger.info('Automation follow-up cancelled', { jobId, leadId, type });
    return true;
  }

  return false;
}

/**
 * Cancel ALL automation follow-ups for a lead
 * Used when user responds or opts out
 *
 * @param leadId - Lead UUID
 * @returns Number of jobs cancelled
 */
export async function cancelAllAutomationFollowUps(leadId: string): Promise<number> {
  const types: AutomationFollowUpType[] = [
    'thinking_24h',
    'trial_reminder_2h',
    'trial_followup_24h',
    'idle_48h',
  ];

  let cancelled = 0;
  for (const type of types) {
    const removed = await cancelAutomationFollowUp(leadId, type);
    if (removed) cancelled++;
  }

  if (cancelled > 0) {
    logger.info('Cancelled all automation follow-ups for lead', { leadId, count: cancelled });
  }

  return cancelled;
}

// ============================================================================
// Exports
// ============================================================================

export { connectionOptions };
