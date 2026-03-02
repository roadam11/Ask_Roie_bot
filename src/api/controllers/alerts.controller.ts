/**
 * Alerts Controller - System alerts for command center
 */

import { Response } from 'express';
import { query, queryOne } from '../../database/connection.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { generateAlerts as runAlertGeneration } from '../../services/alerts.service.js';

export async function getAlerts(req: AuthenticatedRequest, res: Response) {
  const { status = 'active', severity, type, limit = '20' } = req.query;
  const accountId = req.user?.accountId;

  const conditions: string[] = ['(expires_at IS NULL OR expires_at > NOW())'];
  const params: unknown[] = [];
  let idx = 1;

  if (accountId) { conditions.push(`account_id = $${idx++}`); params.push(accountId); }
  if (status !== 'all') { conditions.push(`status = $${idx++}`); params.push(status); }
  if (severity) { conditions.push(`severity = $${idx++}`); params.push(severity); }
  if (type) { conditions.push(`alert_type = $${idx++}`); params.push(type); }

  params.push(Math.min(100, Number(limit)));

  const alertsResult = await query(`
    SELECT * FROM alerts WHERE ${conditions.join(' AND ')}
    ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'error' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END,
             action_required DESC, created_at DESC
    LIMIT $${idx}
  `, params);
  const alerts = alertsResult.rows;

  const summary = await queryOne(`
    SELECT COUNT(*) FILTER (WHERE severity = 'critical' AND status = 'active') as critical,
           COUNT(*) FILTER (WHERE severity = 'error' AND status = 'active') as error,
           COUNT(*) FILTER (WHERE action_required AND status = 'active') as action_required
    FROM alerts WHERE ($1::UUID IS NULL OR account_id = $1) AND (expires_at IS NULL OR expires_at > NOW())
  `, [accountId]);

  return res.json({
    alerts: alerts.map((a: Record<string, unknown>) => ({
      id: a.id, type: a.alert_type, severity: a.severity, title: a.title, description: a.description,
      actionRequired: a.action_required, status: a.status, createdAt: a.created_at,
    })),
    summary: { critical: Number(summary?.critical) || 0, error: Number(summary?.error) || 0, actionRequired: Number(summary?.action_required) || 0 },
  });
}

export async function getAlertsSummary(req: AuthenticatedRequest, res: Response) {
  const accountId = req.user?.accountId;
  const summary = await queryOne(`
    SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE severity = 'critical') as critical,
           COUNT(*) FILTER (WHERE action_required) as action_required
    FROM alerts WHERE status = 'active' AND ($1::UUID IS NULL OR account_id = $1)
  `, [accountId]);

  return res.json({ total: Number(summary?.total) || 0, critical: Number(summary?.critical) || 0, actionRequired: Number(summary?.action_required) || 0 });
}

export async function getAlertById(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const accountId = req.user?.accountId;
  const alert = await queryOne(`SELECT * FROM alerts WHERE id = $1 AND ($2::UUID IS NULL OR account_id = $2)`, [id, accountId || null]);
  if (!alert) return res.status(404).json({ error: 'Not found' });
  return res.json({ alert });
}

export async function acknowledgeAlert(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const userId = req.user?.id;
  const accountId = req.user?.accountId;

  const alert = await queryOne(`
    UPDATE alerts SET status = 'acknowledged', acknowledged_by = $1, acknowledged_at = NOW()
    WHERE id = $2 AND status = 'active' AND ($3::UUID IS NULL OR account_id = $3) RETURNING *
  `, [userId, id, accountId || null]);

  if (!alert) return res.status(404).json({ error: 'Not found or already acknowledged' });
  return res.json({ success: true, alert });
}

export async function resolveAlert(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const accountId = req.user?.accountId;

  const alert = await queryOne(`
    UPDATE alerts SET status = 'resolved', resolved_at = NOW()
    WHERE id = $1 AND status IN ('active', 'acknowledged') AND ($2::UUID IS NULL OR account_id = $2) RETURNING *
  `, [id, accountId || null]);

  if (!alert) return res.status(404).json({ error: 'Not found' });
  return res.json({ success: true, alert });
}

export async function snoozeAlert(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const { hours = 4 } = req.body;
  const accountId = req.user?.accountId;

  const alert = await queryOne(`
    UPDATE alerts SET expires_at = NOW() + ($1 || ' hours')::INTERVAL, status = 'acknowledged'
    WHERE id = $2 AND ($3::UUID IS NULL OR account_id = $3) RETURNING *
  `, [Math.min(168, Number(hours)), id, accountId || null]);

  if (!alert) return res.status(404).json({ error: 'Not found' });
  return res.json({ success: true, alert });
}

export async function dismissAllAlerts(req: AuthenticatedRequest, res: Response) {
  const { type, severity } = req.body;
  const accountId = req.user?.accountId;

  if (!type) return res.status(400).json({ error: 'type required' });

  const result = await query(`
    UPDATE alerts SET status = 'resolved', resolved_at = NOW()
    WHERE alert_type = $1 AND status = 'active' AND ($2::UUID IS NULL OR account_id = $2)
      AND ($3::VARCHAR IS NULL OR severity = $3)
    RETURNING id
  `, [type, accountId, severity]);

  return res.json({ success: true, count: result.rowCount || 0 });
}

export async function triggerAlertGeneration(req: AuthenticatedRequest, res: Response) {
  const accountId = req.user?.accountId;
  if (!accountId) return res.status(400).json({ error: 'Account required' });

  const count = await runAlertGeneration(accountId);
  return res.json({ success: true, generated: count });
}
