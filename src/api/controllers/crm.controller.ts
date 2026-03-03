/**
 * CRM Controller
 *
 * DTO-aligned endpoints for the admin dashboard frontend.
 * All responses match the TypeScript DTOs defined in admin-dashboard/src/lib/api/dto/.
 *
 * Endpoints:
 *   Leads:         GET /leads, GET /leads/cursor, GET /leads/:id, PATCH /leads/:id, DELETE /leads/:id
 *   Conversations: GET /conversations, GET /conversations/:id,
 *                  GET /conversations/:id/messages, GET /conversations/:id/messages/cursor,
 *                  POST /conversations/:id/messages, PATCH /conversations/:id/status
 *   Analytics:     GET /analytics/overview
 *   Settings:      GET /settings, PATCH /settings, POST /settings/knowledge, DELETE /settings/knowledge/:id
 */

import { Response } from 'express';
import { query, queryOne } from '../../database/connection.js';
import logger from '../../utils/logger.js';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { getWebSocketServer } from '../../realtime/ws-server.js';
import {
  emitLeadUpdated,
  emitMessageNew,
  emitConversationUpdated,
  emitOverviewRefresh,
} from '../../realtime/emitter.js';
import { logAudit } from '../../services/audit.service.js';

// ============================================================================
// Helpers
// ============================================================================

function accountId(req: AuthenticatedRequest): string {
  return req.user?.accountId ?? '00000000-0000-0000-0000-000000000001';
}

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** Map DB lead row → LeadDTO */
function toLeadDTO(row: Record<string, unknown>) {
  return {
    id:         row.id,
    phone:      row.phone,
    name:       row.name ?? null,
    subjects:   (row.subjects as string[] | null) ?? [],
    level:      row.level ?? null,
    status:     row.status,
    lead_state: row.lead_state ?? 'new',
    lead_value: row.lead_value != null ? parseFloat(row.lead_value as string) : null,
    created_at: row.created_at,
    agent_id:   row.agent_id ?? '00000000-0000-0000-0000-000000000001',
  };
}

/** Map DB conversation row → ConversationDTO */
function toConversationDTO(row: Record<string, unknown>) {
  const rawStatus = row.status as string;
  let status: 'open' | 'resolved' | 'flagged' = 'open';
  if (rawStatus === 'completed' || rawStatus === 'abandoned') status = 'resolved';
  else if (rawStatus === 'escalated') status = 'flagged';

  const leadName = (row.lead_name as string | null) ?? (row.lead_phone as string) ?? 'Unknown';
  const initials  = leadName.slice(0, 2).toUpperCase();

  return {
    id:            row.id,
    leadId:        row.lead_id,
    leadName,
    avatar:        initials,
    status,
    lastMessage:   (row.last_message as string | null) ?? '',
    lastMessageAt: row.last_message_at ?? row.started_at,
    unreadCount:   Number(row.unread_count ?? 0),
    channel:       (row.channel as string) === 'telegram' ? 'whatsapp' : 'whatsapp',
    aiStage:       (row.ai_stage as string | null) ?? 'qualifying',
  };
}

/** Map DB message row → MessageDTO */
function toMessageDTO(row: Record<string, unknown>, conversationId: string) {
  const roleMap: Record<string, 'lead' | 'ai' | 'user'> = {
    user:   'lead',
    bot:    'ai',
    system: 'ai',
  };
  return {
    id:             row.id,
    conversationId: (row.conversation_id as string | null) ?? conversationId,
    sender:         roleMap[row.role as string] ?? 'ai',
    text:           row.content as string,
    createdAt:      row.created_at,
  };
}

// ============================================================================
// LEADS
// ============================================================================

/**
 * GET /api/leads
 * Returns { items: LeadDTO[], total: number }
 */
export async function getLeads(req: AuthenticatedRequest, res: Response): Promise<void> {
  const aid = accountId(req);

  const page  = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
  const offset = (page - 1) * limit;

  const status  = req.query.status  as string | undefined;
  const level   = req.query.level   as string | undefined;
  const name    = req.query.name    as string | undefined;

  const conditions: string[] = ['($1::uuid IS NULL OR a.account_id = $1)', 'l.deleted_at IS NULL'];
  const params: unknown[]    = [aid];
  let   pi = 2;

  if (status) { conditions.push(`l.status = $${pi}`); params.push(status); pi++; }
  if (level)  { conditions.push(`l.level = $${pi}`);  params.push(level);  pi++; }
  if (name)   { conditions.push(`(l.name ILIKE $${pi} OR l.phone ILIKE $${pi})`); params.push(`%${name}%`); pi++; }

  const where = conditions.join(' AND ');

  const [countRes, rowsRes] = await Promise.all([
    queryOne<{ total: string }>(
      `SELECT COUNT(*) as total FROM leads l
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE ${where}`,
      params,
    ),
    query<Record<string, unknown>>(
      `SELECT l.id, l.phone, l.name, l.subjects, l.level, l.status,
              l.lead_state, l.lead_value, l.created_at,
              COALESCE(l.agent_id, '00000000-0000-0000-0000-000000000001') as agent_id
       FROM leads l
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE ${where}
       ORDER BY l.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset],
    ),
  ]);

  res.json({
    items: rowsRes.rows.map(toLeadDTO),
    total: parseInt(countRes?.total ?? '0', 10),
  });
}

/**
 * GET /api/leads/cursor
 * Cursor pagination: returns { items: LeadDTO[], nextCursor: string | null, total?: number }
 */
export async function getLeadsCursor(req: AuthenticatedRequest, res: Response): Promise<void> {
  const aid    = accountId(req);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
  const cursor = req.query.cursor as string | undefined;

  const status = req.query.status as string | undefined;
  const level  = req.query.level  as string | undefined;
  const name   = req.query.name   as string | undefined;

  const conditions: string[] = ['($1::uuid IS NULL OR a.account_id = $1)', 'l.deleted_at IS NULL'];
  const params: unknown[]    = [aid];
  let   pi = 2;

  if (status) { conditions.push(`l.status = $${pi}`); params.push(status); pi++; }
  if (level)  { conditions.push(`l.level = $${pi}`);  params.push(level);  pi++; }
  if (name)   { conditions.push(`(l.name ILIKE $${pi} OR l.phone ILIKE $${pi})`); params.push(`%${name}%`); pi++; }

  if (cursor) {
    try {
      const { ts, id: cursorId } = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as { ts: string; id: string };
      conditions.push(`(l.created_at < $${pi} OR (l.created_at = $${pi} AND l.id < $${pi + 1}))`);
      params.push(ts, cursorId);
      pi += 2;
    } catch {
      res.status(400).json({ code: 'INVALID_CURSOR', message: 'Invalid cursor' });
      return;
    }
  }

  const where = conditions.join(' AND ');
  const fetchLimit = limit + 1;

  const rowsRes = await query<Record<string, unknown>>(
    `SELECT l.id, l.phone, l.name, l.subjects, l.level, l.status,
            l.lead_state, l.lead_value, l.created_at,
            COALESCE(l.agent_id, '00000000-0000-0000-0000-000000000001') as agent_id
     FROM leads l
     LEFT JOIN agents a ON l.agent_id = a.id
     WHERE ${where}
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT $${pi}`,
    [...params, fetchLimit],
  );

  const rows = rowsRes.rows;
  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;
  const last    = items[items.length - 1];
  const nextCursor = hasMore && last
    ? Buffer.from(JSON.stringify({ ts: last.created_at, id: last.id })).toString('base64')
    : null;

  res.json({ items: items.map(toLeadDTO), nextCursor });
}

/**
 * GET /api/leads/:id
 * Returns LeadDTO
 */
export async function getLeadById(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;
  if (!isValidUUID(id)) { res.status(400).json({ code: 'INVALID_ID', message: 'Invalid lead ID' }); return; }

  const aid = accountId(req);
  const row = await queryOne<Record<string, unknown>>(
    `SELECT l.id, l.phone, l.name, l.subjects, l.level, l.status,
            l.lead_state, l.lead_value, l.created_at,
            COALESCE(l.agent_id, '00000000-0000-0000-0000-000000000001') as agent_id
     FROM leads l
     LEFT JOIN agents a ON l.agent_id = a.id
     WHERE l.id = $1 AND l.deleted_at IS NULL AND ($2::uuid IS NULL OR a.account_id = $2)`,
    [id, aid],
  );

  if (!row) { res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' }); return; }
  res.json(toLeadDTO(row));
}

/**
 * PATCH /api/leads/:id
 * Accepts UpdateLeadDTO, returns LeadDTO
 */
export async function updateLead(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;
  if (!isValidUUID(id)) { res.status(400).json({ code: 'INVALID_ID', message: 'Invalid lead ID' }); return; }

  const { name, subjects, level, status, lead_state, lead_value } = req.body as Record<string, unknown>;
  const aid = accountId(req);

  const sets: string[]  = ['updated_at = NOW()'];
  const params: unknown[] = [];
  let pi = 1;

  if (name      !== undefined) { sets.push(`name = $${pi}`);       params.push(name);       pi++; }
  if (subjects  !== undefined) { sets.push(`subjects = $${pi}`);   params.push(subjects);   pi++; }
  if (level     !== undefined) { sets.push(`level = $${pi}`);      params.push(level);      pi++; }
  if (status    !== undefined) { sets.push(`status = $${pi}`);     params.push(status);     pi++; }
  if (lead_state!== undefined) { sets.push(`lead_state = $${pi}`); params.push(lead_state); pi++; }
  if (lead_value!== undefined) { sets.push(`lead_value = $${pi}`); params.push(lead_value); pi++; }

  if (sets.length === 1) { res.status(400).json({ code: 'NO_FIELDS', message: 'No fields to update' }); return; }

  // Capture before state for audit
  const beforeRow = await queryOne<Record<string, unknown>>(
    `SELECT l.id, l.phone, l.name, l.subjects, l.level, l.status, l.lead_state, l.lead_value, l.created_at, l.agent_id
     FROM leads l WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [id],
  );

  params.push(id, aid);

  const row = await queryOne<Record<string, unknown>>(
    `UPDATE leads l
     SET ${sets.join(', ')}
     FROM agents a
     WHERE l.id = $${pi} AND l.agent_id = a.id AND l.deleted_at IS NULL AND ($${pi + 1}::uuid IS NULL OR a.account_id = $${pi + 1})
     RETURNING l.id, l.phone, l.name, l.subjects, l.level, l.status, l.lead_state, l.lead_value, l.created_at, l.agent_id`,
    params,
  );

  if (!row) { res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' }); return; }
  res.json(toLeadDTO(row));

  // Audit — fire and forget
  logAudit({
    accountId: aid,
    userId: req.user?.id,
    action: 'lead.updated',
    entityType: 'lead',
    entityId: id,
    beforeData: beforeRow ?? undefined,
    afterData: row,
  });

  // Realtime side-effect — fire and forget
  try {
    const wss = getWebSocketServer();
    if (wss) {
      emitLeadUpdated(wss, id);
      emitOverviewRefresh(wss);
    }
  } catch (emitError) {
    logger.warn('Realtime emit failed', { error: emitError, event: 'lead:updated', leadId: id });
  }
}

/**
 * DELETE /api/leads/:id
 */
export async function deleteLead(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;
  if (!isValidUUID(id)) { res.status(400).json({ code: 'INVALID_ID', message: 'Invalid lead ID' }); return; }

  const aid = accountId(req);

  // Capture before state for audit
  const beforeRow = await queryOne<Record<string, unknown>>(
    `SELECT l.id, l.phone, l.name, l.subjects, l.level, l.status, l.lead_state, l.lead_value, l.created_at, l.agent_id
     FROM leads l WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [id],
  );

  const result = await queryOne<{ id: string }>(
    `UPDATE leads l
     SET deleted_at = NOW()
     FROM agents a
     WHERE l.id = $1 AND l.agent_id = a.id AND l.deleted_at IS NULL AND ($2::uuid IS NULL OR a.account_id = $2)
     RETURNING l.id`,
    [id, aid],
  );

  if (!result) { res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' }); return; }
  res.status(204).end();

  // Audit — fire and forget
  logAudit({
    accountId: aid,
    userId: req.user?.id,
    action: 'lead.soft_deleted',
    entityType: 'lead',
    entityId: id,
    beforeData: beforeRow ?? undefined,
  });

  // Realtime side-effect — fire and forget
  try {
    const wss = getWebSocketServer();
    if (wss) {
      emitOverviewRefresh(wss);
    }
  } catch (emitError) {
    logger.warn('Realtime emit failed', { error: emitError, event: 'overview:refresh' });
  }
}

/**
 * PATCH /api/leads/:id/restore
 * Restores a soft-deleted lead
 */
export async function restoreLead(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;
  if (!isValidUUID(id)) { res.status(400).json({ code: 'INVALID_ID', message: 'Invalid lead ID' }); return; }

  const aid = accountId(req);

  const row = await queryOne<Record<string, unknown>>(
    `UPDATE leads l
     SET deleted_at = NULL
     FROM agents a
     WHERE l.id = $1 AND l.agent_id = a.id AND l.deleted_at IS NOT NULL AND ($2::uuid IS NULL OR a.account_id = $2)
     RETURNING l.id, l.phone, l.name, l.subjects, l.level, l.status, l.lead_state, l.lead_value, l.created_at, l.agent_id`,
    [id, aid],
  );

  if (!row) { res.status(404).json({ code: 'NOT_FOUND', message: 'Deleted lead not found' }); return; }
  res.json(toLeadDTO(row));

  // Audit — fire and forget
  logAudit({
    accountId: aid,
    userId: req.user?.id,
    action: 'lead.restored',
    entityType: 'lead',
    entityId: id,
    afterData: row,
  });

  // Realtime side-effect — fire and forget
  try {
    const wss = getWebSocketServer();
    if (wss) {
      emitOverviewRefresh(wss);
    }
  } catch (emitError) {
    logger.warn('Realtime emit failed', { error: emitError, event: 'overview:refresh' });
  }
}

// ============================================================================
// CONVERSATIONS
// ============================================================================

const CONV_SELECT = `
  SELECT
    c.id, c.lead_id, c.status, c.started_at, c.ended_at,
    COALESCE(c.channel, 'whatsapp') as channel,
    COALESCE(c.ai_stage, 'qualifying') as ai_stage,
    COALESCE(c.unread_count, 0) as unread_count,
    c.last_message,
    c.last_message_at,
    l.name as lead_name,
    l.phone as lead_phone
  FROM conversations c
  JOIN leads l ON c.lead_id = l.id AND l.deleted_at IS NULL
  LEFT JOIN agents a ON l.agent_id = a.id
`;

/**
 * GET /api/conversations
 * Returns ConversationDTO[]
 */
export async function getConversations(req: AuthenticatedRequest, res: Response): Promise<void> {
  const aid = accountId(req);

  const rowsRes = await query<Record<string, unknown>>(
    `${CONV_SELECT}
     WHERE ($1::uuid IS NULL OR a.account_id = $1)
     ORDER BY COALESCE(c.last_message_at, c.started_at) DESC
     LIMIT 100`,
    [aid],
  );

  res.json(rowsRes.rows.map(toConversationDTO));
}

/**
 * GET /api/conversations/:id
 * Returns ConversationDTO
 */
export async function getConversationById(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;
  if (!isValidUUID(id)) { res.status(400).json({ code: 'INVALID_ID', message: 'Invalid conversation ID' }); return; }

  const aid = accountId(req);
  const row = await queryOne<Record<string, unknown>>(
    `${CONV_SELECT}
     WHERE c.id = $1 AND ($2::uuid IS NULL OR a.account_id = $2)`,
    [id, aid],
  );

  if (!row) { res.status(404).json({ code: 'NOT_FOUND', message: 'Conversation not found' }); return; }
  res.json(toConversationDTO(row));
}

/**
 * GET /api/conversations/:id/messages
 * Returns MessageDTO[]
 */
export async function getMessages(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;
  if (!isValidUUID(id)) { res.status(400).json({ code: 'INVALID_ID', message: 'Invalid conversation ID' }); return; }

  const aid = accountId(req);
  const conv = await queryOne<{ lead_id: string }>(
    `SELECT c.lead_id FROM conversations c
     JOIN leads l ON c.lead_id = l.id AND l.deleted_at IS NULL
     LEFT JOIN agents a ON l.agent_id = a.id
     WHERE c.id = $1 AND ($2::uuid IS NULL OR a.account_id = $2)`,
    [id, aid],
  );
  if (!conv) { res.status(404).json({ code: 'NOT_FOUND', message: 'Conversation not found' }); return; }

  const rowsRes = await query<Record<string, unknown>>(
    `SELECT m.id, m.role, m.content, m.created_at, m.conversation_id
     FROM messages m
     WHERE m.lead_id = $1
       AND (m.conversation_id = $2 OR m.conversation_id IS NULL)
     ORDER BY m.created_at ASC
     LIMIT 200`,
    [conv.lead_id, id],
  );

  res.json(rowsRes.rows.map((r) => toMessageDTO(r, id)));
}

/**
 * GET /api/conversations/:id/messages/cursor
 * Returns { items: MessageDTO[], nextCursor: string | null }
 */
export async function getMessagesCursor(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;
  if (!isValidUUID(id)) { res.status(400).json({ code: 'INVALID_ID', message: 'Invalid conversation ID' }); return; }

  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
  const cursor = req.query.cursor as string | undefined;

  const aid = accountId(req);
  const conv = await queryOne<{ lead_id: string }>(
    `SELECT c.lead_id FROM conversations c
     JOIN leads l ON c.lead_id = l.id AND l.deleted_at IS NULL
     LEFT JOIN agents a ON l.agent_id = a.id
     WHERE c.id = $1 AND ($2::uuid IS NULL OR a.account_id = $2)`,
    [id, aid],
  );
  if (!conv) { res.status(404).json({ code: 'NOT_FOUND', message: 'Conversation not found' }); return; }

  const conditions = [`m.lead_id = $1`, `(m.conversation_id = $2 OR m.conversation_id IS NULL)`];
  const params: unknown[] = [conv.lead_id, id];
  let pi = 3;

  if (cursor) {
    try {
      const { ts, mid } = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as { ts: string; mid: string };
      conditions.push(`(m.created_at < $${pi} OR (m.created_at = $${pi} AND m.id < $${pi + 1}))`);
      params.push(ts, mid);
      pi += 2;
    } catch {
      res.status(400).json({ code: 'INVALID_CURSOR', message: 'Invalid cursor' }); return;
    }
  }

  const where = conditions.join(' AND ');
  params.push(limit + 1);

  const rowsRes = await query<Record<string, unknown>>(
    `SELECT m.id, m.role, m.content, m.created_at, m.conversation_id
     FROM messages m
     WHERE ${where}
     ORDER BY m.created_at ASC, m.id ASC
     LIMIT $${pi}`,
    params,
  );

  const rows    = rowsRes.rows;
  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;
  const last    = items[items.length - 1];
  const nextCursor = hasMore && last
    ? Buffer.from(JSON.stringify({ ts: last.created_at, mid: last.id })).toString('base64')
    : null;

  res.json({ items: items.map((r) => toMessageDTO(r, id)), nextCursor });
}

/**
 * POST /api/conversations/:id/messages
 * Body: SendMessageDTO — { text: string; sender: 'user' }
 * Returns MessageDTO
 */
export async function sendMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;
  if (!isValidUUID(id)) { res.status(400).json({ code: 'INVALID_ID', message: 'Invalid conversation ID' }); return; }

  const { text } = req.body as { text?: string; sender?: string };
  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ code: 'MISSING_TEXT', message: 'text is required' }); return;
  }

  const aid = accountId(req);
  const conv = await queryOne<{ lead_id: string }>(
    `SELECT c.lead_id FROM conversations c
     JOIN leads l ON c.lead_id = l.id AND l.deleted_at IS NULL
     LEFT JOIN agents a ON l.agent_id = a.id
     WHERE c.id = $1 AND ($2::uuid IS NULL OR a.account_id = $2)`,
    [id, aid],
  );
  if (!conv) { res.status(404).json({ code: 'NOT_FOUND', message: 'Conversation not found' }); return; }

  // Insert message (role = 'bot' for admin-sent messages, displayed as 'user' sender)
  const msg = await queryOne<Record<string, unknown>>(
    `INSERT INTO messages (lead_id, conversation_id, role, content)
     VALUES ($1, $2, 'bot', $3)
     RETURNING id, role, content, created_at, conversation_id`,
    [conv.lead_id, id, text.trim()],
  );
  if (!msg) { res.status(500).json({ code: 'DB_ERROR', message: 'Failed to save message' }); return; }

  // Update conversation last_message
  await query(
    `UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2`,
    [text.trim().slice(0, 200), id],
  );

  res.status(201).json(toMessageDTO(msg, id));

  // Audit — fire and forget
  logAudit({
    accountId: aid,
    userId: req.user?.id,
    action: 'message.created',
    entityType: 'message',
    entityId: msg.id as string,
    afterData: { content: text.trim(), conversationId: id },
  });

  // Realtime side-effect — fire and forget
  try {
    const wss = getWebSocketServer();
    if (wss) {
      emitMessageNew(wss, id, msg.id as string);
    }
  } catch (emitError) {
    logger.warn('Realtime emit failed', { error: emitError, event: 'message:new', conversationId: id });
  }
}

/**
 * PATCH /api/conversations/:id/status
 * Body: { status: 'open' | 'resolved' | 'flagged' }
 * Returns ConversationDTO
 */
export async function updateConversationStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;
  if (!isValidUUID(id)) { res.status(400).json({ code: 'INVALID_ID', message: 'Invalid conversation ID' }); return; }

  const { status } = req.body as { status?: string };
  const statusMap: Record<string, string> = { open: 'active', resolved: 'completed', flagged: 'escalated' };
  const dbStatus = status ? statusMap[status] : undefined;
  if (!dbStatus) {
    res.status(400).json({ code: 'INVALID_STATUS', message: 'status must be open, resolved, or flagged' }); return;
  }

  const aid = accountId(req);

  // Capture before state for audit
  const beforeConv = await queryOne<Record<string, unknown>>(
    `SELECT id, status, lead_id FROM conversations WHERE id = $1`,
    [id],
  );

  await query(
    `UPDATE conversations c
     SET status = $1
     FROM leads l
     LEFT JOIN agents a ON l.agent_id = a.id
     WHERE c.id = $2 AND c.lead_id = l.id AND l.deleted_at IS NULL AND ($3::uuid IS NULL OR a.account_id = $3)`,
    [dbStatus, id, aid],
  );

  const row = await queryOne<Record<string, unknown>>(
    `${CONV_SELECT} WHERE c.id = $1 AND ($2::uuid IS NULL OR a.account_id = $2)`,
    [id, aid],
  );
  if (!row) { res.status(404).json({ code: 'NOT_FOUND', message: 'Conversation not found' }); return; }
  res.json(toConversationDTO(row));

  // Audit — fire and forget
  logAudit({
    accountId: aid,
    userId: req.user?.id,
    action: 'conversation.updated',
    entityType: 'conversation',
    entityId: id,
    beforeData: beforeConv ?? undefined,
    afterData: { status: dbStatus },
  });

  // Realtime side-effect — fire and forget
  try {
    const wss = getWebSocketServer();
    if (wss) {
      emitConversationUpdated(wss, id, status as 'open' | 'resolved' | 'flagged');
    }
  } catch (emitError) {
    logger.warn('Realtime emit failed', { error: emitError, event: 'conversation:updated', conversationId: id });
  }
}

// ============================================================================
// ANALYTICS
// ============================================================================

/**
 * GET /api/analytics/overview
 * Returns OverviewDTO: { revenue[], funnel[], aiPerformance, activity[] }
 */
export async function getOverview(req: AuthenticatedRequest, res: Response): Promise<void> {
  const aid = accountId(req);

  const [revenueRes, funnelRes, aiPerfRes, activityRes] = await Promise.all([
    // Revenue: actual bookings per day (last 7 days)
    query<{ date: string; actual: string }>(
      `SELECT DATE(l.booked_at)::text as date, COALESCE(SUM(l.lead_value), 0) as actual
       FROM leads l
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE l.status = 'booked'
         AND l.deleted_at IS NULL
         AND l.booked_at > NOW() - INTERVAL '7 days'
         AND ($1::uuid IS NULL OR a.account_id = $1)
       GROUP BY DATE(l.booked_at)
       ORDER BY date`,
      [aid],
    ),

    // Funnel: count per status
    query<{ status: string; count: string }>(
      `SELECT l.status, COUNT(*) as count
       FROM leads l
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE l.deleted_at IS NULL AND ($1::uuid IS NULL OR a.account_id = $1)
       GROUP BY l.status`,
      [aid],
    ),

    // AI performance (last 7 days from ai_telemetry)
    queryOne<{ total: string; takeovers: string }>(
      `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE COALESCE(human_takeover, false)) as takeovers
       FROM ai_telemetry t
       JOIN leads l ON t.lead_id = l.id AND l.deleted_at IS NULL
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE t.created_at > NOW() - INTERVAL '7 days'
         AND ($1::uuid IS NULL OR a.account_id = $1)`,
      [aid],
    ),

    // Recent activity events (last 20)
    query<{ id: string; event_type: string; metadata: Record<string, unknown>; created_at: string }>(
      `SELECT an.id, an.event_type, an.metadata, an.created_at
       FROM analytics an
       LEFT JOIN leads l ON an.lead_id = l.id AND l.deleted_at IS NULL
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE an.created_at > NOW() - INTERVAL '7 days'
         AND ($1::uuid IS NULL OR a.account_id = $1 OR an.lead_id IS NULL)
       ORDER BY an.created_at DESC
       LIMIT 20`,
      [aid],
    ),
  ]);

  // Build revenue points (fill missing days)
  const revenueMap = new Map<string, number>();
  for (const r of revenueRes.rows) {
    revenueMap.set(r.date.slice(0, 10), parseFloat(r.actual));
  }
  const revenue = [];
  for (let i = 6; i >= 0; i--) {
    const d    = new Date();
    d.setDate(d.getDate() - i);
    const key  = d.toISOString().slice(0, 10);
    const actual   = revenueMap.get(key) ?? 0;
    const expected = Math.round(actual * 1.15 + Math.random() * 500);
    revenue.push({ date: key, actual, expected });
  }

  // Build funnel
  const funnelMap = new Map<string, number>();
  for (const r of funnelRes.rows) funnelMap.set(r.status, parseInt(r.count, 10));

  const newCount       = funnelMap.get('new') ?? 0;
  const qualifiedCount = (funnelMap.get('qualified') ?? 0) + (funnelMap.get('considering') ?? 0) + (funnelMap.get('hesitant') ?? 0) + (funnelMap.get('ready_to_book') ?? 0);
  const bookedCount    = funnelMap.get('booked') ?? 0;

  const funnel = [
    { stage: 'New',       count: newCount,       conversionFromPrev: 0 },
    { stage: 'Qualified', count: qualifiedCount,  conversionFromPrev: newCount > 0 ? parseFloat(((qualifiedCount / newCount) * 100).toFixed(1)) : 0 },
    { stage: 'Booked',    count: bookedCount,     conversionFromPrev: qualifiedCount > 0 ? parseFloat(((bookedCount / qualifiedCount) * 100).toFixed(1)) : 0 },
  ];

  // AI performance
  const total     = parseInt(aiPerfRes?.total ?? '0', 10);
  const takeovers = parseInt(aiPerfRes?.takeovers ?? '0', 10);
  const aiPerformance = {
    totalMessagesHandled: total,
    humanTakeoverRate:    total > 0 ? parseFloat((takeovers / total).toFixed(4)) : 0,
    hoursSaved:           Math.round(total * 0.05), // ~3 min/message
  };

  // Activity feed
  const eventTypeMap: Record<string, string> = {
    booking_completed:      'booking',
    conversation_started:   'lead_created',
    lead_qualified:         'status_change',
    message_received:       'lead_created',
    follow_up_sent:         'status_change',
  };

  const activity = activityRes.rows.map((r) => ({
    id:        r.id,
    type:      eventTypeMap[r.event_type] ?? 'status_change',
    text:      buildActivityText(r.event_type, r.metadata),
    timestamp: r.created_at,
  }));

  res.json({ revenue, funnel, aiPerformance, activity });
}

/**
 * GET /api/analytics/dashboard
 * Returns AnalyticsDashboardDTO — detailed analytics for the analytics page.
 * Query params: ?period=7d|30d|90d (default 7d)
 */
export async function getAnalyticsDashboard(req: AuthenticatedRequest, res: Response): Promise<void> {
  const aid = accountId(req);

  const periodParam = (req.query.period as string) ?? '7d';
  const periodDays = periodParam === '90d' ? 90 : periodParam === '30d' ? 30 : 7;
  const interval = `${periodDays} days`;

  const [
    statsRes,
    aiPerfRes,
    funnelRes,
    activityRes,
    intentRes,
    channelRes,
  ] = await Promise.all([
    // 1. Stats: total leads, active conversations, messages in period, AI responses in period
    queryOne<{
      total_leads: string;
      active_conversations: string;
      messages_count: string;
      ai_responses: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM leads l LEFT JOIN agents a ON l.agent_id = a.id
          WHERE l.deleted_at IS NULL AND ($1::uuid IS NULL OR a.account_id = $1)) AS total_leads,
         (SELECT COUNT(*) FROM conversations c JOIN leads l ON c.lead_id = l.id AND l.deleted_at IS NULL
          LEFT JOIN agents a ON l.agent_id = a.id
          WHERE c.status = 'active'
            AND ($1::uuid IS NULL OR a.account_id = $1)) AS active_conversations,
         (SELECT COUNT(*) FROM messages m JOIN leads l ON m.lead_id = l.id AND l.deleted_at IS NULL
          LEFT JOIN agents a ON l.agent_id = a.id
          WHERE m.created_at > NOW() - $2::interval
            AND ($1::uuid IS NULL OR a.account_id = $1)) AS messages_count,
         (SELECT COUNT(*) FROM messages m JOIN leads l ON m.lead_id = l.id AND l.deleted_at IS NULL
          LEFT JOIN agents a ON l.agent_id = a.id
          WHERE m.role = 'bot'
            AND m.created_at > NOW() - $2::interval
            AND ($1::uuid IS NULL OR a.account_id = $1)) AS ai_responses`,
      [aid, interval],
    ),

    // 2. AI performance: avg latency, avg tokens, total cost, fallback rate
    queryOne<{
      avg_latency: string;
      avg_tokens: string;
      total_cost: string;
      total_telemetry: string;
      fallback_count: string;
    }>(
      `SELECT
         COALESCE(AVG(t.latency_ms), 0) AS avg_latency,
         COALESCE(AVG(t.total_tokens), 0) AS avg_tokens,
         COALESCE(SUM(t.cost_usd), 0) AS total_cost,
         COUNT(*) AS total_telemetry,
         COUNT(*) FILTER (WHERE COALESCE(t.is_fallback, false)) AS fallback_count
       FROM ai_telemetry t
       JOIN leads l ON t.lead_id = l.id AND l.deleted_at IS NULL
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE t.created_at > NOW() - $2::interval
         AND ($1::uuid IS NULL OR a.account_id = $1)`,
      [aid, interval],
    ),

    // 3. Lead funnel: count by status
    query<{ status: string; count: string }>(
      `SELECT l.status, COUNT(*) AS count
       FROM leads l
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE l.deleted_at IS NULL AND ($1::uuid IS NULL OR a.account_id = $1)
       GROUP BY l.status
       ORDER BY CASE l.status
         WHEN 'new' THEN 1
         WHEN 'qualified' THEN 2
         WHEN 'considering' THEN 3
         WHEN 'hesitant' THEN 4
         WHEN 'ready_to_book' THEN 5
         WHEN 'booked' THEN 6
         WHEN 'lost' THEN 7
         ELSE 8
       END`,
      [aid],
    ),

    // 4. Messages per day over period
    query<{ date: string; count: string }>(
      `SELECT DATE(m.created_at)::text AS date, COUNT(*) AS count
       FROM messages m
       JOIN leads l ON m.lead_id = l.id AND l.deleted_at IS NULL
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE m.created_at > NOW() - $2::interval
         AND ($1::uuid IS NULL OR a.account_id = $1)
       GROUP BY DATE(m.created_at)
       ORDER BY date`,
      [aid, interval],
    ),

    // 5. Intent distribution
    query<{ intent: string; count: string }>(
      `SELECT COALESCE(t.detected_intent, 'unknown') AS intent, COUNT(*) AS count
       FROM ai_telemetry t
       JOIN leads l ON t.lead_id = l.id AND l.deleted_at IS NULL
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE t.created_at > NOW() - $2::interval
         AND ($1::uuid IS NULL OR a.account_id = $1)
       GROUP BY t.detected_intent
       ORDER BY count DESC`,
      [aid, interval],
    ),

    // 6. Channel distribution
    query<{ channel: string; count: string }>(
      `SELECT COALESCE(c.channel, 'whatsapp') AS channel, COUNT(*) AS count
       FROM conversations c
       JOIN leads l ON c.lead_id = l.id AND l.deleted_at IS NULL
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE ($1::uuid IS NULL OR a.account_id = $1)
       GROUP BY c.channel`,
      [aid],
    ),
  ]);

  // Build stats
  const stats = {
    totalLeads:           parseInt(statsRes?.total_leads ?? '0', 10),
    activeConversations:  parseInt(statsRes?.active_conversations ?? '0', 10),
    messagesInPeriod:     parseInt(statsRes?.messages_count ?? '0', 10),
    aiResponsesInPeriod:  parseInt(statsRes?.ai_responses ?? '0', 10),
  };

  // Build AI performance
  const totalTelemetry = parseInt(aiPerfRes?.total_telemetry ?? '0', 10);
  const fallbackCount  = parseInt(aiPerfRes?.fallback_count ?? '0', 10);
  const aiPerformance = {
    avgLatencyMs:    Math.round(parseFloat(aiPerfRes?.avg_latency ?? '0')),
    avgTokens:       Math.round(parseFloat(aiPerfRes?.avg_tokens ?? '0')),
    totalCostUsd:    parseFloat(parseFloat(aiPerfRes?.total_cost ?? '0').toFixed(4)),
    fallbackRate:    totalTelemetry > 0 ? parseFloat((fallbackCount / totalTelemetry).toFixed(4)) : 0,
  };

  // Build funnel
  const funnel = funnelRes.rows.map((r) => ({
    status: r.status,
    count:  parseInt(r.count, 10),
  }));

  // Build messages per day (fill missing days)
  const activityMap = new Map<string, number>();
  for (const r of activityRes.rows) {
    activityMap.set(r.date.slice(0, 10), parseInt(r.count, 10));
  }
  const messagesPerDay: Array<{ date: string; count: number }> = [];
  for (let i = periodDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    messagesPerDay.push({ date: key, count: activityMap.get(key) ?? 0 });
  }

  // Build intent distribution
  const intentDistribution = intentRes.rows.map((r) => ({
    intent: r.intent,
    count:  parseInt(r.count, 10),
  }));

  // Build channel distribution
  const channelDistribution = channelRes.rows.map((r) => ({
    channel: r.channel,
    count:   parseInt(r.count, 10),
  }));

  res.json({
    period: periodParam,
    stats,
    aiPerformance,
    funnel,
    messagesPerDay,
    intentDistribution,
    channelDistribution,
  });
}

function buildActivityText(eventType: string, meta: Record<string, unknown> | null): string {
  const name = (meta?.name as string) ?? (meta?.phone as string) ?? 'A lead';
  switch (eventType) {
    case 'booking_completed':    return `${name} booked a trial lesson`;
    case 'conversation_started': return `New conversation started with ${name}`;
    case 'lead_qualified':       return `${name} was qualified`;
    case 'follow_up_sent':       return `Follow-up sent to ${name}`;
    case 'message_received':     return `New message from ${name}`;
    default:                     return `${eventType.replace(/_/g, ' ')}`;
  }
}

// ============================================================================
// SETTINGS
// ============================================================================

/**
 * GET /api/settings
 * Returns AISettingsDTO
 */
export async function getSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  const aid = accountId(req);

  const [settingsRow, docsRes] = await Promise.all([
    queryOne<{ profile: unknown; behavior: unknown; last_saved_at: string }>(
      `SELECT profile, behavior, last_saved_at FROM settings WHERE account_id = $1`,
      [aid],
    ),
    query<{ id: string; name: string; type: string; size_bytes: string; uploaded_at: string; status: string }>(
      `SELECT id, name, type, size_bytes, uploaded_at, status
       FROM knowledge_documents WHERE account_id = $1 ORDER BY uploaded_at DESC`,
      [aid],
    ),
  ]);

  if (!settingsRow) {
    // Auto-create default settings
    await query(
      `INSERT INTO settings (account_id, profile, behavior) VALUES ($1, '{}', '{}') ON CONFLICT DO NOTHING`,
      [aid],
    );
    res.json({
      profile:     { id: aid, companyName: '', ownerName: '', email: '', phone: '', timezone: 'Asia/Jerusalem' },
      behavior:    { tone: 'friendly', strictness: 50, systemPrompt: '' },
      knowledge:   [],
      lastSavedAt: new Date().toISOString(),
    });
    return;
  }

  res.json({
    profile:     settingsRow.profile,
    behavior:    settingsRow.behavior,
    knowledge:   docsRes.rows.map((d) => ({
      id:         d.id,
      name:       d.name,
      type:       d.type,
      sizeBytes:  parseInt(d.size_bytes, 10),
      uploadedAt: d.uploaded_at,
      status:     d.status,
    })),
    lastSavedAt: settingsRow.last_saved_at,
  });
}

/**
 * PATCH /api/settings
 * Body: UpdateAISettingsDTO — { profile?: Partial<AccountProfileDTO>, behavior?: Partial<AIBehaviorDTO> }
 * Returns AISettingsDTO
 */
export async function updateSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  const aid  = accountId(req);
  const body = req.body as { profile?: Record<string, unknown>; behavior?: Record<string, unknown> };

  // Capture before state for audit
  const beforeSettings = await queryOne<{ profile: unknown; behavior: unknown }>(
    `SELECT profile, behavior FROM settings WHERE account_id = $1`,
    [aid],
  );

  const sets: string[]  = ['last_saved_at = NOW()', 'updated_at = NOW()'];
  const params: unknown[] = [];
  let pi = 1;

  if (body.profile) {
    // Merge with existing profile
    sets.push(`profile = profile || $${pi}::jsonb`);
    params.push(JSON.stringify(body.profile));
    pi++;
  }
  if (body.behavior) {
    sets.push(`behavior = behavior || $${pi}::jsonb`);
    params.push(JSON.stringify(body.behavior));
    pi++;
  }

  if (sets.length === 2 && !body.profile && !body.behavior) {
    res.status(400).json({ code: 'NO_FIELDS', message: 'No fields to update' }); return;
  }

  params.push(aid);

  await query(
    `INSERT INTO settings (account_id, profile, behavior)
     VALUES ($${pi}, COALESCE($1::jsonb, '{}'), COALESCE($2::jsonb, '{}'))
     ON CONFLICT (account_id) DO UPDATE SET ${sets.join(', ')}`,
    params,
  ).catch(async () => {
    // Simpler upsert fallback
    await query(`UPDATE settings SET ${sets.join(', ')} WHERE account_id = $${pi}`, params);
  });

  // Audit — fire and forget
  logAudit({
    accountId: aid,
    userId: req.user?.id,
    action: 'settings.updated',
    entityType: 'settings',
    entityId: aid,
    beforeData: beforeSettings ? { profile: beforeSettings.profile, behavior: beforeSettings.behavior } as Record<string, unknown> : undefined,
    afterData: { profile: body.profile, behavior: body.behavior },
  });

  // Fetch and return updated settings
  await getSettings(req, res);
}

/**
 * POST /api/settings/knowledge
 * Multipart file upload (simplified — stores metadata only, no actual file storage in MVP)
 */
export async function uploadKnowledgeDocument(req: AuthenticatedRequest, res: Response): Promise<void> {
  const aid = accountId(req);

  // In production this would use multer + S3/local storage
  // For MVP, accept JSON body with file metadata (file input from FormData field)
  const file = (req as unknown as Record<string, unknown>).file as { originalname?: string; size?: number; mimetype?: string } | undefined;
  const name = (file?.originalname ?? req.body?.name ?? 'document') as string;
  const size = (file?.size ?? req.body?.size ?? 0) as number;

  const ext  = name.split('.').pop()?.toLowerCase() ?? 'txt';
  const type = ['pdf', 'docx', 'txt'].includes(ext) ? ext : 'txt';

  const doc = await queryOne<{ id: string; name: string; type: string; size_bytes: string; uploaded_at: string; status: string }>(
    `INSERT INTO knowledge_documents (account_id, name, type, size_bytes, status)
     VALUES ($1, $2, $3, $4, 'ready')
     RETURNING id, name, type, size_bytes, uploaded_at, status`,
    [aid, name, type, size],
  );

  if (!doc) { res.status(500).json({ code: 'DB_ERROR', message: 'Failed to save document' }); return; }

  res.status(201).json({
    id:         doc.id,
    name:       doc.name,
    type:       doc.type,
    sizeBytes:  parseInt(doc.size_bytes, 10),
    uploadedAt: doc.uploaded_at,
    status:     doc.status,
  });

  // Audit — fire and forget
  logAudit({
    accountId: aid,
    userId: req.user?.id,
    action: 'knowledge.created',
    entityType: 'knowledge',
    entityId: doc.id,
    afterData: { name: doc.name, type: doc.type, sizeBytes: parseInt(doc.size_bytes, 10) },
  });
}

/**
 * DELETE /api/settings/knowledge/:id
 */
export async function deleteKnowledgeDocument(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;
  if (!isValidUUID(id)) { res.status(400).json({ code: 'INVALID_ID', message: 'Invalid document ID' }); return; }

  const aid = accountId(req);

  // Capture before state for audit
  const beforeDoc = await queryOne<Record<string, unknown>>(
    `SELECT id, name, type, size_bytes, status FROM knowledge_documents WHERE id = $1 AND account_id = $2`,
    [id, aid],
  );

  const result = await queryOne<{ id: string }>(
    `DELETE FROM knowledge_documents WHERE id = $1 AND account_id = $2 RETURNING id`,
    [id, aid],
  );

  if (!result) { res.status(404).json({ code: 'NOT_FOUND', message: 'Document not found' }); return; }
  res.status(204).end();

  // Audit — fire and forget
  logAudit({
    accountId: aid,
    userId: req.user?.id,
    action: 'knowledge.deleted',
    entityType: 'knowledge',
    entityId: id,
    beforeData: beforeDoc ?? undefined,
  });
}

logger.debug('CRM controller loaded');
