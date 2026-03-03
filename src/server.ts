/**
 * Ask ROIE Bot - Express Server
 *
 * WhatsApp AI Sales Agent for Ask ROIE tutoring service.
 *
 * @description Main entry point for the Express server.
 * Handles WhatsApp webhooks, admin endpoints, and health checks.
 */

import { IncomingMessage, ServerResponse } from 'node:http';
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import config from './config/index.js';
import logger from './utils/logger.js';
import { connectDatabase, disconnectDatabase, checkDatabaseHealth } from './database/connection.js';
import { requestLoggerWithSkip } from './api/middleware/request-logger.js';
import { errorHandler, notFoundHandler } from './api/middleware/error-handler.js';

// ============================================================================
// Express App Setup
// ============================================================================

const app: Express = express();

// ============================================================================
// Request ID (must be FIRST middleware)
// ============================================================================

import { requestIdMiddleware } from './api/middleware/request-id.js';
app.use(requestIdMiddleware);

// ============================================================================
// Security Middleware
// ============================================================================

// CORS configuration
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({
  origin: config.server.isDevelopment
    ? '*'
    : corsOrigin
      ? corsOrigin.split(',').map((o) => o.trim())
      : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
  credentials: true,
}));

// Security headers
app.use(helmet({
  // Disable contentSecurityPolicy for webhook compatibility
  contentSecurityPolicy: false,
}));

// ============================================================================
// Body Parsing
// ============================================================================

// JSON body parser with size limit
// The verify callback captures the raw body buffer for webhook signature verification (HMAC-SHA256)
app.use(express.json({
  limit: '1mb',
  strict: true,
  verify: (req: IncomingMessage, _res: ServerResponse, buf: Buffer) => {
    (req as unknown as Request).rawBody = buf;
  },
}));

// URL-encoded body parser (for form data)
app.use(express.urlencoded({
  extended: true,
  limit: '1mb',
}));

// Cookie parser for refresh token cookies
app.use(cookieParser());

// ============================================================================
// Request Logging
// ============================================================================

// Log all requests except health checks
app.use(requestLoggerWithSkip(['/health', '/health/live', '/health/ready']));

// ============================================================================
// Health Check Routes
// ============================================================================

// Basic health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Liveness probe (is the process running?)
app.get('/health/live', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Readiness probe (can we serve traffic?)
app.get('/health/ready', async (_req: Request, res: Response) => {
  const health = await checkDatabaseHealth();
  const isHealthy = health.postgres.connected && health.redis.connected;

  if (isHealthy) {
    res.json({
      status: 'ready',
      postgres: 'connected',
      redis: 'connected',
    });
  } else {
    res.status(503).json({
      status: 'not ready',
      postgres: health.postgres.connected ? 'connected' : 'disconnected',
      redis: health.redis.connected ? 'connected' : 'disconnected',
    });
  }
});

// ============================================================================
// API Routes
// ============================================================================

import { attachWebSocketServer } from './realtime/ws-server.js';
import whatsappRoutes from './api/routes/whatsapp.routes.js';
import telegramRoutes from './api/routes/telegram.routes.js';
import adminRoutes from './api/routes/admin.routes.js';
import authRoutes from './api/routes/auth.routes.js';
import crmRoutes from './api/routes/crm.routes.js';
import dashboardRoutes from './api/routes/dashboard.routes.js';
import analyticsRoutes from './api/routes/analytics.routes.js';
import conversationsRoutes from './api/routes/conversations.routes.js';
import alertsRoutes from './api/routes/alerts.routes.js';
import telemetryRoutes from './api/routes/telemetry.routes.js';
import { adminAuth } from './api/middleware/auth.js';

// WhatsApp webhook routes
app.use('/webhook/whatsapp', whatsappRoutes);

// Telegram webhook routes
app.use('/webhook/telegram', telegramRoutes);

// Admin routes (protected with Basic Auth)
app.use('/admin', adminAuth, adminRoutes);

// Dashboard API routes (JWT auth)
app.use('/api/auth', authRoutes);

// CRM routes — DTO-aligned, mounted FIRST to take precedence over legacy routes
app.use('/api', crmRoutes);

// Legacy dashboard/analytics/conversations routes (kept for backwards compat)
app.use('/api', dashboardRoutes);
app.use('/api', analyticsRoutes);
app.use('/api', conversationsRoutes);
app.use('/api', alertsRoutes);
app.use('/api/telemetry', telemetryRoutes);

// Placeholder root route
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Ask ROIE Bot',
    version: '1.0.0',
    description: 'WhatsApp & Telegram AI Sales Agent',
    endpoints: {
      health: '/health',
      webhooks: {
        whatsapp: '/webhook/whatsapp',
        telegram: '/webhook/telegram',
      },
      admin: '/admin',
    },
  });
});

// ============================================================================
// Error Handling
// ============================================================================

// 404 handler (must be after all routes)
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// ============================================================================
// Server Instance
// ============================================================================

let server: ReturnType<typeof app.listen> | null = null;

/**
 * Start the server
 */
async function startServer(): Promise<void> {
  try {
    // Production guard: require Telegram webhook secret
    if (config.server.isProduction && config.telegram.enabled && !config.telegram.webhookSecret) {
      logger.error('FATAL: TELEGRAM_WEBHOOK_SECRET not set in production. Exiting.');
      process.exit(1);
    }

    // Connect to database
    logger.info('Connecting to database...');
    await connectDatabase();
    logger.info('Database connected');

    // Start HTTP server
    const PORT = config.server.port;
    const HOST = '0.0.0.0'; // Critical for Railway/Docker!

    server = app.listen(PORT, HOST, () => {
      logger.info('Server started', {
        port: PORT,
        host: HOST,
        env: config.server.nodeEnv,
        nodeVersion: process.version,
      });
      // Attach WebSocket server for realtime dashboard events
      attachWebSocketServer(server!);
    });

    // Handle server errors
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
        process.exit(1);
      }
      throw error;
    });

  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

/**
 * Gracefully shutdown the server
 */
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, starting graceful shutdown...`);

  // Set a timeout for shutdown
  const shutdownTimeout = setTimeout(() => {
    logger.error('Shutdown timeout, forcing exit');
    process.exit(1);
  }, 30000); // 30 second timeout

  try {
    // Stop accepting new connections
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      logger.info('HTTP server closed');
    }

    // Close database connections
    await disconnectDatabase();
    logger.info('Database connections closed');

    // Clear timeout and exit
    clearTimeout(shutdownTimeout);
    logger.info('Graceful shutdown complete');
    process.exit(0);

  } catch (error) {
    logger.error('Error during shutdown', { error });
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

// ============================================================================
// Signal Handlers
// ============================================================================

// Handle SIGTERM (docker stop, kubernetes)
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
  gracefulShutdown('unhandledRejection');
});

// ============================================================================
// Start Server
// ============================================================================

startServer();

// ============================================================================
// Exports (for testing)
// ============================================================================

export { app, server };
export default app;
