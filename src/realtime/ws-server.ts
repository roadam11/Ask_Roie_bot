/**
 * WebSocket Server for Realtime Dashboard Events
 *
 * Accepts connections at ws://<host>?token=<accessToken>
 * Authenticates via the same JWT used by the REST API.
 * Clients receive JSON frames: { type: string; payload: unknown }
 *
 * Usage (in server.ts after HTTP server starts):
 *   import { attachWebSocketServer } from './realtime/ws-server.js';
 *   attachWebSocketServer(server);
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import { URL } from 'url';
import { verifyAccessToken } from '../api/middleware/auth.middleware.js';
import logger from '../utils/logger.js';

let wss: WebSocketServer | null = null;

/**
 * Attach WebSocket server to the HTTP server.
 * Returns the WebSocketServer instance so emitters can reference it.
 */
export function attachWebSocketServer(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Authenticate via query param ?token=<accessToken>
    const url   = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const user  = token ? verifyAccessToken(token) : null;

    if (!user) {
      logger.warn('WebSocket connection rejected: invalid token');
      ws.close(4001, 'Unauthorized');
      return;
    }

    logger.info('WebSocket client connected', { userId: user.id, accountId: user.accountId });

    ws.on('close', () => {
      logger.debug('WebSocket client disconnected', { userId: user.id });
    });

    ws.on('error', (err) => {
      logger.error('WebSocket client error', { error: err.message });
    });

    // Send a welcome ping so the client knows it's connected
    ws.send(JSON.stringify({ type: 'connected', payload: { userId: user.id } }));
  });

  wss.on('error', (err) => {
    logger.error('WebSocket server error', { error: err.message });
  });

  logger.info('WebSocket server attached at /ws');
  return wss;
}

/**
 * Get the active WebSocket server instance.
 * Returns null if attachWebSocketServer hasn't been called yet.
 */
export function getWebSocketServer(): WebSocketServer | null {
  return wss;
}
