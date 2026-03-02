/**
 * CRM Routes
 *
 * DTO-aligned routes for the admin dashboard frontend.
 * Mounted at /api in server.ts — BEFORE dashboard/analytics/conversations routes
 * so these endpoints take precedence.
 *
 * All routes require JWT authentication.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { dashboardRateLimiter, writeRateLimiter } from '../middleware/rateLimit.middleware.js';
import * as CRM from '../controllers/crm.controller.js';

const router = Router();

router.use(authenticate);
router.use(dashboardRateLimiter);

// ── Leads ──────────────────────────────────────────────────────────────────────

// IMPORTANT: /leads/cursor must come before /leads/:id
router.get('/leads/cursor',  CRM.getLeadsCursor);
router.get('/leads',         CRM.getLeads);
router.get('/leads/:id',     CRM.getLeadById);
router.patch('/leads/:id',   writeRateLimiter, CRM.updateLead);
router.delete('/leads/:id',  writeRateLimiter, CRM.deleteLead);

// ── Conversations ──────────────────────────────────────────────────────────────

router.get('/conversations',                             CRM.getConversations);
router.get('/conversations/:id',                         CRM.getConversationById);
router.get('/conversations/:id/messages/cursor',         CRM.getMessagesCursor);
router.get('/conversations/:id/messages',                CRM.getMessages);
router.post('/conversations/:id/messages', writeRateLimiter, CRM.sendMessage);
router.patch('/conversations/:id/status',  writeRateLimiter, CRM.updateConversationStatus);

// ── Analytics ──────────────────────────────────────────────────────────────────

router.get('/analytics/overview', CRM.getOverview);

// ── Settings ───────────────────────────────────────────────────────────────────

router.get('/settings',                       CRM.getSettings);
router.patch('/settings',   writeRateLimiter, CRM.updateSettings);

// Knowledge base — multipart upload
router.post('/settings/knowledge',        writeRateLimiter, CRM.uploadKnowledgeDocument);
router.delete('/settings/knowledge/:id',  writeRateLimiter, CRM.deleteKnowledgeDocument);

export default router;
