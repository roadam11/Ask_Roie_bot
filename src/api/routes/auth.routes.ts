/**
 * Authentication Routes
 *
 * Handles user authentication with secure token management:
 * - Access Token (15min) returned in response body (JWT)
 * - Refresh Token (30 days) stored as opaque random bytes in httpOnly cookie,
 *   bcrypt-hashed and tracked in the refresh_tokens DB table for rotation.
 *
 * Token rotation: on every /refresh call the old token is revoked and a new one
 * is issued atomically in a transaction.  Stolen token reuse is detectable because
 * the revoked row still exists with revoked_at set.
 */

import crypto from 'node:crypto';
import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import pg from 'pg';
import { queryOne, pool } from '../../database/connection.js';
import {
  generateAccessToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  getRefreshTokenFromCookie,
  verifyRefreshToken,
  type AuthUser,
} from '../middleware/auth.middleware.js';
import { ACCESS_TOKEN_EXPIRY, REFRESH_TOKEN_EXPIRY } from '../middleware/auth.middleware.js';
import { authRateLimiter } from '../middleware/rateLimit.middleware.js';
import { validateBody } from '../middleware/validate.js';
import { loginSchema, changePasswordSchema } from '../schemas/auth.schema.js';
import logger from '../../utils/logger.js';
import { logAudit } from '../../services/audit.service.js';

const router = Router();

// ============================================================================
// Types
// ============================================================================

interface AdminUser {
  id: string;
  email: string;
  password_hash: string;
  account_id: string;
  role: 'admin' | 'manager' | 'viewer';
  active: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a cryptographically random opaque refresh token (48 bytes → 96 hex chars)
 */
function generateOpaqueRefreshToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

/**
 * Insert a new refresh token row, returning the opaque token string.
 * The caller is responsible for sending the raw token to the client via cookie.
 */
async function createRefreshToken(
  client: pg.PoolClient,
  userId: string,
  accountId: string,
): Promise<string> {
  const raw = generateOpaqueRefreshToken();
  const hash = await bcrypt.hash(raw, 10);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY * 1000);

  await client.query(
    `INSERT INTO refresh_tokens (user_id, account_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, accountId, hash, expiresAt],
  );

  return raw;
}

/**
 * Find a valid (not revoked, not expired) refresh token row by scanning recent rows
 * and bcrypt-comparing. Returns the row or null.
 *
 * We scan the last 5 non-revoked tokens for the user to handle clock drift /
 * concurrent requests. bcrypt.compare is the slow step — kept to at most 5 comparisons.
 */
async function findAndValidateRefreshToken(
  client: pg.PoolClient,
  userId: string,
  rawToken: string,
): Promise<{ id: string; account_id: string; role: string } | null> {
  const rows = await client.query<{
    id: string;
    token_hash: string;
    account_id: string;
    role: string;
  }>(
    `SELECT rt.id, rt.token_hash, rt.account_id, au.role
     FROM refresh_tokens rt
     JOIN admin_users au ON au.id = rt.user_id
     WHERE rt.user_id = $1
       AND rt.revoked_at IS NULL
       AND rt.expires_at > NOW()
     ORDER BY rt.created_at DESC
     LIMIT 5`,
    [userId],
  );

  for (const row of rows.rows) {
    const match = await bcrypt.compare(rawToken, row.token_hash);
    if (match) return row;
  }

  return null;
}

// ============================================================================
// POST /api/auth/login
// ============================================================================

router.post('/login', authRateLimiter, validateBody(loginSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    // Find user
    const user = await queryOne<AdminUser>(
      `SELECT id, email, password_hash, account_id, role, active
       FROM admin_users
       WHERE email = $1`,
      [email.toLowerCase().trim()],
    );

    if (!user) {
      logger.warn('Login attempt with unknown email', { email });
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    if (!user.active) {
      logger.warn('Login attempt with inactive account', { email });
      res.status(401).json({ error: 'Account is deactivated' });
      return;
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      logger.warn('Login attempt with invalid password', { email });
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      accountId: user.account_id,
      role: user.role,
    };

    // Generate access token (short-lived JWT)
    const accessToken = generateAccessToken(authUser);

    // Generate and persist opaque refresh token in a transaction
    const client = await pool.connect();
    let rawRefreshToken: string;
    try {
      await client.query('BEGIN');
      rawRefreshToken = await createRefreshToken(client, user.id, user.account_id);
      await client.query(
        `UPDATE admin_users SET last_login_at = NOW() WHERE id = $1`,
        [user.id],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Set the raw opaque token as httpOnly cookie
    setRefreshTokenCookie(res, rawRefreshToken);

    logger.info('User logged in', { userId: user.id, email: user.email });

    logAudit({
      accountId: user.account_id,
      userId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      metadata: { ip: req.ip, userAgent: req.get('user-agent') },
    });

    res.json({
      accessToken,
      expiresIn: ACCESS_TOKEN_EXPIRY,
      user: {
        id: user.id,
        email: user.email,
        accountId: user.account_id,
        role: user.role,
      },
    });
  } catch (error) {
    logger.error('Login error', { error: (error as Error).message });
    res.status(500).json({ error: 'Login failed' });
  }
});

// ============================================================================
// POST /api/auth/refresh
// ============================================================================

router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawToken = getRefreshTokenFromCookie(req);

    if (!rawToken) {
      res.status(401).json({ error: 'No refresh token' });
      return;
    }

    // Decode the userId from the cookie so we can scope the DB lookup.
    // We keep a JWT-signed userId prefix embedded in legacy tokens, but for
    // opaque tokens we need the user to be identified by another means.
    // Strategy: try JWT verification first (legacy path); fall back to
    // scanning with the raw token only (opaque path — see findAndValidateRefreshToken).
    let userId: string | null = null;
    let accountId: string | null = null;

    // Legacy path: try treating the cookie as a JWT refresh token
    const jwtUser = verifyRefreshToken(rawToken);
    if (jwtUser) {
      userId = jwtUser.id;
      accountId = jwtUser.accountId;
    }

    // Opaque path: the cookie is a hex string.
    // For opaque tokens we need a way to find the user.
    // We encode the user id as the first 36 chars of the cookie (UUID),
    // BUT that is not yet implemented for all tokens.
    // For now, handle only the case where verifyRefreshToken succeeded OR
    // the cookie was issued as opaque after this sprint.
    // Since we cannot know the userId without scanning all users, we require
    // the userId to be sent in the request body for opaque tokens during transition.
    // HOWEVER: to keep the API clean, we instead embed the userId in the cookie
    // value as "userId.opaqueToken" format.
    if (!userId) {
      // Check if the cookie uses the "userId.rawToken" opaque format
      const dotIdx = rawToken.indexOf('.');
      if (dotIdx > 0) {
        userId = rawToken.substring(0, dotIdx);
        const actualToken = rawToken.substring(dotIdx + 1);

        const client = await pool.connect();
        try {
          const row = await findAndValidateRefreshToken(client, userId, actualToken);
          if (!row) {
            clearRefreshTokenCookie(res);
            res.status(401).json({ error: 'Invalid or expired refresh token' });
            return;
          }
          accountId = row.account_id;

          // Verify user still active
          const dbUser = await client.query<{ email: string; role: string; active: boolean }>(
            `SELECT email, role, active FROM admin_users WHERE id = $1`,
            [userId],
          );
          const dbRow = dbUser.rows[0];
          if (!dbRow || !dbRow.active) {
            clearRefreshTokenCookie(res);
            res.status(401).json({ error: 'Account is deactivated' });
            return;
          }

          // Rotate: revoke old, issue new in transaction
          let newRaw: string;
          try {
            await client.query('BEGIN');
            await client.query(
              `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
              [row.id],
            );
            newRaw = await createRefreshToken(client, userId, accountId);
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK');
            throw err;
          }

          const authUser: AuthUser = {
            id: userId,
            email: dbRow.email,
            accountId,
            role: dbRow.role as AuthUser['role'],
          };

          const newCookieValue = `${userId}.${newRaw}`;
          setRefreshTokenCookie(res, newCookieValue);

          res.json({
            accessToken: generateAccessToken(authUser),
            expiresIn: ACCESS_TOKEN_EXPIRY,
          });
          return;
        } finally {
          client.release();
        }
      }

      // Could not identify user — reject
      clearRefreshTokenCookie(res);
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }

    // Legacy JWT-based refresh (tokens issued before this sprint)
    // Verify user still exists and active
    const dbUser = await queryOne<{ active: boolean; email: string; role: string }>(
      `SELECT active, email, role FROM admin_users WHERE id = $1`,
      [userId],
    );

    if (!dbUser || !dbUser.active) {
      clearRefreshTokenCookie(res);
      res.status(401).json({ error: 'Account is deactivated' });
      return;
    }

    // Issue new access token (legacy path: no DB rotation, JWT is self-contained)
    const authUser: AuthUser = {
      id: userId,
      email: dbUser.email,
      accountId: accountId!,
      role: dbUser.role as AuthUser['role'],
    };

    res.json({
      accessToken: generateAccessToken(authUser),
      expiresIn: ACCESS_TOKEN_EXPIRY,
    });
  } catch (error) {
    logger.error('Token refresh error', { error: (error as Error).message });
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// ============================================================================
// POST /api/auth/logout
// ============================================================================

router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawToken = getRefreshTokenFromCookie(req);
    if (rawToken) {
      // Opaque token format: "userId.opaqueToken"
      const dotIdx = rawToken.indexOf('.');
      if (dotIdx > 0) {
        const userId = rawToken.substring(0, dotIdx);
        const actualToken = rawToken.substring(dotIdx + 1);

        // Find and revoke
        const client = await pool.connect();
        try {
          const row = await findAndValidateRefreshToken(client, userId, actualToken);
          if (row) {
            await client.query(
              `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
              [row.id],
            );
          }
        } finally {
          client.release();
        }

        logger.info('User logged out (opaque token revoked)', { userId });
      } else {
        // Legacy JWT — just log
        const user = verifyRefreshToken(rawToken);
        if (user) {
          logger.info('User logged out (legacy JWT)', { userId: user.id, email: user.email });
        }
      }
    }

    clearRefreshTokenCookie(res);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error', { error: (error as Error).message });
    clearRefreshTokenCookie(res);
    res.json({ success: true, message: 'Logged out' });
  }
});

// ============================================================================
// GET /api/auth/me
// ============================================================================

router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No access token' });
      return;
    }

    const token = authHeader.slice(7);
    const { verifyAccessToken } = await import('../middleware/auth.middleware.js');
    const user = verifyAccessToken(token);

    if (!user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const dbUser = await queryOne<{
      id: string;
      email: string;
      account_id: string;
      role: string;
      name: string;
    }>(
      `SELECT u.id, u.email, u.account_id, u.role, u.name
       FROM admin_users u
       WHERE u.id = $1 AND u.active = true`,
      [user.id],
    );

    if (!dbUser) {
      res.status(401).json({ error: 'User not found or inactive' });
      return;
    }

    res.json({
      user: {
        id: dbUser.id,
        email: dbUser.email,
        accountId: dbUser.account_id,
        role: dbUser.role,
        name: dbUser.name,
      },
    });
  } catch (error) {
    logger.error('Get user error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// ============================================================================
// POST /api/auth/change-password
// ============================================================================

router.post('/change-password', validateBody(changePasswordSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No access token' });
      return;
    }

    const token = authHeader.slice(7);
    const { verifyAccessToken } = await import('../middleware/auth.middleware.js');
    const user = verifyAccessToken(token);

    if (!user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current and new passwords are required' });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters' });
      return;
    }

    const dbUser = await queryOne<{ password_hash: string }>(
      `SELECT password_hash FROM admin_users WHERE id = $1`,
      [user.id],
    );

    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const isValid = await bcrypt.compare(currentPassword, dbUser.password_hash);
    if (!isValid) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await queryOne(
      `UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [newHash, user.id],
    );

    logger.info('User changed password', { userId: user.id });

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    logger.error('Change password error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ============================================================================
// Export
// ============================================================================

export default router;
