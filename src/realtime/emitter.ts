/**
 * Realtime Event Emitter
 *
 * Typed emitter functions that broadcast WebSocket events to connected
 * dashboard clients. Events match the SocketEventMap defined in the frontend:
 *   admin-dashboard/src/lib/realtime/socket.ts
 *
 * Usage:
 *   import { emitLeadUpdated, emitMessageNew } from '../realtime/emitter.js';
 *   emitLeadUpdated(wss, leadId);
 *
 * Protocol: JSON frames — { type: string; payload: unknown }
 */

import { WebSocketServer, WebSocket } from 'ws';
import logger from '../utils/logger.js';

// ── Event payload types (mirror frontend SocketEventMap) ───────────────────────

export interface LeadUpdatedPayload    { id: string }
export interface LeadCreatedPayload    { id: string }
export interface MessageNewPayload     { conversationId: string; messageId: string }
export interface ConversationUpdatedPayload { id: string; status: 'open' | 'resolved' | 'flagged' }
export type OverviewRefreshPayload = Record<string, never>

// ── Frame builder ──────────────────────────────────────────────────────────────

function broadcast(wss: WebSocketServer, type: string, payload: unknown): void {
  const frame = JSON.stringify({ type, payload });
  let sent = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(frame);
      sent++;
    }
  });
  logger.debug('Realtime broadcast', { type, clients: sent });
}

// ── Typed emitter functions ────────────────────────────────────────────────────

export function emitLeadCreated(wss: WebSocketServer, leadId: string): void {
  broadcast(wss, 'lead:created', { id: leadId } satisfies LeadCreatedPayload);
}

export function emitLeadUpdated(wss: WebSocketServer, leadId: string): void {
  broadcast(wss, 'lead:updated', { id: leadId } satisfies LeadUpdatedPayload);
}

export function emitMessageNew(
  wss: WebSocketServer,
  conversationId: string,
  messageId: string,
): void {
  broadcast(wss, 'message:new', { conversationId, messageId } satisfies MessageNewPayload);
}

export function emitConversationUpdated(
  wss: WebSocketServer,
  conversationId: string,
  status: 'open' | 'resolved' | 'flagged',
): void {
  broadcast(wss, 'conversation:updated', { id: conversationId, status } satisfies ConversationUpdatedPayload);
}

export function emitOverviewRefresh(wss: WebSocketServer): void {
  broadcast(wss, 'overview:refresh', {} satisfies OverviewRefreshPayload);
}
