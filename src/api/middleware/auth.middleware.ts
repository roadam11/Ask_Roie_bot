/**
 * Authentication Middleware
 *
 * JWT-based authentication for dashboard API routes.
 * Validates tokens and attaches user info to request.
 */

import { Request, Response, NextFunction } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import logger from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface AuthUser {
  id: string;
  email: string;
  accountId: string;
  role: 'admin' | 'manager' | 'viewer';
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

// ============================================================================
// JWT Secret
// ============================================================================

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// ============================================================================
// Middleware
// ============================================================================

/**
 * Verify JWT token and attach user to request
 */
export function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({ error: 'No authorization header' });
      return;
    }

    // Check Bearer format
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Invalid authorization format. Use: Bearer <token>' });
      return;
    }

    const token = authHeader.slice(7); // Remove 'Bearer '

    if (!token) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;

    // Attach user to request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      accountId: decoded.accountId,
      role: decoded.role,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    logger.error('Authentication error', { error: (error as Error).message });
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Require specific role(s)
 */
export function requireRole(...allowedRoles: AuthUser['role'][]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: req.user.role,
      });
      return;
    }

    next();
  };
}

/**
 * Generate JWT token for user
 */
export function generateToken(user: AuthUser, expiresInSeconds: number = 86400): string {
  const options: SignOptions = { expiresIn: expiresInSeconds };
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      accountId: user.accountId,
      role: user.role,
    },
    JWT_SECRET,
    options
  );
}

/**
 * Optional authentication - doesn't fail if no token
 */
export function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = decoded;
  } catch {
    // Ignore invalid tokens for optional auth
  }

  next();
}
