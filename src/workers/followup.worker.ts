/**
 * Follow-Up Worker
 *
 * BullMQ worker process for sending scheduled follow-up messages.
 * Handles both:
 * - Legacy follow-ups: 24h, 72h, 7d
 * - Automation follow-ups: thinking_24h, trial_reminder_2h, trial_followup_24h, idle_48h
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
import * as TelegramService from '../services/telegram.service.js';
import {
  isWithin24HourWindow,
  mustUseTemplate,
} from '../utils/whatsapp-window.js';
import { buildFollowUpMessage } from '../prompts/follow-up-messages.js';
import { markFollowUpSent } from '../services/follow-up-decision.service.js';
import logger from '../utils/logger.js';
import type { Lead, AutomationFollowUpType } from '../types/index.js';

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Detect platform from lead's phone/identifier
 * Telegram leads have 'tg_' prefix
 */
function detectPlatform(phone: string): 'whatsapp' | 'telegram' {
  return phone.startsWith('tg_') ? 'telegram' : 'whatsapp';
}

/**
 * Extract Telegram chat ID from identifier
 */
function extractTelegramChatId(identifier: string): string {
  return identifier.replace('tg_', '');
}

// ============================================================================
// Types
// ============================================================================

/**
 * Legacy follow-up job data structure
 */
interface LegacyFollowUpJobData {
  leadId: string;
  type: '24h' | '72h' | '7d';
  followUpId: string;
}

/**
 * Automation follow-up job data structure
 */
interface AutomationFollowUpJobData {
  leadId: string;
  type: AutomationFollowUpType;
  followUpId: string;
  scheduledAtUtc: string;
  // Optional data for placeholders
  trialTime?: string;
  zoomLink?: string;
}

/**
 * Combined job data (worker handles both types)
 */
type FollowUpJobData = LegacyFollowUpJobData | AutomationFollowUpJobData;

/**
 * Follow-up job result
 */
interface FollowUpJobResult {
  success: boolean;
  leadId: string;
  type: string;
  messageType: 'freeform' | 'template' | 'skipped';
  reason?: string;
  platform?: 'whatsapp' | 'telegram';
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
// Worker Logic (Legacy Follow-ups)
// ============================================================================

/**
 * Process a follow-up job (legacy)
 */
async function processLegacyFollowUp(job: Job<LegacyFollowUpJobData>): Promise<FollowUpJobResult> {
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

// ============================================================================
// Automation Follow-Up Processing
// ============================================================================

/**
 * Check if job is an automation follow-up
 */
function isAutomationFollowUp(data: FollowUpJobData): data is AutomationFollowUpJobData {
  const automationTypes: AutomationFollowUpType[] = [
    'thinking_24h',
    'trial_reminder_2h',
    'trial_followup_24h',
    'idle_48h',
  ];
  return automationTypes.includes(data.type as AutomationFollowUpType);
}

/**
 * Process an automation follow-up job
 * CRITICAL: UTC math only - prevents 2AM messages
 */
async function processAutomationFollowUp(
  job: Job<AutomationFollowUpJobData>
): Promise<FollowUpJobResult> {
  const { leadId, type, followUpId, trialTime, zoomLink } = job.data;

  logger.info('Processing automation follow-up job', {
    jobId: job.id,
    leadId,
    type,
    followUpId,
    attempt: job.attemptsMade + 1,
  });

  try {
    // Get lead
    const lead = await LeadModel.findById(leadId);

    if (!lead) {
      logger.warn('Lead not found for automation follow-up', { leadId, followUpId });
      return {
        success: false,
        leadId,
        type,
        messageType: 'skipped',
        reason: 'Lead not found',
      };
    }

    // Check eligibility (reuse existing function with additional checks)
    const eligibilityCheck = checkAutomationEligibility(lead);
    if (!eligibilityCheck.eligible) {
      logger.info('Lead not eligible for automation follow-up', {
        leadId,
        type,
        reason: eligibilityCheck.reason,
      });
      return {
        success: false,
        leadId,
        type,
        messageType: 'skipped',
        reason: eligibilityCheck.reason,
      };
    }

    // Build personalized message
    const placeholders: Record<string, string> = {};
    if (trialTime) placeholders.time = trialTime;
    if (zoomLink) placeholders.zoom_link = zoomLink;

    const message = buildFollowUpMessage(type, placeholders);

    // Detect platform from phone/identifier
    const platform = detectPlatform(lead.phone);
    let messageType: 'freeform' | 'template' = 'freeform';
    let actualPlatform: 'whatsapp' | 'telegram' = platform;

    if (platform === 'telegram') {
      // Telegram: Always freeform, no 24h window restrictions
      const chatId = extractTelegramChatId(lead.phone);
      await TelegramService.sendMessage(chatId, message);
      messageType = 'freeform';

      logger.info('Automation follow-up sent via Telegram', {
        leadId,
        type,
        chatId: maskPhone(chatId),
      });
    } else {
      // WhatsApp: Check 24h window
      const within24h = isWithin24HourWindow(lead.last_user_message_at ?? null);
      const needsTemplate = mustUseTemplate(lead.last_user_message_at ?? null);

      if (within24h && !needsTemplate) {
        // Can send freeform message
        messageType = 'freeform';
        await WhatsAppService.sendTextMessage(lead.phone, message);

        logger.info('Automation follow-up sent (WhatsApp freeform)', {
          leadId,
          type,
          phone: maskPhone(lead.phone),
        });
      } else {
        // Must use template - try WhatsApp first, fallback to Telegram
        messageType = 'template';
        const templateName = getTemplateForAutomationType(type);

        try {
          // Build template components
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

          logger.info('Automation follow-up sent (WhatsApp template)', {
            leadId,
            type,
            templateName,
            phone: maskPhone(lead.phone),
          });
        } catch (templateError) {
          // Log template error for tracking which templates need to be created
          const errorMsg = templateError instanceof Error ? templateError.message : 'Unknown error';
          logger.error('WhatsApp template failed - TEMPLATE MAY NOT EXIST', {
            leadId,
            type,
            templateName,
            error: errorMsg,
            todo: `Create WhatsApp template: ${templateName}`,
          });

          // Try Telegram fallback if lead has telegram_chat_id stored
          // TODO: Add telegram_chat_id field to leads table for cross-platform
          const telegramChatId = (lead as unknown as Record<string, unknown>).telegram_chat_id as string | undefined;

          if (telegramChatId) {
            logger.info('Falling back to Telegram for WhatsApp template failure', {
              leadId,
              type,
              telegramChatId: maskPhone(telegramChatId),
            });

            await TelegramService.sendMessage(telegramChatId, message);
            messageType = 'freeform';
            actualPlatform = 'telegram';

            logger.info('Automation follow-up sent via Telegram fallback', {
              leadId,
              type,
              telegramChatId: maskPhone(telegramChatId),
            });
          } else {
            // No Telegram fallback available - fail with clear message
            logger.warn('No Telegram fallback available for WhatsApp-only lead', {
              leadId,
              type,
              suggestion: 'Create missing WhatsApp template or collect Telegram contact',
            });
            throw templateError;
          }
        }
      }
    }

    // Mark follow-up as sent (updates DB and lead state)
    await markFollowUpSent(leadId, followUpId);

    logger.info('Automation follow-up completed successfully', {
      jobId: job.id,
      leadId,
      type,
      messageType,
      platform: actualPlatform,
    });

    return {
      success: true,
      leadId,
      type,
      messageType,
      platform: actualPlatform,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Automation follow-up job failed', {
      jobId: job.id,
      leadId,
      type,
      attempt: job.attemptsMade + 1,
      maxAttempts: 3,
      error: errorMessage,
    });

    // Re-throw for BullMQ retry logic (max 3 attempts)
    throw error;
  }
}

/**
 * Check eligibility for automation follow-ups
 * Includes additional checks beyond legacy follow-ups
 */
function checkAutomationEligibility(lead: Lead): { eligible: boolean; reason?: string } {
  // Basic eligibility checks
  if (lead.opted_out) {
    return { eligible: false, reason: 'Lead opted out' };
  }

  if (lead.status === 'booked' && lead.lead_state !== 'trial_scheduled') {
    return { eligible: false, reason: 'Lead already booked' };
  }

  if (lead.status === 'lost') {
    return { eligible: false, reason: 'Lead marked as lost' };
  }

  if (lead.lead_state === 'closed') {
    return { eligible: false, reason: 'Lead state is closed' };
  }

  if (lead.lead_state === 'converted') {
    return { eligible: false, reason: 'Lead already converted' };
  }

  if (lead.needs_human_followup) {
    return { eligible: false, reason: 'Requires human follow-up' };
  }

  // Check max follow-ups (3)
  if ((lead.follow_up_count ?? 0) >= 3) {
    return { eligible: false, reason: 'Max follow-ups reached (3)' };
  }

  // Check human override (48h)
  if (lead.human_contacted_at) {
    const hoursSinceHuman =
      (Date.now() - new Date(lead.human_contacted_at).getTime()) / (1000 * 60 * 60);
    if (hoursSinceHuman < 48) {
      return {
        eligible: false,
        reason: `Human contacted ${Math.round(hoursSinceHuman)}h ago (wait 48h)`,
      };
    }
  }

  return { eligible: true };
}

/**
 * Get WhatsApp template name for automation follow-up type
 * Falls back to generic templates when outside 24h window
 */
function getTemplateForAutomationType(type: AutomationFollowUpType): string {
  // Map automation types to approved WhatsApp templates
  // These should be pre-approved in WhatsApp Business Manager
  const templateMap: Record<AutomationFollowUpType, string> = {
    thinking_24h: 'followup_thinking',
    trial_reminder_2h: 'trial_reminder',
    trial_followup_24h: 'trial_followup',
    idle_48h: 'followup_idle',
  };

  return templateMap[type] || 'followup_generic';
}

// ============================================================================
// Legacy Follow-Up Eligibility
// ============================================================================

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
// Unified Job Processor
// ============================================================================

/**
 * Unified processor that routes to the correct handler
 * Handles both legacy and automation follow-ups
 */
async function processFollowUp(job: Job<FollowUpJobData>): Promise<FollowUpJobResult> {
  // Route based on job name or type
  if (job.name === 'send-automation-followup' || isAutomationFollowUp(job.data)) {
    return processAutomationFollowUp(job as Job<AutomationFollowUpJobData>);
  }

  // Default to legacy processor
  return processLegacyFollowUp(job as Job<LegacyFollowUpJobData>);
}

// ============================================================================
// Worker Setup
// ============================================================================

/**
 * Create and start the follow-up worker
 * Handles both legacy and automation follow-ups
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

export {
  processFollowUp,
  processLegacyFollowUp,
  processAutomationFollowUp,
  checkEligibility,
  checkAutomationEligibility,
  createWorker,
  isAutomationFollowUp,
};
export type {
  FollowUpJobData,
  LegacyFollowUpJobData,
  AutomationFollowUpJobData,
  FollowUpJobResult,
};
