/**
 * Conversations Controller - Search, browse, QA
 */

import { Response } from 'express';
import { query, queryOne } from '../../database/connection.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';

// Search
export async function searchConversations(req: AuthenticatedRequest, res: Response) {
  const { q, intent, state, confidenceMin, confidenceMax, platform, outcome, page = '1', limit = '20' } = req.query;
  const accountId = req.user?.accountId;
  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Number(limit));
  const offset = (pageNum - 1) * limitNum;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (accountId) { conditions.push(`EXISTS (SELECT 1 FROM agents a WHERE a.id = cs.agent_id AND a.account_id = $${idx++})`); params.push(accountId); }
  if (q) { conditions.push(`cs.content_tsvector @@ plainto_tsquery('simple', $${idx++})`); params.push(q); }
  if (intent) { conditions.push(`cs.primary_intent = $${idx++}`); params.push(intent); }
  if (state) { conditions.push(`cs.lead_state = $${idx++}`); params.push(state); }
  if (confidenceMin) { conditions.push(`cs.avg_confidence >= $${idx++}`); params.push(Number(confidenceMin)); }
  if (confidenceMax) { conditions.push(`cs.avg_confidence <= $${idx++}`); params.push(Number(confidenceMax)); }
  if (platform) { conditions.push(`cs.platform = $${idx++}`); params.push(platform); }
  if (outcome) { conditions.push(`cs.outcome = $${idx++}`); params.push(outcome); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await queryOne<{ total: string }>(`SELECT COUNT(*) as total FROM conversation_search cs ${where}`, params);
  const total = Number(countResult?.total) || 0;

  params.push(limitNum, offset);
  const result = await query(`
    SELECT cs.*, l.name as lead_name, l.phone as lead_phone,
           LEFT(cs.content_text, 200) as snippet
    FROM conversation_search cs
    JOIN leads l ON l.id = cs.lead_id AND l.deleted_at IS NULL
    ${where}
    ORDER BY cs.last_message_at DESC
    LIMIT $${idx++} OFFSET $${idx}
  `, params);
  const data = result.rows;

  return res.json({
    data: data.map((d: Record<string, unknown>) => ({
      conversationId: d.conversation_id, leadId: d.lead_id, leadName: d.lead_name, leadPhone: d.lead_phone,
      snippet: d.snippet, intent: d.primary_intent, confidence: Number(d.avg_confidence),
      outcome: d.outcome, messageCount: Number(d.message_count), lastMessageAt: d.last_message_at,
    })),
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
  });
}

export async function getRecentConversations(req: AuthenticatedRequest, res: Response) {
  const { limit = '10' } = req.query;
  const accountId = req.user?.accountId;
  const result = await query(`
    SELECT c.id, c.lead_id, l.name, l.phone, c.outcome, c.started_at, c.message_count
    FROM conversations c JOIN leads l ON l.id = c.lead_id AND l.deleted_at IS NULL
    LEFT JOIN agents a ON l.agent_id = a.id
    WHERE ($1::UUID IS NULL OR a.account_id = $1)
    ORDER BY c.started_at DESC LIMIT $2
  `, [accountId || null, Math.min(50, Number(limit))]);
  const data = result.rows;

  return res.json({ data: data.map((c: Record<string, unknown>) => ({ id: c.id, leadId: c.lead_id, name: c.name, phone: c.phone, outcome: c.outcome, startedAt: c.started_at })) });
}

export async function getConversationById(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const accountId = req.user?.accountId;

  const conv = await queryOne(`
    SELECT c.*, l.name, l.phone, l.status as lead_status, l.subject
    FROM conversations c JOIN leads l ON l.id = c.lead_id AND l.deleted_at IS NULL
    LEFT JOIN agents a ON l.agent_id = a.id
    WHERE c.id = $1 AND ($2::UUID IS NULL OR a.account_id = $2)
  `, [id, accountId || null]);

  if (!conv) return res.status(404).json({ error: 'Not found' });

  const messagesResult = await query(`SELECT * FROM messages WHERE lead_id = $1 ORDER BY created_at`, [conv.lead_id]);
  const messages = messagesResult.rows;

  const telemetryResult = await query(`SELECT * FROM ai_telemetry WHERE conversation_id = $1 ORDER BY created_at`, [id]);
  const telemetry = telemetryResult.rows;

  return res.json({
    conversation: { id: conv.id, outcome: conv.outcome, status: conv.status, startedAt: conv.started_at },
    lead: { id: conv.lead_id, name: conv.name, phone: conv.phone, status: conv.lead_status, subject: conv.subject },
    messages: messages.map((m: Record<string, unknown>) => ({ id: m.id, direction: m.direction, content: m.content, createdAt: m.created_at })),
    telemetry: telemetry.map((t: Record<string, unknown>) => ({ intent: t.detected_intent, confidence: Number(t.intent_confidence), reasoning: t.reasoning })),
  });
}

export async function getConversationTimeline(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const accountId = req.user?.accountId;

  // Verify conversation belongs to this tenant
  const conv = await queryOne<{ lead_id: string }>(
    `SELECT c.lead_id FROM conversations c
     JOIN leads l ON c.lead_id = l.id AND l.deleted_at IS NULL
     LEFT JOIN agents a ON l.agent_id = a.id
     WHERE c.id = $1 AND ($2::UUID IS NULL OR a.account_id = $2)`,
    [id, accountId || null],
  );
  if (!conv) return res.status(404).json({ error: 'Not found' });

  const result = await query(`
    SELECT m.created_at as ts, m.direction, m.content, t.detected_intent, t.intent_confidence
    FROM messages m
    LEFT JOIN ai_telemetry t ON t.message_id = m.id
    WHERE m.lead_id = $1
    ORDER BY m.created_at
  `, [conv.lead_id]);
  const events = result.rows;

  return res.json({ events: events.map((e: Record<string, unknown>) => ({ timestamp: e.ts, direction: e.direction, content: (e.content as string)?.substring(0, 100), intent: e.detected_intent })) });
}

export async function getDecisionPath(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const accountId = req.user?.accountId;

  // Verify conversation belongs to this tenant
  const conv = await queryOne<{ id: string }>(
    `SELECT c.id FROM conversations c
     JOIN leads l ON c.lead_id = l.id AND l.deleted_at IS NULL
     LEFT JOIN agents a ON l.agent_id = a.id
     WHERE c.id = $1 AND ($2::UUID IS NULL OR a.account_id = $2)`,
    [id, accountId || null],
  );
  if (!conv) return res.status(404).json({ error: 'Not found' });

  const result = await query(`
    SELECT decision_path, entities_extracted, tool_calls, reasoning
    FROM ai_telemetry WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 5
  `, [id]);
  const data = result.rows;

  return res.json({ paths: data });
}

// QA Flagging
export async function flagConversation(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const { flagType, severity = 'medium', reason } = req.body;
  const userId = req.user?.id;
  const accountId = req.user?.accountId;

  if (!flagType || !reason) return res.status(400).json({ error: 'flagType and reason required' });

  // Verify conversation belongs to this tenant
  const conv = await queryOne<{ id: string }>(
    `SELECT c.id FROM conversations c
     JOIN leads l ON c.lead_id = l.id AND l.deleted_at IS NULL
     LEFT JOIN agents a ON l.agent_id = a.id
     WHERE c.id = $1 AND ($2::UUID IS NULL OR a.account_id = $2)`,
    [id, accountId || null],
  );
  if (!conv) return res.status(404).json({ error: 'Not found' });

  const flag = await queryOne(`
    INSERT INTO qa_flags (conversation_id, flag_type, severity, reason, flagged_by)
    VALUES ($1, $2, $3, $4, $5) RETURNING *
  `, [id, flagType, severity, reason, userId]);

  return res.json({ success: true, flag });
}

export async function getConversationFlags(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const accountId = req.user?.accountId;

  // Verify conversation belongs to this tenant
  const conv = await queryOne<{ id: string }>(
    `SELECT c.id FROM conversations c
     JOIN leads l ON c.lead_id = l.id AND l.deleted_at IS NULL
     LEFT JOIN agents a ON l.agent_id = a.id
     WHERE c.id = $1 AND ($2::UUID IS NULL OR a.account_id = $2)`,
    [id, accountId || null],
  );
  if (!conv) return res.status(404).json({ error: 'Not found' });

  const result = await query(`SELECT * FROM qa_flags WHERE conversation_id = $1 ORDER BY created_at DESC`, [id]);
  const flags = result.rows;

  return res.json({ flags });
}

// QA Dashboard
export async function getQAMetrics(req: AuthenticatedRequest, res: Response) {
  const accountId = req.user?.accountId;

  const summary = await queryOne(`
    SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE qf.status = 'open') as open_count,
           COUNT(*) FILTER (WHERE qf.status = 'resolved') as resolved
    FROM qa_flags qf
    JOIN conversations c ON c.id = qf.conversation_id
    JOIN leads l ON l.id = c.lead_id AND l.deleted_at IS NULL
    LEFT JOIN agents a ON l.agent_id = a.id
    WHERE qf.created_at > NOW() - INTERVAL '30 days'
      AND ($1::UUID IS NULL OR a.account_id = $1)
  `, [accountId || null]);

  const result = await query(`
    SELECT qf.flag_type, COUNT(*) as cnt FROM qa_flags qf
    JOIN conversations c ON c.id = qf.conversation_id
    JOIN leads l ON l.id = c.lead_id AND l.deleted_at IS NULL
    LEFT JOIN agents a ON l.agent_id = a.id
    WHERE qf.created_at > NOW() - INTERVAL '30 days'
      AND ($1::UUID IS NULL OR a.account_id = $1)
    GROUP BY qf.flag_type ORDER BY cnt DESC
  `, [accountId || null]);
  const byType = result.rows;

  return res.json({
    summary: { total: Number(summary?.total), open: Number(summary?.open_count), resolved: Number(summary?.resolved) },
    byType: byType.map((t: Record<string, unknown>) => ({ type: t.flag_type, count: Number(t.cnt) })),
  });
}

export async function getQAFlags(req: AuthenticatedRequest, res: Response) {
  const { status, severity, page = '1', limit = '20' } = req.query;
  const accountId = req.user?.accountId;
  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Number(limit));

  const conditions: string[] = ['($1::UUID IS NULL OR a.account_id = $1)'];
  const params: unknown[] = [accountId || null];
  let idx = 2;

  if (status) { conditions.push(`qf.status = $${idx++}`); params.push(status); }
  if (severity) { conditions.push(`qf.severity = $${idx++}`); params.push(severity); }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countResult = await queryOne<{ total: string }>(
    `SELECT COUNT(*) as total FROM qa_flags qf
     JOIN conversations c ON c.id = qf.conversation_id
     JOIN leads l ON l.id = c.lead_id AND l.deleted_at IS NULL
     LEFT JOIN agents a ON l.agent_id = a.id
     ${where}`,
    params,
  );
  const total = Number(countResult?.total) || 0;

  params.push(limitNum, (pageNum - 1) * limitNum);
  const result = await query(`
    SELECT qf.*, l.name as lead_name FROM qa_flags qf
    JOIN conversations c ON c.id = qf.conversation_id
    JOIN leads l ON l.id = c.lead_id AND l.deleted_at IS NULL
    LEFT JOIN agents a ON l.agent_id = a.id
    ${where} ORDER BY qf.created_at DESC LIMIT $${idx++} OFFSET $${idx}
  `, params);
  const flags = result.rows;

  return res.json({ data: flags, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
}

export async function updateQAFlag(req: AuthenticatedRequest, res: Response) {
  const { flagId } = req.params;
  const { status, resolutionNotes } = req.body;
  const userId = req.user?.id;
  const accountId = req.user?.accountId;

  // Verify flag belongs to a conversation in this tenant
  const existing = await queryOne<{ id: string }>(
    `SELECT qf.id FROM qa_flags qf
     JOIN conversations c ON c.id = qf.conversation_id
     JOIN leads l ON l.id = c.lead_id AND l.deleted_at IS NULL
     LEFT JOIN agents a ON l.agent_id = a.id
     WHERE qf.id = $1 AND ($2::UUID IS NULL OR a.account_id = $2)`,
    [flagId, accountId || null],
  );
  if (!existing) return res.status(404).json({ error: 'Flag not found' });

  const flag = await queryOne(`
    UPDATE qa_flags SET status = COALESCE($1, status), resolution_notes = COALESCE($2, resolution_notes),
           resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END,
           resolved_by = CASE WHEN $1 = 'resolved' THEN $3 ELSE resolved_by END
    WHERE id = $4 RETURNING *
  `, [status, resolutionNotes, userId, flagId]);

  if (!flag) return res.status(404).json({ error: 'Flag not found' });
  return res.json({ success: true, flag });
}

export async function getFailurePatterns(req: AuthenticatedRequest, res: Response) {
  const accountId = req.user?.accountId;
  const result = await query(`
    SELECT qf.flag_type, COUNT(*) as cnt FROM qa_flags qf
    JOIN conversations c ON c.id = qf.conversation_id
    JOIN leads l ON l.id = c.lead_id AND l.deleted_at IS NULL
    LEFT JOIN agents a ON l.agent_id = a.id
    WHERE qf.created_at > NOW() - INTERVAL '30 days'
      AND ($1::UUID IS NULL OR a.account_id = $1)
    GROUP BY qf.flag_type ORDER BY cnt DESC LIMIT 10
  `, [accountId || null]);
  const patterns = result.rows;

  return res.json({ patterns: patterns.map((p: Record<string, unknown>) => ({ type: p.flag_type, count: Number(p.cnt) })) });
}

export async function getABTestResults(req: AuthenticatedRequest, res: Response) {
  const accountId = req.user?.accountId;
  const result = await query(`
    SELECT pv.*, COUNT(DISTINCT t.conversation_id) as conversations, AVG(t.intent_confidence) as avg_conf
    FROM prompt_versions pv
    LEFT JOIN ai_telemetry t ON t.prompt_version_id = pv.id
    LEFT JOIN leads l ON t.lead_id = l.id AND l.deleted_at IS NULL
    LEFT JOIN agents a ON l.agent_id = a.id
    WHERE ($1::UUID IS NULL OR a.account_id = $1 OR t.id IS NULL)
    GROUP BY pv.id ORDER BY pv.version_number DESC LIMIT 10
  `, [accountId || null]);
  const tests = result.rows;

  return res.json({ tests: tests.map((t: Record<string, unknown>) => ({ id: t.id, name: t.version_name, active: t.active, conversations: Number(t.conversations), avgConfidence: Number(t.avg_conf) })) });
}

export async function exportConversations(req: AuthenticatedRequest, res: Response) {
  const accountId = req.user?.accountId;
  const result = await query(`
    SELECT c.id, l.name, c.outcome, c.started_at FROM conversations c
    JOIN leads l ON l.id = c.lead_id AND l.deleted_at IS NULL
    LEFT JOIN agents a ON l.agent_id = a.id
    WHERE ($1::UUID IS NULL OR a.account_id = $1)
    ORDER BY c.started_at DESC LIMIT 100
  `, [accountId || null]);
  const conversations = result.rows;

  return res.json({ count: conversations.length, data: conversations });
}
