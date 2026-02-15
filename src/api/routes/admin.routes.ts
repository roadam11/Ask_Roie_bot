/**
 * Admin API Routes
 *
 * Protected routes for admin dashboard and management.
 * All routes require authentication via adminAuth middleware.
 *
 * @routes
 * GET /admin/leads      - List all leads with filters
 * GET /admin/leads/:id  - Get single lead with details
 * GET /admin/analytics  - Dashboard analytics
 * GET /admin/health     - System health check
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import {
  getLeads,
  getLeadById,
  getAnalytics,
  getHealth,
} from '../controllers/admin.controller.js';

// ============================================================================
// Router Setup
// ============================================================================

const router = Router();

// ============================================================================
// Lead Management Routes
// ============================================================================

/**
 * GET /admin/leads
 *
 * List all leads with optional filters and pagination.
 *
 * Query Parameters:
 * - status: Filter by status (new, qualified, considering, hesitant, ready_to_book, booked, lost)
 * - opted_out: Filter by opted out status (true/false)
 * - needs_human_followup: Filter by human followup flag (true/false)
 * - limit: Number of results (default: 50, max: 100)
 * - offset: Pagination offset (default: 0)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     leads: [...],
 *     pagination: { total, limit, offset, hasMore }
 *   }
 * }
 */
router.get('/leads', asyncHandler(getLeads));

/**
 * GET /admin/leads/:id
 *
 * Get a single lead by ID with full details.
 * Includes conversation history, follow-ups, and analytics.
 *
 * Parameters:
 * - id: Lead UUID
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     lead: { ...leadData, progress, nextAction, ... },
 *     conversation: [...],
 *     followUps: [...],
 *     analytics: [...],
 *     stats: { totalMessages, userMessages, botMessages, ... }
 *   }
 * }
 */
router.get('/leads/:id', asyncHandler(getLeadById));

// ============================================================================
// Analytics Routes
// ============================================================================

/**
 * GET /admin/analytics
 *
 * Get dashboard analytics and statistics.
 *
 * Query Parameters:
 * - startDate: Start date for analytics (ISO string, default: 30 days ago)
 * - endDate: End date for analytics (ISO string, default: now)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     period: { startDate, endDate, days },
 *     summary: { totalEvents, totalCost, conversationsStarted, ... },
 *     leadsByStatus: { total, new, qualified, booked, lost, ... },
 *     eventCounts: { conversation_started: N, message_sent: N, ... },
 *     costBreakdown: { total, byType: { claude_api_call: N, ... } },
 *     trends: { dailyEvents: [...], dailyCosts: [...] }
 *   }
 * }
 */
router.get('/analytics', asyncHandler(getAnalytics));

// ============================================================================
// System Health Routes
// ============================================================================

/**
 * GET /admin/health
 *
 * Get detailed system health information.
 * Unlike /health endpoints, this includes sensitive configuration details.
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     status: "healthy" | "degraded",
 *     timestamp: "...",
 *     database: { postgres: {...}, redis: {...} },
 *     apis: { whatsapp: {...}, anthropic: {...}, calendly: {...} },
 *     system: { uptime, memoryUsage, nodeVersion, environment }
 *   }
 * }
 */
router.get('/health', asyncHandler(getHealth));

// ============================================================================
// Exports
// ============================================================================

export default router;
