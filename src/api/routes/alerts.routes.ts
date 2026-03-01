/**
 * Alerts API Routes
 *
 * System alerts for the command center dashboard:
 * - Get active alerts
 * - Dismiss/acknowledge alerts
 * - Snooze alerts
 *
 * @example
 * import alertsRoutes from './api/routes/alerts.routes.js';
 * app.use('/api', alertsRoutes);
 */

import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { dashboardRateLimiter, writeRateLimiter } from '../middleware/rateLimit.middleware.js';
import * as AlertsController from '../controllers/alerts.controller.js';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);
router.use(dashboardRateLimiter);

// ============================================================================
// Alert Retrieval
// ============================================================================

/**
 * GET /api/alerts
 *
 * Returns active alerts for the command center.
 *
 * @query {string} status - Filter by status (active, acknowledged, resolved)
 * @query {string} severity - Filter by severity (info, warning, error, critical)
 * @query {string} type - Filter by alert type
 * @query {boolean} actionRequired - Filter alerts requiring action
 * @query {number} limit - Max alerts (default: 20)
 *
 * @returns {object}
 *   - alerts: Array of alert objects
 *   - summary: { critical, error, warning, info, actionRequired }
 */
router.get('/alerts', AlertsController.getAlerts);

/**
 * GET /api/alerts/summary
 *
 * Returns alert summary for dashboard header.
 *
 * @returns {object}
 *   - total: Total active alerts
 *   - critical: Count of critical alerts
 *   - actionRequired: Count requiring action
 */
router.get('/alerts/summary', AlertsController.getAlertsSummary);

/**
 * GET /api/alerts/:id
 *
 * Returns single alert details.
 *
 * @param {string} id - Alert UUID
 *
 * @returns {object}
 *   - alert: Full alert object with reference data
 */
router.get('/alerts/:id', AlertsController.getAlertById);

// ============================================================================
// Alert Actions
// ============================================================================

/**
 * PUT /api/alerts/:id/acknowledge
 *
 * Acknowledge an alert (mark as seen).
 *
 * @param {string} id - Alert UUID
 *
 * @returns {object}
 *   - success: boolean
 *   - alert: Updated alert
 */
router.put(
  '/alerts/:id/acknowledge',
  writeRateLimiter,
  AlertsController.acknowledgeAlert
);

/**
 * PUT /api/alerts/:id/resolve
 *
 * Resolve an alert.
 *
 * @param {string} id - Alert UUID
 * @body {string} notes - Optional resolution notes
 *
 * @returns {object}
 *   - success: boolean
 *   - alert: Updated alert
 */
router.put(
  '/alerts/:id/resolve',
  writeRateLimiter,
  AlertsController.resolveAlert
);

/**
 * PUT /api/alerts/:id/snooze
 *
 * Snooze an alert for specified duration.
 *
 * @param {string} id - Alert UUID
 * @body {number} hours - Hours to snooze (default: 4)
 *
 * @returns {object}
 *   - success: boolean
 *   - alert: Updated alert with new expires_at
 */
router.put(
  '/alerts/:id/snooze',
  writeRateLimiter,
  AlertsController.snoozeAlert
);

/**
 * POST /api/alerts/dismiss-all
 *
 * Dismiss all alerts of a specific type.
 * Requires admin role.
 *
 * @body {string} type - Alert type to dismiss
 * @body {string} severity - Optional severity filter
 *
 * @returns {object}
 *   - success: boolean
 *   - count: Number of alerts dismissed
 */
router.post(
  '/alerts/dismiss-all',
  requireRole('admin'),
  writeRateLimiter,
  AlertsController.dismissAllAlerts
);

// ============================================================================
// Alert Generation (Admin)
// ============================================================================

/**
 * POST /api/alerts/generate
 *
 * Manually trigger alert generation.
 * Requires admin role.
 *
 * @returns {object}
 *   - success: boolean
 *   - generated: Number of new alerts
 */
router.post(
  '/alerts/generate',
  requireRole('admin'),
  writeRateLimiter,
  AlertsController.triggerAlertGeneration
);

export default router;
