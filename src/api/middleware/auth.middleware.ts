/**
 * Authentication Middleware
 *
 * Secure JWT-based authentication with:
 * - Access Token (15min) - returned in response body
 * - Refresh Token (30 days) - stored in httpOnly cookie
 *
 * Security features:
 * - httpOnly cookies prevent XSS token theft
 * - Short-lived access tokens minimize exposure
 * - Secure + SameSite cookies prevent CSRF
 */

import { Request, Response, NextFunction, CookieOptions } from 'express';
import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';
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

interface TokenPayload extends JwtPayload {
  id: string;
  email: string;
  accountId: string;
  role: 'admin' | 'manager' | 'viewer';
  type: 'access' | 'refresh';
}

// ============================================================================
// Configuration
// ============================================================================

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || JWT_SECRET + '-refresh';

// Token expiry times
const ACCESS_TOKEN_EXPIRY = 15 * 60; // 15 minutes in seconds
const REFRESH_TOKEN_EXPIRY = 30 * 24 * 60 * 60; // 30 days in seconds

// Cookie configuration
const REFRESH_TOKEN_COOKIE_NAME = 'refreshToken';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true, // Prevents JavaScript access (XSS protection)
  secure: IS_PRODUCTION, // HTTPS only in production
  sameSite: IS_PRODUCTION ? 'strict' : 'lax', // CSRF protection
  path: '/api/auth', // Only sent to auth endpoints
  maxAge: REFRESH_TOKEN_EXPIRY * 1000, // Convert to milliseconds
};

// ============================================================================
// Token Generation
// ============================================================================

/**
 * Generate short-lived access token (15 minutes)
 * Used for API authentication, stored in memory/localStorage
 */
export function generateAccessToken(user: AuthUser): string {
  const payload: Omit<TokenPayload, 'iat' | 'exp'> = {
    id: user.id,
    email: user.email,
    accountId: user.accountId,
    role: user.role,
    type: 'access',
  };

  const options: SignOptions = { expiresIn: ACCESS_TOKEN_EXPIRY };
  return jwt.sign(payload, JWT_SECRET, options);
}

/**
 * Generate long-lived refresh token (30 days)
 * Stored in httpOnly cookie, used to obtain new access tokens
 */
export function generateRefreshToken(user: AuthUser): string {
  const payload: Omit<TokenPayload, 'iat' | 'exp'> = {
    id: user.id,
    email: user.email,
    accountId: user.accountId,
    role: user.role,
    type: 'refresh',
  };

  const options: SignOptions = { expiresIn: REFRESH_TOKEN_EXPIRY };
  return jwt.sign(payload, JWT_REFRESH_SECRET, options);
}

/**
 * Generate both tokens for login response
 */
export function generateTokenPair(user: AuthUser): {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} {
  return {
    accessToken: generateAccessToken(user),
    refreshToken: generateRefreshToken(user),
    expiresIn: ACCESS_TOKEN_EXPIRY,
  };
}

// ============================================================================
// Cookie Management
// ============================================================================

/**
 * Set refresh token as httpOnly cookie
 */
export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, token, COOKIE_OPTIONS);
}

/**
 * Clear refresh token cookie (for logout)
 */
export function clearRefreshTokenCookie(res: Response): void {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, '', {
    ...COOKIE_OPTIONS,
    maxAge: 0,
  });
}

/**
 * Get refresh token from cookie
 */
export function getRefreshTokenFromCookie(req: Request): string | null {
  return req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] || null;
}

// ============================================================================
// Token Validation
// ============================================================================

/**
 * Verify and decode access token
 */
export function verifyAccessToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;

    if (decoded.type !== 'access') {
      logger.warn('Token type mismatch - expected access token');
      return null;
    }

    return {
      id: decoded.id,
      email: decoded.email,
      accountId: decoded.accountId,
      role: decoded.role,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Verify and decode refresh token
 */
export function verifyRefreshToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET) as TokenPayload;

    if (decoded.type !== 'refresh') {
      logger.warn('Token type mismatch - expected refresh token');
      return null;
    }

    return {
      id: decoded.id,
      email: decoded.email,
      accountId: decoded.accountId,
      role: decoded.role,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Refresh access token using refresh token
 * Returns new access token if refresh token is valid
 */
export function refreshAccessToken(refreshToken: string): {
  accessToken: string;
  expiresIn: number;
} | null {
  const user = verifyRefreshToken(refreshToken);

  if (!user) {
    return null;
  }

  return {
    accessToken: generateAccessToken(user),
    expiresIn: ACCESS_TOKEN_EXPIRY,
  };
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Verify JWT access token and attach user to request
 * Token should be in Authorization header: Bearer <token>
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

    // Verify access token
    const user = verifyAccessToken(token);

    if (!user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
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
 * Optional authentication - doesn't fail if no token
 * Useful for endpoints that work differently for authenticated users
 */
export function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const user = verifyAccessToken(token);

    if (user) {
      req.user = user;
    }
  }

  next();
}

// ============================================================================
// Legacy Support (for backwards compatibility)
// ============================================================================

/**
 * @deprecated Use generateAccessToken instead
 */
export function generateToken(user: AuthUser, expiresInSeconds: number = ACCESS_TOKEN_EXPIRY): string {
  const options: SignOptions = { expiresIn: expiresInSeconds };
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      accountId: user.accountId,
      role: user.role,
      type: 'access',
    },
    JWT_SECRET,
    options
  );
}

// ============================================================================
// Exports
// ============================================================================

export {
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
  REFRESH_TOKEN_COOKIE_NAME,
};
