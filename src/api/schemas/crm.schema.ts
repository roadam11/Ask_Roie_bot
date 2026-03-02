/**
 * CRM Zod Schemas
 *
 * Validation schemas for CRM endpoints (leads, conversations, settings).
 * Each schema matches exactly what the corresponding controller expects.
 */

import { z } from 'zod';

// ── Leads ──────────────────────────────────────────────────────────────────────

/** PATCH /api/leads/:id */
export const updateLeadSchema = z.object({
  name:       z.string().nullish(),
  subjects:   z.array(z.string()).nullish(),
  level:      z.string().nullish(),
  status:     z.string().nullish(),
  lead_state: z.string().nullish(),
  lead_value: z.number().nullish(),
}).strip();

// ── Conversations ──────────────────────────────────────────────────────────────

/** POST /api/conversations/:id/messages */
export const sendMessageSchema = z.object({
  text:   z.string().min(1, 'Text is required').max(4000, 'Text must be 4000 characters or less'),
  sender: z.string().optional(),
}).strip();

/** PATCH /api/conversations/:id/status */
export const updateConversationStatusSchema = z.object({
  status: z.enum(['open', 'resolved', 'flagged'], {
    errorMap: () => ({ message: 'Status must be open, resolved, or flagged' }),
  }),
}).strip();

// ── Settings ───────────────────────────────────────────────────────────────────

/** PATCH /api/settings */
export const updateSettingsSchema = z.object({
  profile:  z.record(z.unknown()).optional(),
  behavior: z.record(z.unknown()).optional(),
}).strip();

/** POST /api/settings/knowledge (JSON body fallback when no multipart file) */
export const uploadKnowledgeDocumentSchema = z.object({
  name: z.string().min(1, 'Document name is required').optional(),
  size: z.number().nonnegative().optional(),
}).strip();
