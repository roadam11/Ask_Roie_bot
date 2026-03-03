/**
 * Realtime Event Emitter
 *
 * Typed emitter functions that broadcast WebSocket events to connected
 * dashboard clients. Events match the SocketEventMap defined in the frontend:
 *   admin-dashboard/src/lib/realtime/socket.ts
 *
 * TENANT ISOLATION: accountId is REQUIRED on all emitter functions.
 * broadcast() only sends to WebSocket clients whose accountId matches.
 * TypeScript enforces this — missing accountId = compile error.
 *
 * Protocol: JSON frames — { type: string; payload: unknown }
 */

import { WebSocketServer, WebSocket } from 'ws';
import logger from '../utils/logger.js';
import { queryOne } from '../database/connection.js';

// ── Event payload types (mirror frontend SocketEventMap) ───────────────────────

export interface LeadUpdatedPayload    { id: string }
export interface LeadCreatedPayload    { id: string }
export interface MessageNewPayload     { conversationId: string; messageId: string }
export interface ConversationUpdatedPayload { id: string; status: 'open' | 'resolved' | 'flagged' }
export type OverviewRefreshPayload = Record<string, never>

// ── Tenant resolver ────────────────────────────────────────────────────────────

/**
 * Resolve accountId for a lead via: leads.agent_id → agents.account_id
 * Used by webhook controllers (WhatsApp/Telegram) that don't have JWT context.
 * Returns null if lead has no agent or is not found.
 */
export async function getAccountIdByLeadId(leadId: string): Promise<string | null> {
  const row = await queryOne<{ account_id: string }>(
    `SELECT a.account_id FROM agents a JOIN leads l ON l.agent_id = a.id WHERE l.id = $1`,
    [leadId],
  );
  return row?.account_id ?? null;
}

// ── Frame builder ──────────────────────────────────────────────────────────────

/**
 * Broadcast a frame to all connected clients belonging to a specific account.
 * accountId is REQUIRED — TypeScript enforces tenant isolation at compile time.
 */
function broadcast(wss: WebSocketServer, type: string, payload: unknown, accountId: string): void {
  const frame = JSON.stringify({ type, payload });
  let sent = 0;
  wss.clients.forEach((client: any) => {
    if (client.readyState === WebSocket.OPEN) {
      if (client.accountId !== accountId) return;
      client.send(frame);
      sent++;
    }
  });
  logger.debug('Realtime broadcast', { type, accountId, clients: sent });
}

// ── Typed emitter functions ────────────────────────────────────────────────────

export function emitLeadCreated(wss: WebSocketServer, leadId: string, accountId: string): void {
  broadcast(wss, 'lead:created', { id: leadId } satisfies LeadCreatedPayload, accountId);
}

export function emitLeadUpdated(wss: WebSocketServer, leadId: string, accountId: string): void {
  broadcast(wss, 'lead:updated', { id: leadId } satisfies LeadUpdatedPayload, accountId);
}

export function emitMessageNew(
  wss: WebSocketServer,
  conversationId: string,
  messageId: string,
  accountId: string,
): void {
  broadcast(wss, 'message:new', { conversationId, messageId } satisfies MessageNewPayload, accountId);
}

export function emitConversationUpdated(
  wss: WebSocketServer,
  conversationId: string,
  status: 'open' | 'resolved' | 'flagged',
  accountId: string,
): void {
  broadcast(wss, 'conversation:updated', { id: conversationId, status } satisfies ConversationUpdatedPayload, accountId);
}

export function emitOverviewRefresh(wss: WebSocketServer, accountId: string): void {
  broadcast(wss, 'overview:refresh', {} satisfies OverviewRefreshPayload, accountId);
}
