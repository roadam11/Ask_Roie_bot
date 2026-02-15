/**
 * Admin Controller
 *
 * Handles admin API endpoints for lead management,
 * analytics, and system health monitoring.
 */

import { Request, Response } from 'express';
import * as LeadModel from '../../models/lead.model.js';
import * as MessageModel from '../../models/message.model.js';
import * as FollowUpModel from '../../models/followup.model.js';
import * as AnalyticsModel from '../../models/analytics.model.js';
import * as LeadService from '../../services/lead.service.js';
import { checkDatabaseHealth } from '../../database/connection.js';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';
import { ValidationError, NotFoundError } from '../middleware/error-handler.js';
import type { LeadStatusType } from '../../types/index.js';

// ============================================================================
// Lead Management
// ============================================================================

/**
 * GET /admin/leads
 *
 * List all leads with optional filters and pagination.
 *
 * Query params:
 * - status: Filter by lead status
 * - opted_out: Filter by opted out status (true/false)
 * - needs_human_followup: Filter by human followup flag (true/false)
 * - limit: Number of results (default: 50, max: 100)
 * - offset: Pagination offset (default: 0)
 */
export async function getLeads(req: Request, res: Response): Promise<void> {
  const {
    status,
    opted_out,
    needs_human_followup,
    limit = '50',
    offset = '0',
  } = req.query;

  // Parse and validate pagination
  const parsedLimit = Math.min(Math.max(parseInt(limit as string, 10) || 50, 1), 100);
  const parsedOffset = Math.max(parseInt(offset as string, 10) || 0, 0);

  // Build filters
  const filters: {
    status?: LeadStatusType;
    opted_out?: boolean;
    needs_human_followup?: boolean;
    limit: number;
    offset: number;
  } = {
    limit: parsedLimit,
    offset: parsedOffset,
  };

  if (status && typeof status === 'string') {
    const validStatuses: LeadStatusType[] = [
      'new', 'qualified', 'considering', 'hesitant', 'ready_to_book', 'booked', 'lost'
    ];
    if (validStatuses.includes(status as LeadStatusType)) {
      filters.status = status as LeadStatusType;
    } else {
      throw new ValidationError(`Invalid status: ${status}`, {
        status: `Must be one of: ${validStatuses.join(', ')}`,
      });
    }
  }

  if (opted_out !== undefined) {
    filters.opted_out = opted_out === 'true';
  }

  if (needs_human_followup !== undefined) {
    filters.needs_human_followup = needs_human_followup === 'true';
  }

  logger.debug('Fetching leads', { filters });

  const leads = await LeadModel.list(filters);

  // Get total count for pagination
  const allLeads = await LeadModel.list({
    ...filters,
    limit: 10000,
    offset: 0,
  });
  const totalCount = allLeads.length;

  // Add computed fields
  const leadsWithProgress = leads.map((lead) => ({
    ...lead,
    progress: LeadService.getLeadProgress(lead),
    isEngaged: LeadService.isEngaged(lead),
    nextAction: LeadService.getNextAction(lead),
  }));

  res.json({
    success: true,
    data: {
      leads: leadsWithProgress,
      pagination: {
        total: totalCount,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: parsedOffset + leads.length < totalCount,
      },
    },
  });
}

/**
 * GET /admin/leads/:id
 *
 * Get a single lead by ID with full details.
 * Includes conversation history and follow-ups.
 */
export async function getLeadById(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  if (!id || !isValidUUID(id)) {
    throw new ValidationError('Invalid lead ID', { id: 'Must be a valid UUID' });
  }

  logger.debug('Fetching lead details', { leadId: id });

  const lead = await LeadModel.findById(id);

  if (!lead) {
    throw new NotFoundError('Lead');
  }

  // Fetch related data in parallel
  const [messages, followUps, analytics] = await Promise.all([
    MessageModel.getConversationHistory(id, 100),
    FollowUpModel.findByLead(id),
    AnalyticsModel.findByLead(id, 50),
  ]);

  // Compute additional fields
  const leadDetails = {
    ...lead,
    progress: LeadService.getLeadProgress(lead),
    isEngaged: LeadService.isEngaged(lead),
    isActive: LeadService.isActiveLead(lead),
    canQualify: LeadService.canQualifyLead(lead),
    isReadyForBooking: LeadService.isReadyForBooking(lead),
    nextAction: LeadService.getNextAction(lead),
    shouldFollowUp: LeadService.shouldSendFollowUp(lead),
  };

  // Format conversation history
  const conversation = messages.map((msg) => ({
    id: msg.id,
    role: msg.role,
    content: msg.content,
    createdAt: msg.created_at,
    tokensUsed: msg.tokens_used,
    modelUsed: msg.model_used,
  }));

  // Format follow-ups
  const followUpHistory = followUps.map((fu) => ({
    id: fu.id,
    type: fu.type,
    status: fu.status,
    scheduledFor: fu.scheduled_for,
    sentAt: fu.sent_at,
    createdAt: fu.created_at,
  }));

  // Format analytics events
  const events = analytics.map((event) => ({
    id: event.id,
    eventType: event.event_type,
    metadata: event.metadata,
    costUsd: event.cost_usd,
    createdAt: event.created_at,
  }));

  res.json({
    success: true,
    data: {
      lead: leadDetails,
      conversation,
      followUps: followUpHistory,
      analytics: events,
      stats: {
        totalMessages: messages.length,
        userMessages: messages.filter((m) => m.role === 'user').length,
        botMessages: messages.filter((m) => m.role === 'bot').length,
        totalFollowUps: followUps.length,
        pendingFollowUps: followUps.filter((fu) => fu.status === 'pending').length,
        totalEvents: analytics.length,
      },
    },
  });
}

// ============================================================================
// Analytics
// ============================================================================

/**
 * GET /admin/analytics
 *
 * Get dashboard analytics and statistics.
 *
 * Query params:
 * - startDate: Start date for analytics (ISO string)
 * - endDate: End date for analytics (ISO string)
 */
export async function getAnalytics(req: Request, res: Response): Promise<void> {
  const { startDate, endDate } = req.query;

  // Parse dates (default to last 30 days)
  const end = endDate ? new Date(endDate as string) : new Date();
  const start = startDate
    ? new Date(startDate as string)
    : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Validate dates
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new ValidationError('Invalid date format', {
      startDate: 'Must be a valid ISO date string',
      endDate: 'Must be a valid ISO date string',
    });
  }

  if (start > end) {
    throw new ValidationError('Invalid date range', {
      startDate: 'Start date must be before end date',
    });
  }

  logger.debug('Fetching analytics', { startDate: start, endDate: end });

  // Fetch all analytics data in parallel
  const [
    dashboardStats,
    eventCounts,
    costByType,
    dailyEvents,
    dailyCosts,
    leadsByStatus,
    recentLeads,
  ] = await Promise.all([
    AnalyticsModel.getDashboardStats(start, end),
    AnalyticsModel.countByEventType(start, end),
    AnalyticsModel.getCostByEventType(start, end),
    AnalyticsModel.getDailyEventCounts(start, end),
    AnalyticsModel.getDailyCosts(start, end),
    getLeadCountsByStatus(),
    LeadModel.list({ limit: 10, offset: 0 }),
  ]);

  // Calculate conversion rates
  const totalLeads = leadsByStatus.total || 1;
  const conversionRates = {
    qualifiedRate: ((leadsByStatus.qualified || 0) / totalLeads * 100).toFixed(1),
    bookedRate: ((leadsByStatus.booked || 0) / totalLeads * 100).toFixed(1),
    lostRate: ((leadsByStatus.lost || 0) / totalLeads * 100).toFixed(1),
  };

  res.json({
    success: true,
    data: {
      period: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        days: Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
      },
      summary: {
        ...dashboardStats,
        totalLeads: leadsByStatus.total,
        activeLeads: leadsByStatus.active,
        conversionRates,
      },
      leadsByStatus,
      eventCounts,
      costBreakdown: {
        total: dashboardStats.totalCost,
        byType: costByType,
      },
      trends: {
        dailyEvents,
        dailyCosts,
      },
      recentActivity: {
        leads: recentLeads.slice(0, 5).map((lead) => ({
          id: lead.id,
          name: lead.name,
          status: lead.status,
          createdAt: lead.created_at,
        })),
      },
    },
  });
}

// ============================================================================
// System Health
// ============================================================================

/**
 * GET /admin/health
 *
 * Get detailed system health information.
 */
export async function getHealth(_req: Request, res: Response): Promise<void> {
  logger.debug('Checking system health');

  // Check database health
  const dbHealth = await checkDatabaseHealth();

  // Check API configurations
  const apiConfig = {
    whatsapp: {
      configured: !!(
        config.whatsapp.phoneNumberId &&
        config.whatsapp.accessToken &&
        config.whatsapp.webhookVerifyToken
      ),
      phoneNumberId: config.whatsapp.phoneNumberId ? '***configured***' : 'missing',
    },
    anthropic: {
      configured: !!config.anthropic.apiKey,
      model: config.anthropic.model,
      maxTokens: config.anthropic.maxTokens,
    },
    calendly: {
      configured: !!(
        config.calendly.accessToken &&
        config.calendly.organizationUri &&
        config.calendly.eventTypeUri
      ),
    },
  };

  // Get system metrics
  const systemMetrics = {
    uptime: process.uptime(),
    uptimeFormatted: formatUptime(process.uptime()),
    memoryUsage: process.memoryUsage(),
    nodeVersion: process.version,
    environment: config.server.nodeEnv,
  };

  // Determine overall health status
  const isHealthy = dbHealth.postgres.connected && dbHealth.redis.connected;
  const status = isHealthy ? 'healthy' : 'degraded';

  res.json({
    success: true,
    data: {
      status,
      timestamp: new Date().toISOString(),
      database: {
        postgres: {
          status: dbHealth.postgres.connected ? 'connected' : 'disconnected',
          latency: dbHealth.postgres.latency,
          error: dbHealth.postgres.error,
        },
        redis: {
          status: dbHealth.redis.connected ? 'connected' : 'disconnected',
          latency: dbHealth.redis.latency,
          error: dbHealth.redis.error,
        },
      },
      apis: apiConfig,
      system: systemMetrics,
    },
  });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate UUID format
 */
function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Format uptime in human readable format
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}

/**
 * Get lead counts by status
 */
async function getLeadCountsByStatus(): Promise<{
  total: number;
  active: number;
  new: number;
  qualified: number;
  considering: number;
  hesitant: number;
  ready_to_book: number;
  booked: number;
  lost: number;
  opted_out: number;
}> {
  const statuses: LeadStatusType[] = [
    'new', 'qualified', 'considering', 'hesitant', 'ready_to_book', 'booked', 'lost'
  ];

  const counts: Record<string, number> = {};
  let total = 0;
  let active = 0;

  for (const status of statuses) {
    const leads = await LeadModel.list({ status, limit: 10000, offset: 0 });
    counts[status] = leads.length;
    total += leads.length;

    // Active = not booked, not lost
    if (status !== 'booked' && status !== 'lost') {
      active += leads.length;
    }
  }

  // Count opted out leads
  const optedOutLeads = await LeadModel.list({ opted_out: true, limit: 10000, offset: 0 });
  counts.opted_out = optedOutLeads.length;

  return {
    total,
    active,
    new: counts.new || 0,
    qualified: counts.qualified || 0,
    considering: counts.considering || 0,
    hesitant: counts.hesitant || 0,
    ready_to_book: counts.ready_to_book || 0,
    booked: counts.booked || 0,
    lost: counts.lost || 0,
    opted_out: counts.opted_out || 0,
  };
}

// ============================================================================
// Exports
// ============================================================================

export default {
  getLeads,
  getLeadById,
  getAnalytics,
  getHealth,
};
