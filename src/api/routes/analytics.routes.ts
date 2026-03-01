/**
 * Analytics API Routes
 *
 * Advanced analytics endpoints for dashboard:
 * - Conversion analysis by segment
 * - Funnel deep dive with bottleneck detection
 * - AI performance metrics
 * - Revenue intelligence with forecasting
 *
 * @example
 * import analyticsRoutes from './api/routes/analytics.routes.js';
 * app.use('/api', analyticsRoutes);
 */

import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { dashboardRateLimiter } from '../middleware/rateLimit.middleware.js';
import * as AnalyticsController from '../controllers/analytics.controller.js';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);
router.use(dashboardRateLimiter);

// ============================================================================
// Conversion Analysis
// ============================================================================

/**
 * GET /api/analytics/conversion
 *
 * Returns conversion rates grouped by specified dimension.
 *
 * @query {string} groupBy - Grouping: subject, source, grade, day, week, month, hour
 * @query {string} dateFrom - Start date (ISO format)
 * @query {string} dateTo - End date (ISO format)
 * @query {string} agentId - Filter by agent
 *
 * @returns {object}
 *   - groupBy: The grouping dimension
 *   - data: Array of { group, totalLeads, bookedCount, lostCount, conversionRate, avgValue }
 *   - summary: { totalLeads, totalBooked, overallConversionRate }
 */
router.get('/analytics/conversion', AnalyticsController.getConversionAnalysis);

/**
 * GET /api/analytics/conversion/trends
 *
 * Returns conversion rate trends over time.
 *
 * @query {string} dateFrom - Start date
 * @query {string} dateTo - End date
 * @query {string} granularity - day, week, month (default: week)
 *
 * @returns {object}
 *   - data: Array of { date, conversionRate, leadCount }
 */
router.get('/analytics/conversion/trends', AnalyticsController.getConversionTrends);

// ============================================================================
// Funnel Analysis
// ============================================================================

/**
 * GET /api/analytics/funnel
 *
 * Returns detailed funnel analysis with stage metrics.
 *
 * @query {string} dateFrom - Start date
 * @query {string} dateTo - End date
 * @query {boolean} includeDropoff - Include drop-off reasons (default: true)
 * @query {boolean} includeDurations - Include time in stage (default: true)
 *
 * @returns {object}
 *   - stages: Array of FunnelStage
 *   - bottlenecks: Array of stages with <70% conversion
 *   - summary: { totalLeads, overallConversionRate, avgTimeToClose }
 */
router.get('/analytics/funnel', AnalyticsController.getFunnelAnalysis);

/**
 * GET /api/analytics/funnel/bottlenecks
 *
 * Returns detected bottlenecks in the funnel.
 *
 * @query {number} threshold - Conversion threshold (default: 70)
 *
 * @returns {object}
 *   - bottlenecks: Array of { stage, conversionRate, severity, recommendation }
 */
router.get('/analytics/funnel/bottlenecks', AnalyticsController.getBottlenecks);

// ============================================================================
// AI Performance
// ============================================================================

/**
 * GET /api/analytics/ai-performance
 *
 * Returns AI performance metrics.
 *
 * @query {string} dateFrom - Start date
 * @query {string} dateTo - End date
 *
 * @returns {object}
 *   - summary: { aiHandledPct, humanTakeoverPct, aiSuccessRate, avgConfidence }
 *   - intentMetrics: Array of { intent, count, successRate, avgConfidence }
 *   - fallbackAnalysis: Array of { reason, count, percentage }
 *   - toolUsage: Array of { tool, callCount, successRate }
 */
router.get('/analytics/ai-performance', AnalyticsController.getAIPerformance);

/**
 * GET /api/analytics/ai-performance/confidence
 *
 * Returns confidence distribution analysis.
 *
 * @query {number} buckets - Number of buckets (default: 10)
 *
 * @returns {object}
 *   - distribution: Array of { range, count, conversionRate }
 *   - optimalThreshold: Recommended confidence threshold
 */
router.get('/analytics/ai-performance/confidence', AnalyticsController.getConfidenceAnalysis);

/**
 * GET /api/analytics/ai-performance/comparison
 *
 * Compares AI-only vs human-assisted outcomes.
 *
 * @returns {object}
 *   - aiOnly: { count, closeRate, avgTimeToClose }
 *   - humanAssisted: { count, closeRate, avgTimeToClose }
 *   - comparison: { closeRateDiff, timeDiff }
 */
router.get('/analytics/ai-performance/comparison', AnalyticsController.getAIHumanComparison);

// ============================================================================
// Revenue Intelligence
// ============================================================================

/**
 * GET /api/analytics/revenue
 *
 * Returns revenue metrics and forecasting.
 *
 * @query {string} dateFrom - Start date
 * @query {string} dateTo - End date
 * @query {boolean} includeForecast - Include revenue forecast (default: true)
 *
 * @returns {object}
 *   - current: { closedRevenue, pipelineValue, expectedRevenue }
 *   - forecast: { next7Days, next30Days, next90Days }
 *   - valueDistribution: Array of { range, count, totalValue }
 *   - velocity: { avgDaysToClose, trend }
 */
router.get('/analytics/revenue', AnalyticsController.getRevenueIntelligence);

/**
 * GET /api/analytics/revenue/cohorts
 *
 * Returns cohort analysis for revenue.
 *
 * @query {string} cohortBy - month, week (default: month)
 * @query {string} metric - ltv, retention (default: ltv)
 *
 * @returns {object}
 *   - cohorts: Array of { cohort, leadCount, revenue, ltv }
 */
router.get('/analytics/revenue/cohorts', AnalyticsController.getRevenueCohorts);

// ============================================================================
// Export
// ============================================================================

/**
 * GET /api/analytics/export
 *
 * Exports analytics data.
 * Requires manager or admin role.
 *
 * @query {string} type - conversion, funnel, ai, revenue
 * @query {string} format - csv, json (default: json)
 * @query {string} dateFrom - Start date
 * @query {string} dateTo - End date
 */
router.get(
  '/analytics/export',
  requireRole('admin', 'manager'),
  AnalyticsController.exportAnalytics
);

export default router;
