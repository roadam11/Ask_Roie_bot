/**
 * Request Logger Middleware
 *
 * Logs incoming HTTP requests with method, path, status, and duration.
 */

import { Request, Response, NextFunction } from 'express';
import { logRequest } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Extended request with timing info
 */
interface TimedRequest extends Request {
  startTime?: number;
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Request logging middleware
 *
 * Logs all incoming requests with:
 * - HTTP method
 * - Request path
 * - Response status code
 * - Duration in milliseconds
 */
export function requestLogger(
  req: TimedRequest,
  res: Response,
  next: NextFunction
): void {
  // Record start time
  req.startTime = Date.now();

  // Log when response finishes
  res.on('finish', () => {
    const duration = Date.now() - (req.startTime || Date.now());

    logRequest(
      req.method,
      req.path,
      res.statusCode,
      duration,
      {
        requestId: req.requestId,
        query: Object.keys(req.query).length > 0 ? req.query : undefined,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        contentLength: req.get('content-length'),
      }
    );
  });

  next();
}

/**
 * Skip logging for certain paths (health checks, etc.)
 */
export function requestLoggerWithSkip(
  skipPaths: string[] = ['/health', '/health/live', '/health/ready']
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: TimedRequest, res: Response, next: NextFunction): void => {
    // Skip logging for specified paths
    if (skipPaths.includes(req.path)) {
      return next();
    }

    requestLogger(req, res, next);
  };
}

// ============================================================================
// Exports
// ============================================================================

export default requestLogger;
