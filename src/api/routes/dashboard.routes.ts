/**
 * Dashboard API Routes
 *
 * RESTful API for admin dashboard functionality.
 * All routes require JWT authentication.
 *
 * @example
 * // Mount in Express app
 * import dashboardRoutes from './api/routes/dashboard.routes.js';
 * app.use('/api', dashboardRoutes);
 */

import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { dashboardRateLimiter, writeRateLimiter } from '../middleware/rateLimit.middleware.js';
import * as DashboardController from '../controllers/dashboard.controller.js';

const router = Router();

// ============================================================================
// Middleware: Apply authentication and rate limiting to all routes
// ============================================================================

router.use(authenticate);
router.use(dashboardRateLimiter);

// ============================================================================
// Dashboard Metrics & Analytics
// ============================================================================

/**
 * GET /api/dashboard/metrics
 *
 * Returns key performance metrics for the dashboard.
 *
 * @returns {DashboardMetrics}
 *   - pipelineValue: Total value of active leads
 *   - closedWonRevenue: Revenue from booked leads
 *   - avgTimeToBook: Average hours from first contact to booking
 *   - leadCounts: Counts per status
 *   - followUpStats: Pending, sent today, response rate
 *
 * @example Response:
 * {
 *   "pipelineValue": 15000,
 *   "closedWonRevenue": 8500,
 *   "avgTimeToBook": 48.5,
 *   "leadCounts": {
 *     "total": 150,
 *     "new": 25,
 *     "qualified": 40,
 *     "considering": 30,
 *     "booked": 45,
 *     "lost": 10
 *   },
 *   "followUpStats": {
 *     "pending": 12,
 *     "sentToday": 5,
 *     "responseRate": 35.5
 *   }
 * }
 */
router.get('/dashboard/metrics', DashboardController.getMetrics);

/**
 * GET /api/dashboard/funnel
 *
 * Returns sales funnel data with conversion rates between stages.
 *
 * @returns {object}
 *   - funnel: Array of FunnelStage objects
 *   - summary: Overall stats
 *
 * @example Response:
 * {
 *   "funnel": [
 *     { "stage": "NEW", "count": 100, "conversionRate": null, "avgTimeInStage": 2.5 },
 *     { "stage": "QUALIFIED", "count": 60, "conversionRate": 60.0, "avgTimeInStage": 12.3 },
 *     { "stage": "CONSIDERING", "count": 40, "conversionRate": 66.7, "avgTimeInStage": 24.0 },
 *     { "stage": "BOOKED", "count": 25, "conversionRate": 62.5, "avgTimeInStage": 48.0 },
 *     { "stage": "LOST", "count": 15, "conversionRate": null, "avgTimeInStage": null }
 *   ],
 *   "summary": {
 *     "totalLeads": 150,
 *     "overallConversionRate": 25.0
 *   }
 * }
 */
router.get('/dashboard/funnel', DashboardController.getFunnel);

/**
 * GET /api/dashboard/analytics
 *
 * Returns grouped analytics data.
 *
 * @query {string} groupBy - Group by: subject, level, format, urgency
 *
 * @returns {object}
 *   - groupBy: The grouping field
 *   - data: Array of GroupedAnalytics objects
 *
 * @example GET /api/dashboard/analytics?groupBy=subject
 * {
 *   "groupBy": "subject",
 *   "data": [
 *     { "group": "מתמטיקה", "leadCount": 50, "bookedCount": 15, "conversionRate": 30.0, "avgValue": 500 },
 *     { "group": "פיזיקה", "leadCount": 30, "bookedCount": 10, "conversionRate": 33.3, "avgValue": 450 }
 *   ]
 * }
 */
router.get('/dashboard/analytics', DashboardController.getAnalytics);

// ============================================================================
// Lead Management
// ============================================================================

/**
 * GET /api/leads
 *
 * Returns paginated list of leads with filtering.
 *
 * @query {string} status - Filter by status
 * @query {string} subject - Filter by subject
 * @query {string} level - Filter by education level
 * @query {string} search - Search in name/phone
 * @query {string} hasFollowUp - Filter by follow-up status (true/false)
 * @query {number} page - Page number (default: 1)
 * @query {number} limit - Items per page (default: 20, max: 100)
 *
 * @returns {PaginatedLeads}
 *
 * @example GET /api/leads?status=qualified&page=1&limit=20
 * {
 *   "data": [...leads],
 *   "pagination": {
 *     "page": 1,
 *     "limit": 20,
 *     "total": 150,
 *     "totalPages": 8
 *   }
 * }
 */
router.get('/leads', DashboardController.getLeads);

/**
 * GET /api/leads/:id
 *
 * Returns detailed lead information including messages and follow-up history.
 *
 * @param {string} id - Lead UUID
 *
 * @returns {object}
 *   - lead: Lead object
 *   - messages: Recent messages (newest 20)
 *   - followups: Follow-up history (newest 10)
 */
router.get('/leads/:id', DashboardController.getLeadById);

/**
 * GET /api/leads/:id/messages
 *
 * Returns conversation messages for a lead.
 *
 * @param {string} id - Lead UUID
 * @query {number} limit - Max messages to return (default: 50, max: 100)
 *
 * @returns {object}
 *   - leadId: Lead UUID
 *   - messages: Array of messages (chronological order)
 *   - count: Number of messages returned
 */
router.get('/leads/:id/messages', DashboardController.getLeadMessages);

/**
 * PUT /api/leads/:id/state
 *
 * Updates lead status/state. Requires manager or admin role.
 *
 * @param {string} id - Lead UUID
 * @body {string} newState - New status (new, qualified, considering, hesitant, ready_to_book, booked, lost)
 * @body {string} reason - Required if newState is 'lost'
 * @body {number} leadValue - Optional lead value update
 *
 * @returns {object}
 *   - success: boolean
 *   - lead: Updated lead object
 *
 * @example PUT /api/leads/123/state
 * Body: { "newState": "lost", "reason": "price_too_high" }
 */
router.put(
  '/leads/:id/state',
  requireRole('admin', 'manager'),
  writeRateLimiter,
  DashboardController.updateLeadState
);

/**
 * POST /api/leads/:id/reply
 *
 * Sends a manual reply to a lead via WhatsApp/Telegram.
 * Marks lead as human-contacted (blocks automation for 48h).
 * Requires manager or admin role.
 *
 * @param {string} id - Lead UUID
 * @body {string} message - Message text to send
 *
 * @returns {object}
 *   - success: boolean
 *   - message: Confirmation message
 *   - humanContactedAt: Timestamp
 *
 * @example POST /api/leads/123/reply
 * Body: { "message": "היי, רציתי לבדוק אם יש לך שאלות" }
 */
router.post(
  '/leads/:id/reply',
  requireRole('admin', 'manager'),
  writeRateLimiter,
  DashboardController.replyToLead
);

// ============================================================================
// Export
// ============================================================================

export default router;
