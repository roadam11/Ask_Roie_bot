/**
 * Winston Logger Configuration
 *
 * Provides structured logging with different formats for
 * development (pretty, colored) and production (JSON).
 *
 * @example
 * import logger from './utils/logger.js';
 * logger.info('Server started', { port: 3000 });
 * logger.error('Database connection failed', { error: err });
 */

import winston from 'winston';
import config from '../config/index.js';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

// ============================================================================
// Custom Formats
// ============================================================================

/**
 * Development format: colored, human-readable
 * Example: 2024-01-15 10:30:45 [INFO]: Server started { port: 3000 }
 */
const devFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;

  // Append metadata if present
  if (Object.keys(metadata).length > 0) {
    // Handle error objects specially
    if (metadata.error instanceof Error) {
      metadata.error = {
        message: metadata.error.message,
        stack: metadata.error.stack,
      };
    }
    msg += ` ${JSON.stringify(metadata, null, 2)}`;
  }

  return msg;
});

/**
 * Production format: JSON for structured logging
 */
const prodFormat = combine(
  timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  errors({ stack: true }),
  json()
);

/**
 * Development format: pretty and colored
 */
const developmentFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  devFormat
);

// ============================================================================
// Transports
// ============================================================================

/**
 * Console transport - always enabled
 */
const consoleTransport = new winston.transports.Console({
  format: config.server.isProduction ? prodFormat : developmentFormat,
});

/**
 * File transport for errors only
 */
const errorFileTransport = new winston.transports.File({
  filename: 'logs/error.log',
  level: 'error',
  format: combine(
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    errors({ stack: true }),
    json()
  ),
  maxsize: 5 * 1024 * 1024, // 5MB
  maxFiles: 5,
});

/**
 * File transport for all logs
 */
const combinedFileTransport = new winston.transports.File({
  filename: 'logs/combined.log',
  format: combine(
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    errors({ stack: true }),
    json()
  ),
  maxsize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
});

// ============================================================================
// Logger Instance
// ============================================================================

/**
 * Main logger instance
 */
const logger = winston.createLogger({
  level: config.logging.level,
  levels: winston.config.npm.levels,
  defaultMeta: {
    service: 'ask-roie-bot',
  },
  transports: [
    consoleTransport,
    // Only add file transports in production or if explicitly enabled
    ...(config.server.isProduction
      ? [errorFileTransport, combinedFileTransport]
      : []),
  ],
  // Don't exit on handled exceptions
  exitOnError: false,
});

// ============================================================================
// Development: Add file transports if logs directory exists
// ============================================================================

if (config.server.isDevelopment) {
  // In development, optionally log to files too
  // Uncomment if you want file logging in dev:
  // logger.add(errorFileTransport);
  // logger.add(combinedFileTransport);
}

// ============================================================================
// Helper Methods
// ============================================================================

/**
 * Log an HTTP request
 */
export function logRequest(
  method: string,
  path: string,
  statusCode: number,
  duration: number,
  metadata?: Record<string, unknown>
): void {
  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

  logger.log(level, `${method} ${path} ${statusCode}`, {
    method,
    path,
    statusCode,
    duration: `${duration}ms`,
    ...metadata,
  });
}

/**
 * Log a WhatsApp event
 */
export function logWhatsApp(
  event: string,
  phoneNumber: string,
  metadata?: Record<string, unknown>
): void {
  logger.info(`WhatsApp: ${event}`, {
    channel: 'whatsapp',
    phoneNumber: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
    ...metadata,
  });
}

/**
 * Log a Claude API call
 */
export function logClaude(
  action: string,
  tokens?: { input: number; output: number },
  metadata?: Record<string, unknown>
): void {
  logger.info(`Claude: ${action}`, {
    service: 'claude',
    tokens,
    ...metadata,
  });
}

/**
 * Log a database operation
 */
export function logDatabase(
  operation: string,
  table: string,
  duration?: number,
  metadata?: Record<string, unknown>
): void {
  logger.debug(`DB: ${operation} on ${table}`, {
    database: true,
    operation,
    table,
    duration: duration ? `${duration}ms` : undefined,
    ...metadata,
  });
}

/**
 * Create a child logger with additional default metadata
 */
export function createChildLogger(metadata: Record<string, unknown>): winston.Logger {
  return logger.child(metadata);
}

// ============================================================================
// Export
// ============================================================================

export default logger;
