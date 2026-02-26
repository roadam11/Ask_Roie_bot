/**
 * Dashboard Controller
 *
 * Handles all dashboard API endpoints for metrics, analytics, and lead management.
 */

import { Response } from 'express';
import { query, queryOne } from '../../database/connection.js';
import * as WhatsAppService from '../../services/whatsapp.service.js';
import * as TelegramService from '../../services/telegram.service.js';
import * as MessageService from '../../services/message.service.js';
import logger from '../../utils/logger.js';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import type { Lead } from '../../types/index.js';

// ============================================================================
// Types
// ============================================================================

interface DashboardMetrics {
  pipelineValue: number;
  closedWonRevenue: number;
  avgTimeToBook: number | null;
  leadCounts: {
    total: number;
    new: number;
    qualified: number;
    considering: number;
    booked: number;
    lost: number;
  };
  followUpStats: {
    pending: number;
    sentToday: number;
    responseRate: number;
  };
}

interface FunnelStage {
  stage: string;
  count: number;
  conversionRate: number | null;
  avgTimeInStage: number | null;
}

interface GroupedAnalytics {
  group: string;
  leadCount: number;
  bookedCount: number;
  conversionRate: number;
  avgValue: number | null;
}

interface PaginatedLeads {
  data: Lead[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================================
// GET /api/dashboard/metrics
// ============================================================================

export async function getMetrics(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const accountId = req.user?.accountId;

    // Pipeline value (sum of lead_value for active leads)
    const pipelineResult = await queryOne<{ value: string }>(
      `SELECT COALESCE(SUM(lead_value), 0) as value
       FROM leads l
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE l.status NOT IN ('booked', 'lost')
         AND ($1::uuid IS NULL OR a.account_id = $1)`,
      [accountId || null]
    );

    // Closed won revenue (booked leads)
    const revenueResult = await queryOne<{ value: string }>(
      `SELECT COALESCE(SUM(lead_value), 0) as value
       FROM leads l
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE l.status = 'booked'
         AND ($1::uuid IS NULL OR a.account_id = $1)`,
      [accountId || null]
    );

    // Average time to book (in hours)
    const avgTimeResult = await queryOne<{ avg_hours: string }>(
      `SELECT AVG(EXTRACT(EPOCH FROM (booked_at - created_at)) / 3600) as avg_hours
       FROM leads l
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE l.status = 'booked' AND l.booked_at IS NOT NULL
         AND ($1::uuid IS NULL OR a.account_id = $1)`,
      [accountId || null]
    );

    // Lead counts by status
    const countsResult = await query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) as count
       FROM leads l
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE ($1::uuid IS NULL OR a.account_id = $1)
       GROUP BY status`,
      [accountId || null]
    );

    const leadCounts = {
      total: 0,
      new: 0,
      qualified: 0,
      considering: 0,
      booked: 0,
      lost: 0,
    };

    for (const row of countsResult.rows) {
      const count = parseInt(row.count, 10);
      leadCounts.total += count;
      if (row.status in leadCounts) {
        leadCounts[row.status as keyof typeof leadCounts] = count;
      }
    }

    // Follow-up stats
    const followUpResult = await queryOne<{
      pending: string;
      sent_today: string;
      total_sent: string;
      total_responded: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE f.status = 'pending') as pending,
         COUNT(*) FILTER (WHERE f.status = 'sent' AND f.sent_at::date = CURRENT_DATE) as sent_today,
         COUNT(*) FILTER (WHERE f.status = 'sent') as total_sent,
         COUNT(*) FILTER (WHERE f.status = 'sent' AND EXISTS (
           SELECT 1 FROM messages m
           WHERE m.lead_id = f.lead_id
             AND m.role = 'user'
             AND m.created_at > f.sent_at
         )) as total_responded
       FROM followups f
       JOIN leads l ON f.lead_id = l.id
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE ($1::uuid IS NULL OR a.account_id = $1)`,
      [accountId || null]
    );

    const totalSent = parseInt(followUpResult?.total_sent || '0', 10);
    const totalResponded = parseInt(followUpResult?.total_responded || '0', 10);

    const metrics: DashboardMetrics = {
      pipelineValue: parseFloat(pipelineResult?.value || '0'),
      closedWonRevenue: parseFloat(revenueResult?.value || '0'),
      avgTimeToBook: avgTimeResult?.avg_hours ? parseFloat(avgTimeResult.avg_hours) : null,
      leadCounts,
      followUpStats: {
        pending: parseInt(followUpResult?.pending || '0', 10),
        sentToday: parseInt(followUpResult?.sent_today || '0', 10),
        responseRate: totalSent > 0 ? (totalResponded / totalSent) * 100 : 0,
      },
    };

    res.json(metrics);
  } catch (error) {
    logger.error('Error fetching dashboard metrics', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
}

// ============================================================================
// GET /api/dashboard/funnel
// ============================================================================

export async function getFunnel(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const accountId = req.user?.accountId;

    // Define funnel stages in order
    const stages = ['new', 'qualified', 'considering', 'hesitant', 'ready_to_book', 'booked', 'lost'];

    // Get counts and avg time per stage
    const result = await query<{
      status: string;
      count: string;
      avg_hours: string;
    }>(
      `SELECT
         status,
         COUNT(*) as count,
         AVG(EXTRACT(EPOCH FROM (
           CASE
             WHEN status = 'booked' THEN booked_at
             ELSE updated_at
           END - created_at
         )) / 3600) as avg_hours
       FROM leads l
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE ($1::uuid IS NULL OR a.account_id = $1)
       GROUP BY status`,
      [accountId || null]
    );

    // Build funnel data
    const countMap = new Map<string, { count: number; avgHours: number }>();
    for (const row of result.rows) {
      countMap.set(row.status, {
        count: parseInt(row.count, 10),
        avgHours: row.avg_hours ? parseFloat(row.avg_hours) : 0,
      });
    }

    const funnel: FunnelStage[] = [];
    let previousCount: number | null = null;

    for (const stage of stages) {
      const data = countMap.get(stage) || { count: 0, avgHours: 0 };
      const conversionRate = previousCount !== null && previousCount > 0
        ? (data.count / previousCount) * 100
        : null;

      funnel.push({
        stage: stage.toUpperCase(),
        count: data.count,
        conversionRate: conversionRate !== null ? Math.round(conversionRate * 10) / 10 : null,
        avgTimeInStage: data.avgHours > 0 ? Math.round(data.avgHours * 10) / 10 : null,
      });

      // Lost doesn't feed into next stage
      if (stage !== 'lost') {
        previousCount = data.count;
      }
    }

    res.json({
      funnel,
      summary: {
        totalLeads: funnel.reduce((sum, s) => sum + s.count, 0),
        overallConversionRate: funnel[0].count > 0
          ? Math.round((countMap.get('booked')?.count || 0) / funnel[0].count * 1000) / 10
          : 0,
      },
    });
  } catch (error) {
    logger.error('Error fetching funnel data', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch funnel data' });
  }
}

// ============================================================================
// GET /api/dashboard/analytics
// ============================================================================

export async function getAnalytics(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const accountId = req.user?.accountId;
    const groupBy = (req.query.groupBy as string) || 'subject';

    let groupColumn: string;
    let groupLabel: string;

    switch (groupBy) {
      case 'subject':
        groupColumn = 'UNNEST(COALESCE(subjects, ARRAY[]::text[]))';
        groupLabel = 'subject';
        break;
      case 'level':
        groupColumn = 'COALESCE(level, \'unknown\')';
        groupLabel = 'level';
        break;
      case 'format':
        groupColumn = 'COALESCE(format_preference, \'unknown\')';
        groupLabel = 'format';
        break;
      case 'urgency':
        groupColumn = 'COALESCE(urgency, \'unknown\')';
        groupLabel = 'urgency';
        break;
      default:
        res.status(400).json({ error: `Invalid groupBy: ${groupBy}. Use: subject, level, format, urgency` });
        return;
    }

    const result = await query<{
      group_value: string;
      lead_count: string;
      booked_count: string;
      avg_value: string;
    }>(
      `SELECT
         ${groupColumn} as group_value,
         COUNT(DISTINCT l.id) as lead_count,
         COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'booked') as booked_count,
         AVG(l.lead_value) as avg_value
       FROM leads l
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE ($1::uuid IS NULL OR a.account_id = $1)
       GROUP BY ${groupColumn}
       HAVING COUNT(DISTINCT l.id) > 0
       ORDER BY lead_count DESC
       LIMIT 20`,
      [accountId || null]
    );

    const analytics: GroupedAnalytics[] = result.rows.map((row) => {
      const leadCount = parseInt(row.lead_count, 10);
      const bookedCount = parseInt(row.booked_count, 10);

      return {
        group: row.group_value,
        leadCount,
        bookedCount,
        conversionRate: leadCount > 0 ? Math.round((bookedCount / leadCount) * 1000) / 10 : 0,
        avgValue: row.avg_value ? parseFloat(row.avg_value) : null,
      };
    });

    res.json({
      groupBy: groupLabel,
      data: analytics,
    });
  } catch (error) {
    logger.error('Error fetching analytics', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
}

// ============================================================================
// GET /api/leads
// ============================================================================

export async function getLeads(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const accountId = req.user?.accountId;

    // Parse query params
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const offset = (page - 1) * limit;

    const status = req.query.status as string;
    const subject = req.query.subject as string;
    const level = req.query.level as string;
    const search = req.query.search as string;
    const hasFollowUp = req.query.hasFollowUp as string;

    // Build WHERE conditions
    const conditions: string[] = ['($1::uuid IS NULL OR a.account_id = $1)'];
    const params: (string | null)[] = [accountId || null];
    let paramIndex = 2;

    if (status) {
      conditions.push(`l.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (subject) {
      conditions.push(`$${paramIndex} = ANY(l.subjects)`);
      params.push(subject);
      paramIndex++;
    }

    if (level) {
      conditions.push(`l.level = $${paramIndex}`);
      params.push(level);
      paramIndex++;
    }

    if (search) {
      conditions.push(`(l.name ILIKE $${paramIndex} OR l.phone ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (hasFollowUp === 'true') {
      conditions.push('l.follow_up_scheduled_at IS NOT NULL');
    } else if (hasFollowUp === 'false') {
      conditions.push('l.follow_up_scheduled_at IS NULL');
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countResult = await queryOne<{ total: string }>(
      `SELECT COUNT(*) as total
       FROM leads l
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE ${whereClause}`,
      params
    );

    const total = parseInt(countResult?.total || '0', 10);

    // Get paginated leads
    const leadsResult = await query<Lead & { agent_name: string }>(
      `SELECT
         l.*,
         ag.name as agent_name
       FROM leads l
       LEFT JOIN agents ag ON l.agent_id = ag.id
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE ${whereClause}
       ORDER BY l.updated_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit.toString(), offset.toString()]
    );

    const response: PaginatedLeads = {
      data: leadsResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Error fetching leads', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
}

// ============================================================================
// GET /api/leads/:id
// ============================================================================

export async function getLeadById(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const accountId = req.user?.accountId;

    const lead = await queryOne<Lead & { agent_name: string; messages_count: string }>(
      `SELECT
         l.*,
         ag.name as agent_name,
         (SELECT COUNT(*) FROM messages WHERE lead_id = l.id) as messages_count
       FROM leads l
       LEFT JOIN agents ag ON l.agent_id = ag.id
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE l.id = $1
         AND ($2::uuid IS NULL OR a.account_id = $2)`,
      [id, accountId || null]
    );

    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // Get recent messages
    const messagesResult = await query<{ role: string; content: string; created_at: Date }>(
      `SELECT role, content, created_at
       FROM messages
       WHERE lead_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [id]
    );

    // Get follow-up history
    const followupsResult = await query<{ type: string; status: string; scheduled_for: Date; sent_at: Date }>(
      `SELECT type, status, scheduled_for, sent_at
       FROM followups
       WHERE lead_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [id]
    );

    res.json({
      lead,
      messages: messagesResult.rows.reverse(),
      followups: followupsResult.rows,
    });
  } catch (error) {
    logger.error('Error fetching lead', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch lead' });
  }
}

// ============================================================================
// PUT /api/leads/:id/state
// ============================================================================

export async function updateLeadState(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { newState, reason, leadValue } = req.body;
    const accountId = req.user?.accountId;

    // Validate newState
    const validStates = ['new', 'qualified', 'considering', 'hesitant', 'ready_to_book', 'booked', 'lost'];
    if (!newState || !validStates.includes(newState)) {
      res.status(400).json({
        error: 'Invalid state',
        validStates,
      });
      return;
    }

    // Require reason if setting to lost
    if (newState === 'lost' && !reason) {
      res.status(400).json({
        error: 'lost_reason is required when setting status to lost',
        validReasons: [
          'price_too_high',
          'found_alternative',
          'not_interested',
          'no_response',
          'wrong_timing',
          'location_issue',
          'format_mismatch',
          'other',
        ],
      });
      return;
    }

    // Build update query
    const updates: string[] = ['status = $1', 'updated_at = NOW()'];
    const params: (string | number | null)[] = [newState];
    let paramIndex = 2;

    if (newState === 'lost' && reason) {
      updates.push(`lost_reason = $${paramIndex}`);
      params.push(reason);
      paramIndex++;
    }

    if (leadValue !== undefined) {
      updates.push(`lead_value = $${paramIndex}`);
      params.push(leadValue);
      paramIndex++;
    }

    // Map status to lead_state for follow-up automation
    if (newState === 'considering' || newState === 'hesitant') {
      updates.push(`lead_state = 'thinking'`);
    } else if (newState === 'booked') {
      updates.push(`lead_state = 'converted'`);
    } else if (newState === 'lost') {
      updates.push(`lead_state = 'closed'`);
    }

    params.push(id);
    params.push(accountId || null);

    const result = await queryOne<Lead>(
      `UPDATE leads l
       SET ${updates.join(', ')}
       FROM agents a
       WHERE l.id = $${paramIndex}
         AND l.agent_id = a.id
         AND ($${paramIndex + 1}::uuid IS NULL OR a.account_id = $${paramIndex + 1})
       RETURNING l.*`,
      params
    );

    if (!result) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    logger.info('Lead state updated via dashboard', {
      leadId: id,
      newState,
      reason,
      updatedBy: req.user?.email,
    });

    res.json({
      success: true,
      lead: result,
    });
  } catch (error) {
    logger.error('Error updating lead state', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update lead state' });
  }
}

// ============================================================================
// POST /api/leads/:id/reply
// ============================================================================

export async function replyToLead(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const accountId = req.user?.accountId;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // Get lead with agent info
    const lead = await queryOne<Lead & { platform: string }>(
      `SELECT l.*, ag.platform
       FROM leads l
       LEFT JOIN agents ag ON l.agent_id = ag.id
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE l.id = $1
         AND ($2::uuid IS NULL OR a.account_id = $2)`,
      [id, accountId || null]
    );

    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    if (lead.opted_out) {
      res.status(400).json({ error: 'Cannot message opted-out lead' });
      return;
    }

    // Send message via appropriate platform
    let sendResult: { success: boolean; messageId?: string; error?: string };

    try {
      if (lead.platform === 'telegram') {
        // For Telegram, we'd need chat_id stored on the lead
        // This is a simplified version
        await TelegramService.sendMessage(lead.phone, message.trim());
        sendResult = { success: true };
      } else {
        // Default to WhatsApp
        await WhatsAppService.sendTextMessage(lead.phone, message.trim());
        sendResult = { success: true };
      }
    } catch (sendError) {
      sendResult = { success: false, error: (sendError as Error).message };
    }

    if (!sendResult.success) {
      res.status(500).json({
        error: 'Failed to send message',
        details: sendResult.error,
      });
      return;
    }

    // Save message to database
    await MessageService.createBotMessage(lead.id, message.trim(), 0, 'manual');

    // Mark as human contacted (blocks automation for 48h)
    await query(
      `UPDATE leads SET human_contacted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );

    logger.info('Manual reply sent via dashboard', {
      leadId: id,
      platform: lead.platform || 'whatsapp',
      sentBy: req.user?.email,
      messageLength: message.length,
    });

    res.json({
      success: true,
      message: 'Message sent',
      humanContactedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error sending reply', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to send reply' });
  }
}

// ============================================================================
// GET /api/leads/:id/messages
// ============================================================================

export async function getLeadMessages(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const accountId = req.user?.accountId;
    const limit = Math.min(100, parseInt(req.query.limit as string, 10) || 50);

    // Verify lead access
    const lead = await queryOne<{ id: string }>(
      `SELECT l.id
       FROM leads l
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE l.id = $1
         AND ($2::uuid IS NULL OR a.account_id = $2)`,
      [id, accountId || null]
    );

    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const messages = await query<{ id: string; role: string; content: string; created_at: Date }>(
      `SELECT id, role, content, created_at
       FROM messages
       WHERE lead_id = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [id, limit.toString()]
    );

    res.json({
      leadId: id,
      messages: messages.rows,
      count: messages.rows.length,
    });
  } catch (error) {
    logger.error('Error fetching messages', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
}
