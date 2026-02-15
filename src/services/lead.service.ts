/**
 * Lead Service - Business Logic Layer
 *
 * Wraps the Lead model with phone normalization and business logic.
 *
 * @example
 * import * as LeadService from './services/lead.service.js';
 *
 * const lead = await LeadService.createLead('050-123-4567', { name: 'John' });
 * const progress = LeadService.getLeadProgress(lead); // 40
 * const canQualify = LeadService.canQualifyLead(lead); // true if has name+subjects+level
 */

import * as LeadModel from '../models/lead.model.js';
import { normalizePhone, normalizePhoneSafe } from '../utils/phone-normalizer.js';
import logger from '../utils/logger.js';
import type { Lead, UpdateLeadInput, LeadStatusType } from '../types/index.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Days of inactivity before a lead is considered disengaged
 */
const ENGAGEMENT_THRESHOLD_DAYS = 7;

/**
 * Profile completeness weights (must sum to 100)
 */
const PROFILE_WEIGHTS = {
  name: 15,
  subjects: 20,
  level: 15,
  grade_details: 10,
  format_preference: 10,
  parent_or_student: 10,
  has_exam: 5,
  urgency: 5,
  status_qualified: 10,  // Bonus for reaching qualified status
} as const;

// ============================================================================
// CRUD Wrappers with Phone Normalization
// ============================================================================

/**
 * Create a new lead with phone normalization
 *
 * @param phone - Phone number in any format
 * @param data - Optional initial data
 * @returns The created lead
 * @throws Error if phone is invalid or lead already exists
 */
export async function createLead(
  phone: string,
  data?: Partial<Omit<Lead, 'id' | 'phone' | 'created_at' | 'updated_at'>>
): Promise<Lead> {
  // Normalize phone number
  const normalizedPhone = normalizePhone(phone);

  logger.info('Creating lead', {
    phone: normalizedPhone.slice(-4).padStart(normalizedPhone.length, '*'),
    hasName: !!data?.name,
  });

  try {
    const lead = await LeadModel.create(normalizedPhone, data);

    logger.info('Lead created successfully', {
      leadId: lead.id,
      status: lead.status,
    });

    return lead;
  } catch (error) {
    logger.error('Failed to create lead', {
      phone: normalizedPhone.slice(-4).padStart(normalizedPhone.length, '*'),
      error,
    });
    throw error;
  }
}

/**
 * Find or create a lead with phone normalization
 *
 * @param phone - Phone number in any format
 * @param data - Optional data if creating
 * @returns The existing or newly created lead
 */
export async function findOrCreateLead(
  phone: string,
  data?: Partial<Omit<Lead, 'id' | 'phone' | 'created_at' | 'updated_at'>>
): Promise<{ lead: Lead; created: boolean }> {
  // Normalize phone number
  const normalizedPhone = normalizePhone(phone);

  const result = await LeadModel.findOrCreate(normalizedPhone, data);

  if (result.created) {
    logger.info('New lead created via findOrCreate', {
      leadId: result.lead.id,
    });
  } else {
    logger.debug('Existing lead found via findOrCreate', {
      leadId: result.lead.id,
    });
  }

  return result;
}

/**
 * Update a lead with logging
 *
 * @param id - Lead UUID
 * @param data - Fields to update
 * @returns The updated lead or null
 */
export async function updateLead(
  id: string,
  data: UpdateLeadInput
): Promise<Lead | null> {
  logger.debug('Updating lead', {
    leadId: id,
    fields: Object.keys(data),
  });

  try {
    const lead = await LeadModel.update(id, data);

    if (lead) {
      logger.info('Lead updated', {
        leadId: id,
        newStatus: lead.status,
        fieldsUpdated: Object.keys(data),
      });
    } else {
      logger.warn('Lead not found for update', { leadId: id });
    }

    return lead;
  } catch (error) {
    logger.error('Failed to update lead', {
      leadId: id,
      error,
    });
    throw error;
  }
}

/**
 * Find a lead by phone number with normalization
 *
 * @param phone - Phone number in any format
 * @returns The lead or null
 */
export async function findLeadByPhone(phone: string): Promise<Lead | null> {
  // Try to normalize, return null if invalid
  const normalizedPhone = normalizePhoneSafe(phone);

  if (!normalizedPhone) {
    logger.warn('Invalid phone number for lookup', { phone });
    return null;
  }

  return LeadModel.findByPhone(normalizedPhone);
}

/**
 * Find a lead by ID
 *
 * @param id - Lead UUID
 * @returns The lead or null
 */
export async function findLeadById(id: string): Promise<Lead | null> {
  return LeadModel.findById(id);
}

/**
 * Delete a lead
 *
 * @param id - Lead UUID
 * @returns true if deleted
 */
export async function deleteLead(id: string): Promise<boolean> {
  const deleted = await LeadModel.remove(id);

  if (deleted) {
    logger.info('Lead deleted', { leadId: id });
  }

  return deleted;
}

/**
 * List leads with filters
 */
export async function listLeads(filters?: {
  status?: LeadStatusType;
  opted_out?: boolean;
  needs_human_followup?: boolean;
  limit?: number;
  offset?: number;
}): Promise<Lead[]> {
  return LeadModel.list(filters);
}

// ============================================================================
// Business Logic Helpers
// ============================================================================

/**
 * Check if a lead can be marked as qualified
 * Requires: name, at least one subject, and level
 *
 * @param lead - Lead to check
 * @returns true if lead has minimum qualification info
 */
export function canQualifyLead(lead: Lead): boolean {
  const hasName = !!lead.name && lead.name.trim().length > 0;
  const hasSubjects = !!lead.subjects && lead.subjects.length > 0;
  const hasLevel = !!lead.level;

  return hasName && hasSubjects && hasLevel;
}

/**
 * Check if lead is ready to receive booking link
 * Requires: qualified + knows format preference
 *
 * @param lead - Lead to check
 * @returns true if lead is ready for booking
 */
export function isReadyForBooking(lead: Lead): boolean {
  return canQualifyLead(lead) && !!lead.format_preference;
}

/**
 * Get lead profile completeness as a percentage (0-100)
 *
 * @param lead - Lead to evaluate
 * @returns Completeness percentage
 */
export function getLeadProgress(lead: Lead): number {
  let progress = 0;

  // Name (15%)
  if (lead.name && lead.name.trim().length > 0) {
    progress += PROFILE_WEIGHTS.name;
  }

  // Subjects (20%)
  if (lead.subjects && lead.subjects.length > 0) {
    progress += PROFILE_WEIGHTS.subjects;
  }

  // Level (15%)
  if (lead.level) {
    progress += PROFILE_WEIGHTS.level;
  }

  // Grade details (10%)
  if (lead.grade_details) {
    progress += PROFILE_WEIGHTS.grade_details;
  }

  // Format preference (10%)
  if (lead.format_preference) {
    progress += PROFILE_WEIGHTS.format_preference;
  }

  // Parent or student (10%)
  if (lead.parent_or_student && lead.parent_or_student !== 'unknown') {
    progress += PROFILE_WEIGHTS.parent_or_student;
  }

  // Has exam (5%)
  if (lead.has_exam !== undefined && lead.has_exam !== null) {
    progress += PROFILE_WEIGHTS.has_exam;
  }

  // Urgency (5%)
  if (lead.urgency) {
    progress += PROFILE_WEIGHTS.urgency;
  }

  // Status bonus (10%)
  const qualifiedStatuses: LeadStatusType[] = ['qualified', 'considering', 'hesitant', 'ready_to_book', 'booked'];
  if (qualifiedStatuses.includes(lead.status)) {
    progress += PROFILE_WEIGHTS.status_qualified;
  }

  return Math.min(progress, 100);
}

/**
 * Check if lead has recent activity (engaged)
 *
 * @param lead - Lead to check
 * @param thresholdDays - Days threshold (default: 7)
 * @returns true if lead has activity within threshold
 */
export function isEngaged(lead: Lead, thresholdDays = ENGAGEMENT_THRESHOLD_DAYS): boolean {
  if (!lead.last_user_message_at) {
    return false;
  }

  const daysSinceLastMessage =
    (Date.now() - new Date(lead.last_user_message_at).getTime()) / (1000 * 60 * 60 * 24);

  return daysSinceLastMessage <= thresholdDays;
}

/**
 * Check if lead is in the active sales funnel (not lost or booked)
 *
 * @param lead - Lead to check
 * @returns true if lead is active
 */
export function isActiveLead(lead: Lead): boolean {
  if (lead.opted_out) {
    return false;
  }

  const inactiveStatuses: LeadStatusType[] = ['booked', 'lost'];
  return !inactiveStatuses.includes(lead.status);
}

/**
 * Get the next recommended action for a lead
 *
 * @param lead - Lead to evaluate
 * @returns Recommended action string
 */
export function getNextAction(lead: Lead): string {
  // Opted out - no action
  if (lead.opted_out) {
    return 'none_opted_out';
  }

  // Already booked - follow up after session
  if (lead.status === 'booked') {
    return 'follow_up_post_session';
  }

  // Lost - re-engagement possible
  if (lead.status === 'lost') {
    return 'consider_re_engagement';
  }

  // Needs human follow-up
  if (lead.needs_human_followup) {
    return 'human_followup_required';
  }

  // New lead - qualify
  if (lead.status === 'new') {
    if (!lead.name) return 'ask_name';
    if (!lead.subjects?.length) return 'ask_subjects';
    if (!lead.level) return 'ask_level';
    return 'qualify_lead';
  }

  // Qualified - present value proposition
  if (lead.status === 'qualified') {
    if (!lead.format_preference) return 'ask_format_preference';
    return 'present_value_proposition';
  }

  // Considering - handle objections or nudge
  if (lead.status === 'considering') {
    if (lead.objection_type && lead.objection_type !== 'none') {
      return `handle_objection_${lead.objection_type}`;
    }
    return 'send_gentle_reminder';
  }

  // Hesitant - address concerns
  if (lead.status === 'hesitant') {
    return 'address_concerns';
  }

  // Ready to book - send booking link
  if (lead.status === 'ready_to_book') {
    return 'send_booking_link';
  }

  return 'continue_conversation';
}

/**
 * Determine if a follow-up should be sent
 *
 * @param lead - Lead to evaluate
 * @returns Whether to send follow-up and which type
 */
export function shouldSendFollowUp(lead: Lead): {
  should: boolean;
  type?: '24h' | '72h' | '7d';
  reason?: string;
} {
  // Don't follow up opted-out leads
  if (lead.opted_out) {
    return { should: false, reason: 'opted_out' };
  }

  // Don't follow up booked leads (different flow)
  if (lead.status === 'booked') {
    return { should: false, reason: 'already_booked' };
  }

  // Don't follow up lost leads
  if (lead.status === 'lost') {
    return { should: false, reason: 'lost' };
  }

  // No user message yet - don't follow up
  if (!lead.last_user_message_at) {
    return { should: false, reason: 'no_user_message' };
  }

  const hoursSinceLastUserMessage =
    (Date.now() - new Date(lead.last_user_message_at).getTime()) / (1000 * 60 * 60);

  // Check if bot sent last message (user hasn't replied)
  const botSentLast = lead.last_bot_message_at && lead.last_user_message_at &&
    new Date(lead.last_bot_message_at) > new Date(lead.last_user_message_at);

  if (!botSentLast) {
    return { should: false, reason: 'awaiting_bot_response' };
  }

  // Determine follow-up type based on time elapsed
  if (hoursSinceLastUserMessage >= 24 && hoursSinceLastUserMessage < 72) {
    return { should: true, type: '24h' };
  }

  if (hoursSinceLastUserMessage >= 72 && hoursSinceLastUserMessage < 168) {
    return { should: true, type: '72h' };
  }

  if (hoursSinceLastUserMessage >= 168) {
    return { should: true, type: '7d' };
  }

  return { should: false, reason: 'too_soon' };
}

// ============================================================================
// Status Transition Helpers
// ============================================================================

/**
 * Attempt to auto-qualify a lead based on collected info
 *
 * @param lead - Lead to potentially qualify
 * @returns Updated lead if qualified, null otherwise
 */
export async function tryAutoQualify(lead: Lead): Promise<Lead | null> {
  if (lead.status !== 'new') {
    return null;
  }

  if (!canQualifyLead(lead)) {
    return null;
  }

  logger.info('Auto-qualifying lead', { leadId: lead.id });

  return updateLead(lead.id, { status: 'qualified' });
}

/**
 * Mark a lead as ready to book
 *
 * @param id - Lead UUID
 * @returns Updated lead
 */
export async function markReadyToBook(id: string): Promise<Lead | null> {
  return updateLead(id, { status: 'ready_to_book', trial_offered: true });
}

/**
 * Mark a lead as lost
 *
 * @param id - Lead UUID
 * @param reason - Optional reason
 * @returns Updated lead
 */
export async function markAsLost(id: string): Promise<Lead | null> {
  return updateLead(id, { status: 'lost' });
}

/**
 * Opt out a lead
 *
 * @param id - Lead UUID
 * @returns Updated lead
 */
export async function optOutLead(id: string): Promise<Lead | null> {
  logger.info('Opting out lead', { leadId: id });
  return updateLead(id, { opted_out: true });
}

/**
 * Flag lead for human follow-up
 *
 * @param id - Lead UUID
 * @returns Updated lead
 */
export async function flagForHumanFollowUp(id: string): Promise<Lead | null> {
  logger.info('Flagging lead for human follow-up', { leadId: id });
  return updateLead(id, { needs_human_followup: true });
}

// ============================================================================
// Exports
// ============================================================================

export { ENGAGEMENT_THRESHOLD_DAYS, PROFILE_WEIGHTS };
