/**
 * Lead Model - Data Access Layer
 *
 * Handles all database operations for leads with special
 * merge logic for arrays and status transition validation.
 *
 * @example
 * import * as LeadModel from './models/lead.model.js';
 *
 * const lead = await LeadModel.create('+972501234567', { name: 'John' });
 * await LeadModel.update(lead.id, { subjects: ['mathematics'], status: 'qualified' });
 * const found = await LeadModel.findByPhone('+972501234567');
 */

import { query, queryOne } from '../database/connection.js';
import logger from '../utils/logger.js';
import type { Lead, UpdateLeadInput, LeadStatusType } from '../types/index.js';

// ============================================================================
// Status Transition Validation
// ============================================================================

/**
 * Status order in the sales funnel (lower index = earlier stage)
 * 'lost' is special - can be set from any status
 */
const STATUS_ORDER: LeadStatusType[] = [
  'new',
  'qualified',
  'considering',
  'hesitant',
  'ready_to_book',
  'booked',
];

/**
 * Check if a status transition is valid
 * Status can only move forward in the funnel, or to 'lost' from any state
 *
 * @param currentStatus - Current lead status
 * @param newStatus - Requested new status
 * @returns true if transition is allowed
 */
function isValidStatusTransition(
  currentStatus: LeadStatusType,
  newStatus: LeadStatusType
): boolean {
  // 'lost' can be set from any status
  if (newStatus === 'lost') {
    return true;
  }

  // If current status is 'lost', can transition to any status (re-engagement)
  if (currentStatus === 'lost') {
    return true;
  }

  const currentIndex = STATUS_ORDER.indexOf(currentStatus);
  const newIndex = STATUS_ORDER.indexOf(newStatus);

  // Can only move forward (or stay the same)
  return newIndex >= currentIndex;
}

/**
 * Get status transition error message
 */
function getStatusTransitionError(
  currentStatus: LeadStatusType,
  newStatus: LeadStatusType
): string {
  return `Invalid status transition: cannot move from '${currentStatus}' to '${newStatus}'. Status can only move forward in the funnel or to 'lost'.`;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new lead
 *
 * @param phone - WhatsApp phone number (with country code)
 * @param data - Optional initial data for the lead
 * @returns The created lead
 * @throws Error if lead with phone already exists
 */
export async function create(
  phone: string,
  data?: Partial<Omit<Lead, 'id' | 'phone' | 'created_at' | 'updated_at'>>
): Promise<Lead> {
  const fields = ['phone'];
  const values: unknown[] = [phone];
  const placeholders = ['$1'];
  let paramIndex = 2;

  // Add optional fields
  if (data?.name !== undefined) {
    fields.push('name');
    values.push(data.name);
    placeholders.push(`$${paramIndex++}`);
  }

  if (data?.subjects !== undefined) {
    fields.push('subjects');
    values.push(data.subjects);
    placeholders.push(`$${paramIndex++}`);
  }

  if (data?.level !== undefined) {
    fields.push('level');
    values.push(data.level);
    placeholders.push(`$${paramIndex++}`);
  }

  if (data?.grade_details !== undefined) {
    fields.push('grade_details');
    values.push(data.grade_details);
    placeholders.push(`$${paramIndex++}`);
  }

  if (data?.format_preference !== undefined) {
    fields.push('format_preference');
    values.push(data.format_preference);
    placeholders.push(`$${paramIndex++}`);
  }

  if (data?.status !== undefined) {
    fields.push('status');
    values.push(data.status);
    placeholders.push(`$${paramIndex++}`);
  }

  if (data?.parent_or_student !== undefined) {
    fields.push('parent_or_student');
    values.push(data.parent_or_student);
    placeholders.push(`$${paramIndex++}`);
  }

  if (data?.has_exam !== undefined) {
    fields.push('has_exam');
    values.push(data.has_exam);
    placeholders.push(`$${paramIndex++}`);
  }

  if (data?.urgency !== undefined) {
    fields.push('urgency');
    values.push(data.urgency);
    placeholders.push(`$${paramIndex++}`);
  }

  if (data?.objection_type !== undefined) {
    fields.push('objection_type');
    values.push(data.objection_type);
    placeholders.push(`$${paramIndex++}`);
  }

  const sql = `
    INSERT INTO leads (${fields.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *
  `;

  try {
    const result = await query<Lead>(sql, values);
    const lead = result.rows[0];

    logger.info('Lead created', {
      leadId: lead.id,
      phone: phone.slice(-4).padStart(phone.length, '*'),
    });

    return lead;
  } catch (error) {
    // Check for unique constraint violation
    if ((error as { code?: string }).code === '23505') {
      logger.warn('Attempted to create duplicate lead', { phone });
      throw new Error(`Lead with phone ${phone} already exists`);
    }
    throw error;
  }
}

/**
 * Find a lead by ID
 *
 * @param id - Lead UUID
 * @returns The lead or null if not found
 */
export async function findById(id: string): Promise<Lead | null> {
  const sql = 'SELECT * FROM leads WHERE id = $1';
  const lead = await queryOne<Lead>(sql, [id]);

  if (lead) {
    logger.debug('Lead found by ID', { leadId: id });
  }

  return lead;
}

/**
 * Find a lead by phone number
 *
 * @param phone - WhatsApp phone number
 * @returns The lead or null if not found
 */
export async function findByPhone(phone: string): Promise<Lead | null> {
  const sql = 'SELECT * FROM leads WHERE phone = $1';
  const lead = await queryOne<Lead>(sql, [phone]);

  if (lead) {
    logger.debug('Lead found by phone', {
      leadId: lead.id,
      phone: phone.slice(-4).padStart(phone.length, '*'),
    });
  }

  return lead;
}

/**
 * Find or create a lead by phone number
 *
 * @param phone - WhatsApp phone number
 * @param data - Optional data if creating
 * @returns The existing or newly created lead
 */
export async function findOrCreate(
  phone: string,
  data?: Partial<Omit<Lead, 'id' | 'phone' | 'created_at' | 'updated_at'>>
): Promise<{ lead: Lead; created: boolean }> {
  const existing = await findByPhone(phone);

  if (existing) {
    return { lead: existing, created: false };
  }

  const newLead = await create(phone, data);
  return { lead: newLead, created: true };
}

/**
 * Update a lead with special merge logic
 *
 * - subjects: MERGE (add new items without removing existing)
 * - All other fields: OVERWRITE
 * - Status: validated for forward-only transitions
 *
 * @param id - Lead UUID
 * @param data - Fields to update
 * @returns The updated lead or null if not found
 * @throws Error if status transition is invalid
 */
export async function update(
  id: string,
  data: UpdateLeadInput
): Promise<Lead | null> {
  // First, get the current lead
  const currentLead = await findById(id);

  if (!currentLead) {
    logger.warn('Attempted to update non-existent lead', { leadId: id });
    return null;
  }

  // Validate status transition
  if (data.status && data.status !== currentLead.status) {
    if (!isValidStatusTransition(currentLead.status, data.status)) {
      const error = getStatusTransitionError(currentLead.status, data.status);
      logger.warn('Invalid status transition attempted', {
        leadId: id,
        currentStatus: currentLead.status,
        requestedStatus: data.status,
      });
      throw new Error(error);
    }
  }

  // Build update query
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  // Handle subjects with MERGE logic
  if (data.subjects !== undefined) {
    // Merge new subjects with existing, removing duplicates
    const existingSubjects = currentLead.subjects || [];
    const mergedSubjects = [...new Set([...existingSubjects, ...data.subjects])];
    updates.push(`subjects = $${paramIndex++}`);
    values.push(mergedSubjects);
  }

  // Handle all other fields with OVERWRITE logic
  const overwriteFields: (keyof UpdateLeadInput)[] = [
    'name',
    'level',
    'grade_details',
    'format_preference',
    'status',
    'parent_or_student',
    'has_exam',
    'urgency',
    'objection_type',
    'trial_offered',
    'booking_completed',
    'booked_at',
    'calendly_event_uri',
    'opted_out',
    'needs_human_followup',
    'last_user_message_at',
    'last_bot_message_at',
    'last_followup_sent_at',
  ];

  for (const field of overwriteFields) {
    if (data[field] !== undefined) {
      updates.push(`${field} = $${paramIndex++}`);
      values.push(data[field]);
    }
  }

  // If no updates, return current lead
  if (updates.length === 0) {
    logger.debug('No updates to apply', { leadId: id });
    return currentLead;
  }

  // Add updated_at
  updates.push(`updated_at = NOW()`);

  // Add the ID as the last parameter
  values.push(id);

  const sql = `
    UPDATE leads
    SET ${updates.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = await query<Lead>(sql, values);
  const updatedLead = result.rows[0];

  logger.info('Lead updated', {
    leadId: id,
    updatedFields: Object.keys(data),
    statusChange: data.status ? `${currentLead.status} → ${data.status}` : undefined,
  });

  return updatedLead;
}

/**
 * Delete a lead
 *
 * @param id - Lead UUID
 * @returns true if deleted, false if not found
 */
export async function remove(id: string): Promise<boolean> {
  const sql = 'DELETE FROM leads WHERE id = $1 RETURNING id';
  const result = await query(sql, [id]);

  if (result.rowCount && result.rowCount > 0) {
    logger.info('Lead deleted', { leadId: id });
    return true;
  }

  logger.warn('Attempted to delete non-existent lead', { leadId: id });
  return false;
}

/**
 * List leads with optional filters
 *
 * @param filters - Optional filters and pagination
 * @returns Array of leads
 */
export async function list(filters?: {
  status?: LeadStatusType;
  opted_out?: boolean;
  needs_human_followup?: boolean;
  limit?: number;
  offset?: number;
}): Promise<Lead[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (filters?.status) {
    conditions.push(`status = $${paramIndex++}`);
    values.push(filters.status);
  }

  if (filters?.opted_out !== undefined) {
    conditions.push(`opted_out = $${paramIndex++}`);
    values.push(filters.opted_out);
  }

  if (filters?.needs_human_followup !== undefined) {
    conditions.push(`needs_human_followup = $${paramIndex++}`);
    values.push(filters.needs_human_followup);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const limit = filters?.limit || 100;
  const offset = filters?.offset || 0;

  const sql = `
    SELECT * FROM leads
    ${whereClause}
    ORDER BY updated_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;

  values.push(limit, offset);

  const result = await query<Lead>(sql, values);

  logger.debug('Leads listed', {
    count: result.rows.length,
    filters,
  });

  return result.rows;
}

// ============================================================================
// Specialized Queries
// ============================================================================

/**
 * Find leads that need follow-up
 * Returns leads that:
 * - Have not opted out
 * - Are not booked or lost
 * - Haven't received a follow-up in the last 24 hours
 * - Have been contacted but not responded
 */
export async function findLeadsNeedingFollowUp(limit = 50): Promise<Lead[]> {
  const sql = `
    SELECT * FROM leads
    WHERE opted_out = FALSE
      AND status NOT IN ('booked', 'lost')
      AND last_bot_message_at IS NOT NULL
      AND (last_followup_sent_at IS NULL OR last_followup_sent_at < NOW() - INTERVAL '24 hours')
      AND (last_user_message_at IS NULL OR last_user_message_at < last_bot_message_at)
    ORDER BY last_bot_message_at ASC
    LIMIT $1
  `;

  const result = await query<Lead>(sql, [limit]);

  logger.debug('Found leads needing follow-up', { count: result.rows.length });

  return result.rows;
}

/**
 * Find leads approaching 24h WhatsApp window expiry
 * Returns leads where:
 * - Last user message was 20-24 hours ago
 * - Not opted out
 * - Not booked or lost
 */
export async function findLeadsApproachingWindowExpiry(): Promise<Lead[]> {
  const sql = `
    SELECT * FROM leads
    WHERE opted_out = FALSE
      AND status NOT IN ('booked', 'lost')
      AND last_user_message_at IS NOT NULL
      AND last_user_message_at > NOW() - INTERVAL '24 hours'
      AND last_user_message_at < NOW() - INTERVAL '20 hours'
    ORDER BY last_user_message_at ASC
  `;

  const result = await query<Lead>(sql, []);

  logger.debug('Found leads approaching window expiry', { count: result.rows.length });

  return result.rows;
}

/**
 * Find leads with status 'ready_to_book' that might need Calendly check
 */
export async function findLeadsReadyToBook(): Promise<Lead[]> {
  const sql = `
    SELECT * FROM leads
    WHERE status = 'ready_to_book'
      AND opted_out = FALSE
      AND booking_completed = FALSE
    ORDER BY updated_at DESC
  `;

  const result = await query<Lead>(sql, []);

  return result.rows;
}

/**
 * Update lead timestamp when user sends a message
 */
export async function updateUserMessageTimestamp(id: string): Promise<void> {
  const sql = `
    UPDATE leads
    SET last_user_message_at = NOW(), updated_at = NOW()
    WHERE id = $1
  `;

  await query(sql, [id]);
}

/**
 * Update lead timestamp when bot sends a message
 */
export async function updateBotMessageTimestamp(id: string): Promise<void> {
  const sql = `
    UPDATE leads
    SET last_bot_message_at = NOW(), updated_at = NOW()
    WHERE id = $1
  `;

  await query(sql, [id]);
}

/**
 * Mark lead as booked (called by Calendly polling worker only)
 */
export async function markAsBooked(
  id: string,
  calendlyEventUri: string
): Promise<Lead | null> {
  const sql = `
    UPDATE leads
    SET status = 'booked',
        booking_completed = TRUE,
        booked_at = NOW(),
        calendly_event_uri = $1,
        updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `;

  const result = await query<Lead>(sql, [calendlyEventUri, id]);

  if (result.rows[0]) {
    logger.info('Lead marked as booked', {
      leadId: id,
      calendlyEventUri,
    });
  }

  return result.rows[0] || null;
}

/**
 * Get lead count by status (for analytics)
 */
export async function countByStatus(): Promise<Record<LeadStatusType, number>> {
  const sql = `
    SELECT status, COUNT(*)::int as count
    FROM leads
    GROUP BY status
  `;

  const result = await query<{ status: LeadStatusType; count: number }>(sql, []);

  const counts: Record<LeadStatusType, number> = {
    new: 0,
    qualified: 0,
    considering: 0,
    hesitant: 0,
    ready_to_book: 0,
    booked: 0,
    lost: 0,
  };

  for (const row of result.rows) {
    counts[row.status] = row.count;
  }

  return counts;
}
