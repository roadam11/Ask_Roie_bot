/**
 * Error Handler Middleware
 *
 * Centralized error handling for Express.
 * Logs errors and returns appropriate JSON responses.
 */

import { Request, Response, NextFunction } from 'express';
import logger from '../../utils/logger.js';

// ============================================================================
// Custom Error Classes
// ============================================================================

/**
 * Base application error
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends AppError {
  public readonly errors: Record<string, string>;

  constructor(message: string, errors: Record<string, string> = {}) {
    super(message, 400);
    this.errors = errors;
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
  }
}

/**
 * Unauthorized error (401)
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

/**
 * Forbidden error (403)
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409);
  }
}

/**
 * Rate limit error (429)
 */
export class RateLimitError extends AppError {
  public readonly retryAfter: number;

  constructor(retryAfter = 60) {
    super('Too many requests', 429);
    this.retryAfter = retryAfter;
  }
}

// ============================================================================
// Error Response Interface
// ============================================================================

interface ErrorResponse {
  error: {
    message: string;
    code?: string;
    errors?: Record<string, string>;
    retryAfter?: number;
  };
  success: false;
}

// ============================================================================
// Error Handler Middleware
// ============================================================================

/**
 * Express error handling middleware
 * Must be added after all routes
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Default values
  let statusCode = 500;
  let message = 'Internal server error';
  let errors: Record<string, string> | undefined;
  let retryAfter: number | undefined;
  let isOperational = false;

  // Handle known error types
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    isOperational = err.isOperational;

    if (err instanceof ValidationError) {
      errors = err.errors;
    }

    if (err instanceof RateLimitError) {
      retryAfter = err.retryAfter;
      res.setHeader('Retry-After', retryAfter.toString());
    }
  } else if (err.name === 'SyntaxError' && 'body' in err) {
    // JSON parse error
    statusCode = 400;
    message = 'Invalid JSON in request body';
    isOperational = true;
  } else if (err.name === 'PayloadTooLargeError') {
    statusCode = 413;
    message = 'Request payload too large';
    isOperational = true;
  }

  // Log the error
  const logContext = {
    method: req.method,
    path: req.path,
    statusCode,
    errorName: err.name,
    errorMessage: err.message,
    isOperational,
    stack: !isOperational ? err.stack : undefined,
  };

  if (statusCode >= 500) {
    logger.error('Server error', logContext);
  } else if (statusCode >= 400) {
    logger.warn('Client error', logContext);
  }

  // Build response
  const response: ErrorResponse = {
    success: false,
    error: {
      message,
    },
  };

  if (errors && Object.keys(errors).length > 0) {
    response.error.errors = errors;
  }

  if (retryAfter) {
    response.error.retryAfter = retryAfter;
  }

  // Send response
  res.status(statusCode).json(response);
}

/**
 * 404 Not Found handler
 * Add before error handler
 */
export function notFoundHandler(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
}

/**
 * Async handler wrapper
 * Wraps async route handlers to catch errors
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ============================================================================
// Exports
// ============================================================================

export default errorHandler;
