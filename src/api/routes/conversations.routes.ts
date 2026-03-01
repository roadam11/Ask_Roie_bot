/**
 * Conversations API Routes
 *
 * Conversation search, browsing, and QA endpoints:
 * - Full-text search with Hebrew support
 * - Conversation details with timeline
 * - QA flagging and metrics
 *
 * @example
 * import conversationsRoutes from './api/routes/conversations.routes.js';
 * app.use('/api', conversationsRoutes);
 */

import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { dashboardRateLimiter, writeRateLimiter } from '../middleware/rateLimit.middleware.js';
import * as ConversationsController from '../controllers/conversations.controller.js';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);
router.use(dashboardRateLimiter);

// ============================================================================
// Search & Browse
// ============================================================================

/**
 * GET /api/conversations/search
 *
 * Full-text search across conversations with filters.
 *
 * @query {string} q - Search text (Hebrew supported)
 * @query {string} intent - Filter by intent (comma-separated)
 * @query {string} state - Filter by lead state (comma-separated)
 * @query {number} confidenceMin - Minimum confidence (0-1)
 * @query {number} confidenceMax - Maximum confidence (0-1)
 * @query {string} dateFrom - Start date (ISO format)
 * @query {string} dateTo - End date (ISO format)
 * @query {string} platform - Filter by platform (whatsapp, telegram)
 * @query {string} outcome - Filter by outcome
 * @query {boolean} hasFlagged - Filter flagged conversations
 * @query {number} page - Page number (default: 1)
 * @query {number} limit - Items per page (default: 20, max: 100)
 * @query {string} sort - Sort by: relevance, date, confidence
 *
 * @returns {object}
 *   - data: Array of conversation summaries with highlights
 *   - pagination: { page, limit, total, totalPages }
 */
router.get('/conversations/search', ConversationsController.searchConversations);

/**
 * GET /api/conversations/recent
 *
 * Returns recent conversations for quick access.
 *
 * @query {number} limit - Max conversations (default: 10)
 *
 * @returns {object}
 *   - data: Array of recent conversations
 */
router.get('/conversations/recent', ConversationsController.getRecentConversations);

/**
 * GET /api/conversations/:id
 *
 * Returns full conversation details with messages and telemetry.
 *
 * @param {string} id - Conversation UUID
 * @query {boolean} includeMessages - Include messages (default: true)
 * @query {boolean} includeTelemetry - Include AI telemetry (default: true)
 * @query {boolean} includeTimeline - Include timeline events (default: true)
 *
 * @returns {object}
 *   - conversation: Conversation metadata
 *   - lead: Lead info
 *   - messages: Array of messages
 *   - telemetry: Array of AI interactions
 *   - timeline: Array of timeline events
 */
router.get('/conversations/:id', ConversationsController.getConversationById);

/**
 * GET /api/conversations/:id/timeline
 *
 * Returns visual timeline of conversation events.
 *
 * @param {string} id - Conversation UUID
 *
 * @returns {object}
 *   - events: Array of timeline events with timestamps
 */
router.get('/conversations/:id/timeline', ConversationsController.getConversationTimeline);

/**
 * GET /api/conversations/:id/decision-path
 *
 * Returns AI decision path for a specific message.
 *
 * @param {string} id - Conversation UUID
 * @query {string} messageId - Specific message ID (optional)
 *
 * @returns {object}
 *   - decisionPaths: Array of decision path objects
 */
router.get('/conversations/:id/decision-path', ConversationsController.getDecisionPath);

// ============================================================================
// QA Flagging
// ============================================================================

/**
 * POST /api/conversations/:id/flag
 *
 * Flag a conversation for review.
 *
 * @param {string} id - Conversation UUID
 * @body {string} flagType - Type of flag
 * @body {string} severity - low, medium, high, critical
 * @body {string} reason - Description of the issue
 * @body {string} messageId - Optional specific message ID
 *
 * @returns {object}
 *   - success: boolean
 *   - flag: Created flag object
 */
router.post(
  '/conversations/:id/flag',
  writeRateLimiter,
  ConversationsController.flagConversation
);

/**
 * GET /api/conversations/:id/flags
 *
 * Returns flags for a conversation.
 *
 * @param {string} id - Conversation UUID
 *
 * @returns {object}
 *   - flags: Array of QA flags
 */
router.get('/conversations/:id/flags', ConversationsController.getConversationFlags);

// ============================================================================
// QA Dashboard
// ============================================================================

/**
 * GET /api/conversations/qa/metrics
 *
 * Returns QA metrics and summary.
 *
 * @query {string} dateFrom - Start date
 * @query {string} dateTo - End date
 *
 * @returns {object}
 *   - summary: { totalFlags, openFlags, avgResolutionTime }
 *   - byType: Array of flag counts by type
 *   - bySeverity: Array of flag counts by severity
 *   - trends: Array of daily flag counts
 */
router.get('/conversations/qa/metrics', ConversationsController.getQAMetrics);

/**
 * GET /api/conversations/qa/flags
 *
 * Returns paginated list of QA flags.
 *
 * @query {string} status - Filter by status (open, in_review, resolved)
 * @query {string} severity - Filter by severity
 * @query {string} type - Filter by flag type
 * @query {number} page - Page number
 * @query {number} limit - Items per page
 *
 * @returns {object}
 *   - data: Array of flags with conversation info
 *   - pagination: { page, limit, total, totalPages }
 */
router.get('/conversations/qa/flags', ConversationsController.getQAFlags);

/**
 * PUT /api/conversations/qa/flags/:flagId
 *
 * Update a QA flag (resolve, add notes, etc).
 * Requires manager or admin role.
 *
 * @param {string} flagId - Flag UUID
 * @body {string} status - New status
 * @body {string} resolutionNotes - Notes for resolution
 *
 * @returns {object}
 *   - success: boolean
 *   - flag: Updated flag object
 */
router.put(
  '/conversations/qa/flags/:flagId',
  requireRole('admin', 'manager'),
  writeRateLimiter,
  ConversationsController.updateQAFlag
);

/**
 * GET /api/conversations/qa/patterns
 *
 * Returns common failure patterns.
 *
 * @query {number} limit - Max patterns (default: 10)
 *
 * @returns {object}
 *   - patterns: Array of { pattern, count, examples }
 */
router.get('/conversations/qa/patterns', ConversationsController.getFailurePatterns);

/**
 * GET /api/conversations/qa/ab-tests
 *
 * Returns A/B test results for prompt versions.
 *
 * @query {string} status - active, completed, all
 *
 * @returns {object}
 *   - tests: Array of A/B test results
 */
router.get('/conversations/qa/ab-tests', ConversationsController.getABTestResults);

// ============================================================================
// Export
// ============================================================================

/**
 * POST /api/conversations/export
 *
 * Export conversations for training data.
 * Requires manager or admin role.
 *
 * @body {object} filters - Same as search filters
 * @body {string} format - jsonl, csv (default: jsonl)
 * @body {boolean} includeAnnotations - Include QA annotations
 *
 * @returns {object}
 *   - downloadUrl: URL to download file
 *   - count: Number of exported conversations
 */
router.post(
  '/conversations/export',
  requireRole('admin', 'manager'),
  writeRateLimiter,
  ConversationsController.exportConversations
);

export default router;
