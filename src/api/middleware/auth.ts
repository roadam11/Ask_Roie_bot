/**
 * Authentication Middleware
 *
 * Provides authentication for admin endpoints.
 */

import { Request, Response, NextFunction } from 'express';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';
import { UnauthorizedError } from './error-handler.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Extended request with auth info
 */
export interface AuthenticatedRequest extends Request {
  admin?: {
    username: string;
    authenticatedAt: Date;
  };
}

// ============================================================================
// Admin Authentication
// ============================================================================

/**
 * Admin authentication middleware using Basic Auth
 *
 * Expects Authorization header: Basic base64(username:password)
 * Compares against config.admin.username and config.admin.password
 *
 * @example
 * // In routes
 * app.use('/admin', adminAuth, adminRoutes);
 */
export function adminAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedError('Missing Authorization header');
    }

    // Check for Basic auth
    if (!authHeader.startsWith('Basic ')) {
      throw new UnauthorizedError('Invalid authorization scheme. Use Basic auth');
    }

    // Decode base64 credentials
    const base64Credentials = authHeader.slice(6);
    let credentials: string;

    try {
      credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    } catch {
      throw new UnauthorizedError('Invalid credentials format');
    }

    const [username, password] = credentials.split(':');

    if (!username || !password) {
      throw new UnauthorizedError('Invalid credentials format');
    }

    // Validate credentials
    const validUsername = config.admin.username;
    const validPassword = config.admin.password;

    // Constant-time comparison to prevent timing attacks
    const usernameValid = safeCompare(username, validUsername);
    const passwordValid = safeCompare(password, validPassword);

    if (!usernameValid || !passwordValid) {
      logger.warn('Admin auth failed', {
        username,
        ip: req.ip,
        path: req.path,
      });
      throw new UnauthorizedError('Invalid credentials');
    }

    // Attach admin info to request
    req.admin = {
      username,
      authenticatedAt: new Date(),
    };

    logger.debug('Admin authenticated', {
      username,
      ip: req.ip,
      path: req.path,
    });

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * API Key authentication middleware
 *
 * Expects X-API-Key header
 * Compares against config.admin.password
 *
 * @example
 * // In routes
 * app.use('/api', apiKeyAuth, apiRoutes);
 */
export function apiKeyAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  try {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey || typeof apiKey !== 'string') {
      throw new UnauthorizedError('Missing X-API-Key header');
    }

    // Constant-time comparison
    if (!safeCompare(apiKey, config.admin.password)) {
      logger.warn('API key auth failed', {
        ip: req.ip,
        path: req.path,
      });
      throw new UnauthorizedError('Invalid API key');
    }

    // Attach admin info
    req.admin = {
      username: 'api-key-user',
      authenticatedAt: new Date(),
    };

    logger.debug('API key authenticated', {
      ip: req.ip,
      path: req.path,
    });

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Optional auth middleware
 *
 * Attempts authentication but doesn't fail if missing
 * Useful for endpoints that behave differently for authenticated users
 */
export function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];

  if (!authHeader && !apiKey) {
    // No auth provided, continue without
    return next();
  }

  // Try API key first
  if (apiKey && typeof apiKey === 'string') {
    if (safeCompare(apiKey, config.admin.password)) {
      req.admin = {
        username: 'api-key-user',
        authenticatedAt: new Date(),
      };
    }
    return next();
  }

  // Try Basic auth
  if (authHeader?.startsWith('Basic ')) {
    try {
      const base64Credentials = authHeader.slice(6);
      const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
      const [username, password] = credentials.split(':');

      if (username && password) {
        const usernameValid = safeCompare(username, config.admin.username);
        const passwordValid = safeCompare(password, config.admin.password);

        if (usernameValid && passwordValid) {
          req.admin = {
            username,
            authenticatedAt: new Date(),
          };
        }
      }
    } catch {
      // Ignore auth errors in optional mode
    }
  }

  next();
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Constant-time string comparison to prevent timing attacks
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do comparison to maintain constant time
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i % b.length);
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

// ============================================================================
// Exports
// ============================================================================

export default adminAuth;
