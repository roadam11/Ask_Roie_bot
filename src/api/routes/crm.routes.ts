/**
 * CRM Routes
 *
 * DTO-aligned routes for the admin dashboard frontend.
 * Mounted at /api in server.ts — BEFORE dashboard/analytics/conversations routes
 * so these endpoints take precedence.
 *
 * All routes require JWT authentication.
 * All async handlers wrapped in asyncHandler to prevent unhandled rejections.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { dashboardRateLimiter, writeRateLimiter } from '../middleware/rateLimit.middleware.js';
import { validateBody } from '../middleware/validate.js';
import {
  updateLeadSchema,
  sendMessageSchema,
  updateConversationStatusSchema,
  updateSettingsSchema,
  uploadKnowledgeDocumentSchema,
} from '../schemas/crm.schema.js';
import * as CRM from '../controllers/crm.controller.js';

const router = Router();

router.use(authenticate);
router.use(dashboardRateLimiter);

// ── Leads ──────────────────────────────────────────────────────────────────────

// IMPORTANT: /leads/cursor must come before /leads/:id
router.get('/leads/cursor',  asyncHandler(CRM.getLeadsCursor));
router.get('/leads',         asyncHandler(CRM.getLeads));
router.get('/leads/:id',     asyncHandler(CRM.getLeadById));
router.patch('/leads/:id',   writeRateLimiter, validateBody(updateLeadSchema), asyncHandler(CRM.updateLead));
router.delete('/leads/:id',         writeRateLimiter, asyncHandler(CRM.deleteLead));
router.patch('/leads/:id/restore',  writeRateLimiter, asyncHandler(CRM.restoreLead));

// ── Conversations ──────────────────────────────────────────────────────────────

router.get('/conversations',                             asyncHandler(CRM.getConversations));
router.get('/conversations/:id',                         asyncHandler(CRM.getConversationById));
router.get('/conversations/:id/messages/cursor',         asyncHandler(CRM.getMessagesCursor));
router.get('/conversations/:id/messages',                asyncHandler(CRM.getMessages));
router.post('/conversations/:id/messages', writeRateLimiter, validateBody(sendMessageSchema), asyncHandler(CRM.sendMessage));
router.patch('/conversations/:id/status',  writeRateLimiter, validateBody(updateConversationStatusSchema), asyncHandler(CRM.updateConversationStatus));

// ── Analytics ──────────────────────────────────────────────────────────────────

router.get('/analytics/overview',   asyncHandler(CRM.getOverview));
router.get('/analytics/dashboard', asyncHandler(CRM.getAnalyticsDashboard));

// ── Settings ───────────────────────────────────────────────────────────────────

router.get('/settings',                       asyncHandler(CRM.getSettings));
router.patch('/settings',   writeRateLimiter, validateBody(updateSettingsSchema), asyncHandler(CRM.updateSettings));

// Knowledge base — multipart upload
router.post('/settings/knowledge',        writeRateLimiter, validateBody(uploadKnowledgeDocumentSchema), asyncHandler(CRM.uploadKnowledgeDocument));
router.delete('/settings/knowledge/:id',  writeRateLimiter, asyncHandler(CRM.deleteKnowledgeDocument));

export default router;
