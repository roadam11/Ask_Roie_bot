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
// Exports
// ============================================================================

export { connectionOptions };
