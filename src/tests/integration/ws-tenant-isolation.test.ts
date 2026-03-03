/**
 * WebSocket Tenant Isolation Test
 *
 * Validates that broadcast() only sends events to clients
 * belonging to the same account (tenant isolation).
 */

import { jest, describe, it, expect } from '@jest/globals';
import { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';

// Mock logger to suppress output during tests
jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Mock database connection (getAccountIdByLeadId uses queryOne)
jest.unstable_mockModule('../../database/connection.js', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

const {
  emitLeadUpdated,
  emitOverviewRefresh,
  emitMessageNew,
} = await import('../../realtime/emitter.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockClient(accountId: string): WebSocket {
  const messages: string[] = [];
  const client = {
    readyState: WebSocket.OPEN,
    accountId,
    send: jest.fn((data: string) => messages.push(data)),
    _messages: messages,
  };
  return client as unknown as WebSocket;
}

function createMockWss(clients: WebSocket[]): WebSocketServer {
  const clientSet = new Set(clients);
  return { clients: clientSet } as unknown as WebSocketServer;
}

function getMessages(client: WebSocket): unknown[] {
  return (client as any)._messages.map((m: string) => JSON.parse(m));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WebSocket Tenant Isolation', () => {
  it('should NOT deliver events across tenants', () => {
    const clientA = createMockClient('account-a');
    const clientB = createMockClient('account-b');
    const wss = createMockWss([clientA, clientB]);

    emitLeadUpdated(wss, 'lead-1', 'account-a');

    // Client A should receive the event
    expect(getMessages(clientA)).toEqual([
      { type: 'lead:updated', payload: { id: 'lead-1' } },
    ]);

    // Client B should NOT receive the event
    expect(getMessages(clientB)).toEqual([]);
  });

  it('should deliver events to all clients of the SAME tenant', () => {
    const clientA1 = createMockClient('account-a');
    const clientA2 = createMockClient('account-a');
    const clientB = createMockClient('account-b');
    const wss = createMockWss([clientA1, clientA2, clientB]);

    emitLeadUpdated(wss, 'lead-1', 'account-a');

    // Both account-a clients should receive
    expect(getMessages(clientA1)).toEqual([
      { type: 'lead:updated', payload: { id: 'lead-1' } },
    ]);
    expect(getMessages(clientA2)).toEqual([
      { type: 'lead:updated', payload: { id: 'lead-1' } },
    ]);

    // account-b should NOT receive
    expect(getMessages(clientB)).toEqual([]);
  });

  it('should NOT send to closed connections', () => {
    const openClient = createMockClient('account-a');
    const closedClient = createMockClient('account-a');
    (closedClient as any).readyState = WebSocket.CLOSED;

    const wss = createMockWss([openClient, closedClient]);

    emitOverviewRefresh(wss, 'account-a');

    expect(getMessages(openClient)).toEqual([
      { type: 'overview:refresh', payload: {} },
    ]);
    expect((closedClient as any).send).not.toHaveBeenCalled();
  });

  it('should isolate message:new events', () => {
    const clientA = createMockClient('tenant-1');
    const clientB = createMockClient('tenant-2');
    const wss = createMockWss([clientA, clientB]);

    emitMessageNew(wss, 'conv-1', 'msg-1', 'tenant-1');

    expect(getMessages(clientA)).toEqual([
      { type: 'message:new', payload: { conversationId: 'conv-1', messageId: 'msg-1' } },
    ]);
    expect(getMessages(clientB)).toEqual([]);
  });

  it('should NOT send to clients without accountId', () => {
    const clientA = createMockClient('account-a');
    const orphan = createMockClient('account-a');
    delete (orphan as any).accountId; // simulate legacy client

    const wss = createMockWss([clientA, orphan]);

    emitLeadUpdated(wss, 'lead-1', 'account-a');

    expect(getMessages(clientA)).toHaveLength(1);
    // Orphan client should not receive (accountId !== 'account-a' since undefined)
    expect(getMessages(orphan)).toEqual([]);
  });
});
