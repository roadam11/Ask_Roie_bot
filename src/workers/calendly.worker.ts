/**
 * Calendly Polling Worker
 *
 * BullMQ worker process for polling Calendly bookings.
 * Runs periodically to check for new bookings and update lead status.
 *
 * @usage
 * npm run worker:calendly
 * # or
 * tsx src/workers/calendly.worker.ts
 */

import { Worker, Job } from 'bullmq';
import { connectionOptions } from './queue.js';
import * as CalendlyService from '../services/calendly.service.js';
import * as LeadModel from '../models/lead.model.js';
import * as FollowUpModel from '../models/followup.model.js';
import * as AnalyticsModel from '../models/analytics.model.js';
import { redisClient, connectDatabase } from '../database/connection.js';
import logger from '../utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Redis key prefix for processed Calendly events
 */
const PROCESSED_EVENTS_PREFIX = 'calendly:processed:';

/**
 * How long to keep processed event markers (7 days)
 */
const PROCESSED_EVENT_TTL = 7 * 24 * 60 * 60;

/**
 * How far back to look for events (24 hours)
 */
const LOOKBACK_HOURS = 24;

// ============================================================================
// Types
// ============================================================================

/**
 * Calendly poll job data
 */
interface CalendlyJobData {
  timestamp: number;
}

/**
 * Calendly poll job result
 */
interface CalendlyJobResult {
  success: boolean;
  eventsFound: number;
  newBookings: number;
  skipped: number;
  errors: number;
  processedEventUris: string[];
}

// ============================================================================
// Worker Logic
// ============================================================================

/**
 * Process a Calendly polling job
 */
async function processCalendlyPoll(job: Job<CalendlyJobData>): Promise<CalendlyJobResult> {
  const startTime = Date.now();

  logger.info('Starting Calendly poll', {
    jobId: job.id,
    timestamp: new Date(job.data.timestamp).toISOString(),
  });

  const result: CalendlyJobResult = {
    success: true,
    eventsFound: 0,
    newBookings: 0,
    skipped: 0,
    errors: 0,
    processedEventUris: [],
  };

  try {
    // Check if Calendly is configured
    if (!CalendlyService.isConfigured()) {
      logger.warn('Calendly not configured, skipping poll');
      return { ...result, success: false };
    }

    // Calculate lookback time
    const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

    // Fetch recent events
    const events = await CalendlyService.getRecentEvents(since, 'active');
    result.eventsFound = events.length;

    if (events.length === 0) {
      logger.debug('No events found in lookback period');
      return result;
    }

    logger.info(`Found ${events.length} Calendly events to process`);

    // Process each event
    for (const event of events) {
      try {
        const processResult = await processEvent(event);

        if (processResult.processed) {
          result.newBookings++;
          result.processedEventUris.push(event.uri);
        } else if (processResult.skipped) {
          result.skipped++;
        }
      } catch (error) {
        result.errors++;
        logger.error('Error processing Calendly event', {
          eventUri: event.uri,
          error: (error as Error).message,
        });
      }
    }

    const duration = Date.now() - startTime;

    logger.info('Calendly poll completed', {
      jobId: job.id,
      duration: `${duration}ms`,
      ...result,
    });

    return result;
  } catch (error) {
    logger.error('Calendly poll failed', {
      jobId: job.id,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });

    throw error;
  }
}

/**
 * Process a single Calendly event
 */
async function processEvent(event: CalendlyService.CalendlyEvent): Promise<{
  processed: boolean;
  skipped: boolean;
  reason?: string;
}> {
  const eventUri = event.uri;

  // Check if already processed
  const isProcessed = await isEventProcessed(eventUri);
  if (isProcessed) {
    logger.debug('Event already processed', { eventUri });
    return { processed: false, skipped: true, reason: 'Already processed' };
  }

  // Extract phone from event
  const phone = await CalendlyService.extractPhoneFromEvent(event);

  if (!phone) {
    logger.debug('No phone found in event', { eventUri });
    await markEventProcessed(eventUri); // Mark to prevent reprocessing
    return { processed: false, skipped: true, reason: 'No phone found' };
  }

  // Find lead by phone
  const lead = await LeadModel.findByPhone(phone);

  if (!lead) {
    logger.info('No lead found for booking', {
      eventUri,
      phone: maskPhone(phone),
    });
    await markEventProcessed(eventUri);
    return { processed: false, skipped: true, reason: 'Lead not found' };
  }

  // Check if lead is already booked
  if (lead.status === 'booked') {
    logger.debug('Lead already marked as booked', { leadId: lead.id });
    await markEventProcessed(eventUri);
    return { processed: false, skipped: true, reason: 'Already booked' };
  }

  // Mark lead as booked
  logger.info('Marking lead as booked', {
    leadId: lead.id,
    eventUri,
    eventStart: event.start_time,
  });

  await LeadModel.markAsBooked(lead.id, eventUri);

  // Cancel pending follow-ups
  const cancelledFollowUps = await FollowUpModel.cancelAllForLead(lead.id);
  if (cancelledFollowUps > 0) {
    logger.info('Cancelled pending follow-ups', {
      leadId: lead.id,
      count: cancelledFollowUps,
    });
  }

  // Track booking event
  await AnalyticsModel.trackBookingCompleted(lead.id, eventUri);

  // Mark event as processed
  await markEventProcessed(eventUri);

  logger.info('Booking processed successfully', {
    leadId: lead.id,
    eventUri,
    eventStart: event.start_time,
    eventName: event.name,
  });

  return { processed: true, skipped: false };
}

// ============================================================================
// Redis Helpers
// ============================================================================

/**
 * Check if event has been processed
 */
async function isEventProcessed(eventUri: string): Promise<boolean> {
  const key = PROCESSED_EVENTS_PREFIX + eventUri;
  const exists = await redisClient.exists(key);
  return exists === 1;
}

/**
 * Mark event as processed
 */
async function markEventProcessed(eventUri: string): Promise<void> {
  const key = PROCESSED_EVENTS_PREFIX + eventUri;
  await redisClient.set(key, Date.now().toString(), {
    EX: PROCESSED_EVENT_TTL,
  });
}

/**
 * Get count of processed events (for monitoring)
 */
async function getProcessedEventCount(): Promise<number> {
  const keys = await redisClient.keys(PROCESSED_EVENTS_PREFIX + '*');
  return keys.length;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Mask phone number for logging
 */
function maskPhone(phone: string): string {
  if (phone.length < 8) return phone;
  return phone.slice(0, 4) + '****' + phone.slice(-4);
}

// ============================================================================
// Worker Setup
// ============================================================================

/**
 * Create and start the Calendly worker
 */
function createWorker(): Worker<CalendlyJobData, CalendlyJobResult> {
  const worker = new Worker<CalendlyJobData, CalendlyJobResult>(
    'calendly',
    processCalendlyPoll,
    {
      connection: connectionOptions,
      concurrency: 1, // Only one poll at a time
      limiter: {
        max: 1,
        duration: 60000, // Max 1 job per minute
      },
    }
  );

  // Worker event handlers
  worker.on('completed', (job, result) => {
    logger.debug('Calendly worker job completed', {
      jobId: job.id,
      newBookings: result.newBookings,
      eventsFound: result.eventsFound,
    });
  });

  worker.on('failed', (job, error) => {
    logger.error('Calendly worker job failed', {
      jobId: job?.id,
      error: error.message,
      attempts: job?.attemptsMade,
    });
  });

  worker.on('error', (error) => {
    logger.error('Calendly worker error', { error: error.message });
  });

  return worker;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  logger.info('Starting Calendly polling worker...');

  // Connect to database (needed for Redis)
  await connectDatabase();

  // Check Calendly configuration
  if (!CalendlyService.isConfigured()) {
    logger.warn('Calendly is not fully configured. Worker will skip polling.');
    logger.warn('Please set CALENDLY_ACCESS_TOKEN, CALENDLY_ORGANIZATION_URI, and CALENDLY_EVENT_TYPE_URI');
  } else {
    // Test connection
    const connected = await CalendlyService.testConnection();
    if (!connected) {
      logger.error('Failed to connect to Calendly API');
    }
  }

  const worker = createWorker();

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down Calendly worker...`);

    await worker.close();
    logger.info('Calendly worker stopped');

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('Calendly worker started and listening for jobs');
}

// Run if this is the main module
main().catch((error) => {
  logger.error('Failed to start Calendly worker', { error });
  process.exit(1);
});

// ============================================================================
// Exports
// ============================================================================

export {
  processCalendlyPoll,
  processEvent,
  createWorker,
  getProcessedEventCount,
  LOOKBACK_HOURS,
  PROCESSED_EVENTS_PREFIX,
};
export type { CalendlyJobData, CalendlyJobResult };
