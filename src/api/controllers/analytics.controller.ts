/**
 * Analytics Controller - Conversion, funnel, AI performance, revenue
 */

import { Response } from 'express';
import { query, queryOne } from '../../database/connection.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { calculateExpectedRevenue, calculatePipelineVelocity } from '../../services/analytics.service.js';

// Conversion Analysis
export async function getConversionAnalysis(req: AuthenticatedRequest, res: Response) {
  const { groupBy = 'subject', dateFrom, dateTo } = req.query;
  const accountId = req.user?.accountId;

  const groupExpr: Record<string, string> = {
    subject: "COALESCE(subject, 'לא צוין')",
    source: "COALESCE(source, 'ישיר')",
    grade: "COALESCE(education_level, 'לא צוין')",
    week: "TO_CHAR(DATE_TRUNC('week', created_at), 'YYYY-MM-DD')",
    month: "TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM')",
  };

  const expr = groupExpr[groupBy as string] || groupExpr.subject;
  const result = await query(`
    SELECT ${expr} as grp, COUNT(*) as total,
           COUNT(*) FILTER (WHERE status = 'booked') as booked,
           ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'booked') / NULLIF(COUNT(*), 0), 2) as rate
    FROM leads l
    WHERE ($1::TIMESTAMP IS NULL OR created_at >= $1)
      AND ($2::TIMESTAMP IS NULL OR created_at <= $2)
      AND ($3::UUID IS NULL OR EXISTS (SELECT 1 FROM agents a WHERE a.id = l.agent_id AND a.account_id = $3))
    GROUP BY ${expr} ORDER BY total DESC
  `, [dateFrom || null, dateTo || null, accountId || null]);
  const data = result.rows;

  res.json({
    groupBy,
    data: data.map((d: Record<string, unknown>) => ({
      group: d.grp, total: Number(d.total), booked: Number(d.booked), rate: Number(d.rate) || 0,
    })),
  });
}

export async function getConversionTrends(req: AuthenticatedRequest, res: Response) {
  const { dateFrom, dateTo, granularity = 'week' } = req.query;
  const accountId = req.user?.accountId;

  const trunc = granularity === 'day' ? 'day' : granularity === 'month' ? 'month' : 'week';
  const trendResult = await query(`
    SELECT DATE_TRUNC('${trunc}', created_at)::DATE as date, COUNT(*) as leads,
           COUNT(*) FILTER (WHERE status = 'booked') as booked,
           ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'booked') / NULLIF(COUNT(*), 0), 2) as rate
    FROM leads l
    WHERE created_at >= COALESCE($1::TIMESTAMP, NOW() - INTERVAL '90 days') AND created_at <= COALESCE($2::TIMESTAMP, NOW())
      AND ($3::UUID IS NULL OR EXISTS (SELECT 1 FROM agents a WHERE a.id = l.agent_id AND a.account_id = $3))
    GROUP BY 1 ORDER BY 1
  `, [dateFrom || null, dateTo || null, accountId || null]);
  const data = trendResult.rows;

  res.json({ granularity, data: data.map((d: Record<string, unknown>) => ({ date: d.date, leads: Number(d.leads), booked: Number(d.booked), rate: Number(d.rate) || 0 })) });
}

// Funnel Analysis
export async function getFunnelAnalysis(req: AuthenticatedRequest, res: Response) {
  const { dateFrom, dateTo } = req.query;
  const accountId = req.user?.accountId;

  const stagesResult = await query(`
    SELECT status, COUNT(*) as cnt,
           ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600)::NUMERIC, 1) as avg_hours
    FROM leads l
    WHERE ($1::TIMESTAMP IS NULL OR created_at >= $1) AND ($2::TIMESTAMP IS NULL OR created_at <= $2)
      AND ($3::UUID IS NULL OR EXISTS (SELECT 1 FROM agents a WHERE a.id = l.agent_id AND a.account_id = $3))
    GROUP BY status
  `, [dateFrom || null, dateTo || null, accountId || null]);
  const stages = stagesResult.rows;

  const order = ['new', 'qualified', 'considering', 'hesitant', 'ready_to_book', 'booked', 'lost'];
  const sorted = order.map(s => stages.find((st: Record<string, unknown>) => st.status === s) || { status: s, cnt: 0, avg_hours: null });

  res.json({
    stages: sorted.map((s: Record<string, unknown>, i: number) => ({
      stage: s.status, count: Number(s.cnt), avgHours: s.avg_hours,
      conversionFromPrev: i > 0 && Number(sorted[i - 1].cnt) > 0 ? Math.round(Number(s.cnt) / Number(sorted[i - 1].cnt) * 100) : null,
    })),
  });
}

export async function getBottlenecks(req: AuthenticatedRequest, res: Response) {
  const { threshold = '70' } = req.query;
  const accountId = req.user?.accountId;
  // Reuse funnel and filter
  const bottleneckResult = await query(`
    SELECT l.status, COUNT(*) as cnt FROM leads l
    LEFT JOIN agents a ON l.agent_id = a.id
    WHERE l.created_at > NOW() - INTERVAL '30 days'
      AND ($1::UUID IS NULL OR a.account_id = $1)
    GROUP BY l.status
  `, [accountId || null]);
  const stages = bottleneckResult.rows;
  const order = ['new', 'qualified', 'considering', 'hesitant', 'ready_to_book'];
  const sorted = order.map(s => stages.find((st: Record<string, unknown>) => st.status === s) || { status: s, cnt: 0 });

  const bottlenecks = sorted.slice(1).filter((s: Record<string, unknown>, i: number) => {
    const prev = Number(sorted[i].cnt);
    return prev > 0 && (Number(s.cnt) / prev * 100) < Number(threshold);
  });

  res.json({ threshold: Number(threshold), bottlenecks: bottlenecks.map((b: Record<string, unknown>) => ({ stage: b.status })) });
}

// AI Performance
export async function getAIPerformance(req: AuthenticatedRequest, res: Response) {
  const { dateFrom, dateTo } = req.query;
  const accountId = req.user?.accountId;

  const summary = await queryOne(`
    SELECT COUNT(*) as total, AVG(intent_confidence) as conf, AVG(latency_ms) as lat,
           COUNT(*) FILTER (WHERE human_takeover) as takeovers, COUNT(*) FILTER (WHERE is_fallback) as fallbacks
    FROM ai_telemetry t
    WHERE created_at >= COALESCE($1::TIMESTAMP, NOW() - INTERVAL '30 days') AND created_at <= COALESCE($2::TIMESTAMP, NOW())
      AND ($3::UUID IS NULL OR EXISTS (SELECT 1 FROM agents a WHERE a.id = t.agent_id AND a.account_id = $3))
  `, [dateFrom || null, dateTo || null, accountId || null]);

  const intentsResult = await query(`
    SELECT t.detected_intent, COUNT(*) as cnt, ROUND(AVG(t.intent_confidence) * 100, 1) as conf
    FROM ai_telemetry t
    JOIN leads l ON t.lead_id = l.id
    LEFT JOIN agents a ON l.agent_id = a.id
    WHERE t.detected_intent IS NOT NULL AND t.created_at > NOW() - INTERVAL '30 days'
      AND ($1::UUID IS NULL OR a.account_id = $1)
    GROUP BY t.detected_intent ORDER BY cnt DESC LIMIT 10
  `, [accountId || null]);
  const intents = intentsResult.rows;

  res.json({
    summary: summary ? {
      total: Number(summary.total), avgConfidence: Math.round(Number(summary.conf) * 100) || 0,
      avgLatencyMs: Math.round(Number(summary.lat)) || 0,
      takeoverRate: Number(summary.total) > 0 ? Math.round(Number(summary.takeovers) / Number(summary.total) * 100) : 0,
      fallbackRate: Number(summary.total) > 0 ? Math.round(Number(summary.fallbacks) / Number(summary.total) * 100) : 0,
    } : null,
    intents: intents.map((i: Record<string, unknown>) => ({ intent: i.detected_intent, count: Number(i.cnt), confidence: Number(i.conf) })),
  });
}

export async function getConfidenceAnalysis(req: AuthenticatedRequest, res: Response) {
  const accountId = req.user?.accountId;
  const confResult = await query(`
    SELECT FLOOR(t.intent_confidence * 10) / 10 as bucket, COUNT(*) as cnt,
           COUNT(*) FILTER (WHERE l.status = 'booked') as booked
    FROM ai_telemetry t JOIN leads l ON l.id = t.lead_id
    LEFT JOIN agents a ON l.agent_id = a.id
    WHERE t.intent_confidence IS NOT NULL AND t.created_at > NOW() - INTERVAL '30 days'
      AND ($1::UUID IS NULL OR a.account_id = $1)
    GROUP BY 1 ORDER BY 1
  `, [accountId || null]);
  const data = confResult.rows;
  res.json({ distribution: data.map((d: Record<string, unknown>) => ({ bucket: Number(d.bucket), count: Number(d.cnt), booked: Number(d.booked) })) });
}

export async function getAIHumanComparison(req: AuthenticatedRequest, res: Response) {
  const accountId = req.user?.accountId;
  const compResult = await query(`
    SELECT CASE WHEN BOOL_OR(t.human_takeover) THEN 'human' ELSE 'ai' END as type,
           COUNT(DISTINCT l.id) as leads, COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'booked') as booked
    FROM leads l LEFT JOIN ai_telemetry t ON t.lead_id = l.id
    LEFT JOIN agents a ON l.agent_id = a.id
    WHERE l.created_at > NOW() - INTERVAL '30 days'
      AND ($1::UUID IS NULL OR a.account_id = $1)
    GROUP BY CASE WHEN BOOL_OR(t.human_takeover) THEN 'human' ELSE 'ai' END
  `, [accountId || null]);
  const data = compResult.rows;
  const ai = data.find((d: Record<string, unknown>) => d.type === 'ai') || { leads: 0, booked: 0 };
  const human = data.find((d: Record<string, unknown>) => d.type === 'human') || { leads: 0, booked: 0 };
  res.json({ ai: { leads: Number(ai.leads), booked: Number(ai.booked) }, human: { leads: Number(human.leads), booked: Number(human.booked) } });
}

// Revenue Intelligence
export async function getRevenueIntelligence(req: AuthenticatedRequest, res: Response) {
  const accountId = req.user?.accountId;

  const current = await queryOne(`
    SELECT SUM(lead_value) FILTER (WHERE status = 'booked') as closed,
           SUM(lead_value) FILTER (WHERE status NOT IN ('booked', 'lost')) as pipeline
    FROM leads l WHERE ($1::UUID IS NULL OR EXISTS (SELECT 1 FROM agents a WHERE a.id = l.agent_id AND a.account_id = $1))
  `, [accountId || null]);

  const leadsResult = await query(`
    SELECT l.id, l.status, l.lead_state, l.lead_value, l.created_at FROM leads l
    LEFT JOIN agents a ON l.agent_id = a.id
    WHERE l.status NOT IN ('booked', 'lost')
      AND ($1::UUID IS NULL OR a.account_id = $1)
  `, [accountId || null]);
  const activeLeads = leadsResult.rows;
  const expected = calculateExpectedRevenue(activeLeads as any[]);
  const velocity = await calculatePipelineVelocity(accountId || null);

  res.json({
    closed: Number(current?.closed) || 0,
    pipeline: Number(current?.pipeline) || 0,
    expected: Math.round(expected),
    velocity,
  });
}

export async function getRevenueCohorts(req: AuthenticatedRequest, res: Response) {
  const accountId = req.user?.accountId;
  const cohortsResult = await query(`
    SELECT DATE_TRUNC('month', l.created_at)::DATE as cohort, COUNT(*) as leads,
           SUM(l.lead_value) FILTER (WHERE l.status = 'booked') as revenue
    FROM leads l
    LEFT JOIN agents a ON l.agent_id = a.id
    WHERE l.created_at > NOW() - INTERVAL '12 months'
      AND ($1::UUID IS NULL OR a.account_id = $1)
    GROUP BY 1 ORDER BY 1
  `, [accountId || null]);
  const data = cohortsResult.rows;
  res.json({ cohorts: data.map((d: Record<string, unknown>) => ({ cohort: d.cohort, leads: Number(d.leads), revenue: Number(d.revenue) || 0 })) });
}

export async function exportAnalytics(_req: AuthenticatedRequest, res: Response) {
  res.status(501).json({ error: 'Export not implemented' });
}
