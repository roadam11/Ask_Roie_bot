/**
 * Follow-Up Worker
 *
 * BullMQ worker process for sending scheduled follow-up messages.
 * Handles 24h, 72h, and 7-day follow-ups with WhatsApp window awareness.
 *
 * @usage
 * npm run worker:followup
 * # or
 * tsx src/workers/followup.worker.ts
 */

import { Worker, Job } from 'bullmq';
import { connectionOptions } from './queue.js';
import * as LeadModel from '../models/lead.model.js';
import * as FollowUpModel from '../models/followup.model.js';
import * as WhatsAppService from '../services/whatsapp.service.js';
import {
  isWithin24HourWindow,
  mustUseTemplate,
} from '../utils/whatsapp-window.js';
import logger from '../utils/logger.js';
import type { Lead } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Follow-up job data structure
 */
interface FollowUpJobData {
  leadId: string;
  type: '24h' | '72h' | '7d';
  followUpId: string;
}

/**
 * Follow-up job result
 */
interface FollowUpJobResult {
  success: boolean;
  leadId: string;
  type: string;
  messageType: 'freeform' | 'template' | 'skipped';
  reason?: string;
}

// ============================================================================
// Follow-Up Messages
// ============================================================================

/**
 * Follow-up message templates (freeform - within 24h window)
 */
const FOLLOWUP_MESSAGES: Record<string, (lead: Lead) => string> = {
  '24h': (lead) => {
    const name = lead.name || '';
    return `היי${name ? ` ${name}` : ''}! 👋

רק רציתי לוודא שקיבלת את ההודעה שלי.
יש לך שאלות על השיעורים הפרטיים?

אשמח לעזור! 😊`;
  },

  '72h': (lead) => {
    const name = lead.name || '';
    const subject = lead.subjects?.[0] || 'הלימודים';
    return `שלום${name ? ` ${name}` : ''}!

לא שמעתי ממך כבר כמה ימים.
רק רציתי להזכיר שאני כאן אם תצטרך עזרה ב${subject}.

שיעור ניסיון ראשון הוא בחינם - מה דעתך? 🎓`;
  },

  '7d': (lead) => {
    const name = lead.name || '';
    return `היי${name ? ` ${name}` : ''},

עבר קצת זמן מאז ששוחחנו.
אם עדיין מעניין אותך לשפר את הציונים, אשמח לעזור!

שלח הודעה ונתחיל 📚`;
  },
};

/**
 * WhatsApp template names for follow-ups (outside 24h window)
 */
const FOLLOWUP_TEMPLATES: Record<string, string> = {
  '24h': 'followup_24h',
  '72h': 'followup_72h',
  '7d': 'followup_7d',
};

// ============================================================================
// Worker Logic
// ============================================================================

/**
 * Process a follow-up job
 */
async function processFollowUp(job: Job<FollowUpJobData>): Promise<FollowUpJobResult> {
  const { leadId, type, followUpId } = job.data;

  logger.info('Processing follow-up job', {
    jobId: job.id,
    leadId,
    type,
    followUpId,
  });

  try {
    // Get lead
    const lead = await LeadModel.findById(leadId);

    if (!lead) {
      logger.warn('Lead not found for follow-up', { leadId, followUpId });
      await FollowUpModel.cancel(followUpId);
      return {
        success: false,
        leadId,
        type,
        messageType: 'skipped',
        reason: 'Lead not found',
      };
    }

    // Check eligibility
    const eligibilityCheck = checkEligibility(lead);
    if (!eligibilityCheck.eligible) {
      logger.info('Lead not eligible for follow-up', {
        leadId,
        reason: eligibilityCheck.reason,
      });
      await FollowUpModel.cancel(followUpId);
      return {
        success: false,
        leadId,
        type,
        messageType: 'skipped',
        reason: eligibilityCheck.reason,
      };
    }

    // Check WhatsApp 24h window
    const within24h = isWithin24HourWindow(lead.last_user_message_at ?? null);
    const needsTemplate = mustUseTemplate(lead.last_user_message_at ?? null);

    let messageType: 'freeform' | 'template';

    if (within24h && !needsTemplate) {
      // Can send freeform message
      messageType = 'freeform';
      const messageGenerator = FOLLOWUP_MESSAGES[type];
      const message = messageGenerator(lead);

      await WhatsAppService.sendTextMessage(lead.phone, message);

      logger.info('Freeform follow-up sent', {
        leadId,
        type,
        phone: maskPhone(lead.phone),
      });
    } else {
      // Must use template
      messageType = 'template';
      const templateName = FOLLOWUP_TEMPLATES[type];

      // Build template components with lead's name
      const components = lead.name
        ? [
            {
              type: 'body' as const,
              parameters: [{ type: 'text' as const, text: lead.name }],
            },
          ]
        : undefined;

      await WhatsAppService.sendTemplateMessage(
        lead.phone,
        templateName,
        'he',
        components
      );

      logger.info('Template follow-up sent', {
        leadId,
        type,
        templateName,
        phone: maskPhone(lead.phone),
      });
    }

    // Mark follow-up as sent
    await FollowUpModel.markAsSent(followUpId);

    // Update lead's last follow-up timestamp
    await LeadModel.update(leadId, {
      last_followup_sent_at: new Date(),
    });

    logger.info('Follow-up completed successfully', {
      jobId: job.id,
      leadId,
      type,
      messageType,
    });

    return {
      success: true,
      leadId,
      type,
      messageType,
    };
  } catch (error) {
    logger.error('Follow-up job failed', {
      jobId: job.id,
      leadId,
      type,
      error: (error as Error).message,
    });

    throw error; // Re-throw for BullMQ retry logic
  }
}

/**
 * Check if lead is eligible for follow-up
 */
function checkEligibility(lead: Lead): { eligible: boolean; reason?: string } {
  // Check if opted out
  if (lead.opted_out) {
    return { eligible: false, reason: 'Lead opted out' };
  }

  // Check if already booked
  if (lead.status === 'booked') {
    return { eligible: false, reason: 'Lead already booked' };
  }

  // Check if lost
  if (lead.status === 'lost') {
    return { eligible: false, reason: 'Lead marked as lost' };
  }

  // Check if needs human follow-up (should be handled by human)
  if (lead.needs_human_followup) {
    return { eligible: false, reason: 'Requires human follow-up' };
  }

  // Check cooldown - at least 24h since last follow-up
  if (lead.last_followup_sent_at) {
    const hoursSinceLastFollowup =
      (Date.now() - new Date(lead.last_followup_sent_at).getTime()) / (1000 * 60 * 60);

    if (hoursSinceLastFollowup < 24) {
      return {
        eligible: false,
        reason: `Cooldown active: ${(24 - hoursSinceLastFollowup).toFixed(1)}h remaining`,
      };
    }
  }

  return { eligible: true };
}

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
 * Create and start the follow-up worker
 */
function createWorker(): Worker<FollowUpJobData, FollowUpJobResult> {
  const worker = new Worker<FollowUpJobData, FollowUpJobResult>(
    'followup',
    processFollowUp,
    {
      connection: connectionOptions,
      concurrency: 5, // Process up to 5 jobs concurrently
      limiter: {
        max: 10, // Max 10 jobs per minute (WhatsApp rate limiting)
        duration: 60000,
      },
    }
  );

  // Worker event handlers
  worker.on('completed', (job, result) => {
    logger.debug('Worker job completed', {
      jobId: job.id,
      result,
    });
  });

  worker.on('failed', (job, error) => {
    logger.error('Worker job failed', {
      jobId: job?.id,
      error: error.message,
      attempts: job?.attemptsMade,
    });
  });

  worker.on('error', (error) => {
    logger.error('Worker error', { error: error.message });
  });

  worker.on('stalled', (jobId) => {
    logger.warn('Worker job stalled', { jobId });
  });

  return worker;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  logger.info('Starting follow-up worker...');

  const worker = createWorker();

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down follow-up worker...`);

    await worker.close();
    logger.info('Follow-up worker stopped');

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('Follow-up worker started and listening for jobs');
}

// Run if this is the main module
main().catch((error) => {
  logger.error('Failed to start follow-up worker', { error });
  process.exit(1);
});

// ============================================================================
// Exports
// ============================================================================

export { processFollowUp, checkEligibility, createWorker };
export type { FollowUpJobData, FollowUpJobResult };
