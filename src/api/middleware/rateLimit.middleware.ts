/**
 * Rate Limiting Middleware
 *
 * In-memory rate limiter for API protection.
 * For production, consider using Redis-based solution.
 */

import { Request, Response, NextFunction } from 'express';
import logger from '../../utils/logger.js';
import type { AuthenticatedRequest } from './auth.middleware.js';

// ============================================================================
// Types
// ============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;       // Time window in milliseconds
  maxRequests: number;    // Max requests per window
  keyGenerator?: (req: Request) => string;
  skipFailedRequests?: boolean;
  message?: string;
}

// ============================================================================
// In-Memory Store
// ============================================================================

const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ============================================================================
// Rate Limiter Factory
// ============================================================================

/**
 * Create rate limiting middleware
 */
export function createRateLimiter(options: RateLimitOptions) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = defaultKeyGenerator,
    message = 'Too many requests, please try again later',
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGenerator(req);
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    // Create new entry if doesn't exist or window expired
    if (!entry || entry.resetAt < now) {
      entry = {
        count: 0,
        resetAt: now + windowMs,
      };
      rateLimitStore.set(key, entry);
    }

    // Increment count
    entry.count++;

    // Set rate limit headers
    const remaining = Math.max(0, maxRequests - entry.count);
    const resetTime = Math.ceil(entry.resetAt / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetTime);

    // Check if over limit
    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);

      logger.warn('Rate limit exceeded', {
        key,
        count: entry.count,
        limit: maxRequests,
        retryAfter,
      });

      res.status(429).json({
        error: 'Too Many Requests',
        message,
        retryAfter,
      });
      return;
    }

    next();
  };
}

// ============================================================================
// Key Generators
// ============================================================================

/**
 * Default key generator - uses IP address
 */
function defaultKeyGenerator(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

/**
 * User-based key generator - uses authenticated user ID
 */
export function userKeyGenerator(req: Request): string {
  const authReq = req as AuthenticatedRequest;
  if (authReq.user?.id) {
    return `user:${authReq.user.id}`;
  }
  return defaultKeyGenerator(req);
}

/**
 * Account-based key generator - uses account ID
 */
export function accountKeyGenerator(req: Request): string {
  const authReq = req as AuthenticatedRequest;
  if (authReq.user?.accountId) {
    return `account:${authReq.user.accountId}`;
  }
  return defaultKeyGenerator(req);
}

// ============================================================================
// Pre-configured Limiters
// ============================================================================

/**
 * Dashboard API rate limiter
 * 100 requests per 15 minutes per user
 */
export const dashboardRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100,
  keyGenerator: userKeyGenerator,
  message: 'Dashboard API rate limit exceeded. Please wait before making more requests.',
});

/**
 * Strict rate limiter for write operations
 * 20 requests per minute per user
 */
export const writeRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 20,
  keyGenerator: userKeyGenerator,
  message: 'Write operation rate limit exceeded.',
});

/**
 * Auth rate limiter
 * 10 attempts per 15 minutes per IP
 */
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,
  keyGenerator: defaultKeyGenerator,
  message: 'Too many authentication attempts.',
});
