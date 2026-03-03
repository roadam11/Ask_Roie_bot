/**
 * Authentication Routes
 *
 * Handles user authentication with secure token management:
 * - Access Token (15min) returned in response body
 * - Refresh Token (30 days) stored in httpOnly cookie
 *
 * @example
 * // Mount in Express app
 * import authRoutes from './api/routes/auth.routes.js';
 * app.use('/api/auth', authRoutes);
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { queryOne } from '../../database/connection.js';
import {
  generateTokenPair,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  getRefreshTokenFromCookie,
  refreshAccessToken,
  verifyRefreshToken,
  type AuthUser,
} from '../middleware/auth.middleware.js';
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
// POST /api/auth/login
// ============================================================================

/**
 * Login with email and password
 *
 * @body {string} email - User email
 * @body {string} password - User password
 *
 * @returns {object}
 *   - accessToken: JWT for API requests (15min)
 *   - expiresIn: Token expiry in seconds
 *   - user: User info (id, email, role)
 *
 * Sets httpOnly cookie with refresh token
 */
router.post('/login', authRateLimiter, validateBody(loginSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    // Find user by email
    const user = await queryOne<AdminUser>(
      `SELECT id, email, password_hash, account_id, role, active
       FROM admin_users
       WHERE email = $1`,
      [email.toLowerCase().trim()]
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

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      logger.warn('Login attempt with invalid password', { email });
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Generate tokens
    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      accountId: user.account_id,
      role: user.role,
    };

    const { accessToken, refreshToken, expiresIn } = generateTokenPair(authUser);

    // Set refresh token as httpOnly cookie
    setRefreshTokenCookie(res, refreshToken);

    // Update last login
    await queryOne(
      `UPDATE admin_users SET last_login_at = NOW() WHERE id = $1`,
      [user.id]
    );

    logger.info('User logged in', { userId: user.id, email: user.email });

    // Audit — fire and forget
    logAudit({
      accountId: user.account_id,
      userId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      metadata: { ip: req.ip, userAgent: req.get('user-agent') },
    });

    // Return access token in response body
    res.json({
      accessToken,
      expiresIn,
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

/**
 * Refresh access token using refresh token from cookie
 *
 * @returns {object}
 *   - accessToken: New JWT for API requests (15min)
 *   - expiresIn: Token expiry in seconds
 *
 * Requires valid refresh token in httpOnly cookie
 */
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    // Get refresh token from cookie
    const refreshToken = getRefreshTokenFromCookie(req);

    if (!refreshToken) {
      res.status(401).json({ error: 'No refresh token' });
      return;
    }

    // Validate refresh token and get new access token
    const result = refreshAccessToken(refreshToken);

    if (!result) {
      // Clear invalid cookie
      clearRefreshTokenCookie(res);
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }

    // Optionally: Verify user still exists and is active
    const user = verifyRefreshToken(refreshToken);
    if (user) {
      const dbUser = await queryOne<{ active: boolean }>(
        `SELECT active FROM admin_users WHERE id = $1`,
        [user.id]
      );

      if (!dbUser || !dbUser.active) {
        clearRefreshTokenCookie(res);
        res.status(401).json({ error: 'Account is deactivated' });
        return;
      }
    }

    res.json({
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    });
  } catch (error) {
    logger.error('Token refresh error', { error: (error as Error).message });
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// ============================================================================
// POST /api/auth/logout
// ============================================================================

/**
 * Logout user by clearing refresh token cookie
 *
 * @returns {object}
 *   - success: boolean
 *   - message: Confirmation message
 */
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    // Get user info from refresh token before clearing (for logging)
    const refreshToken = getRefreshTokenFromCookie(req);
    if (refreshToken) {
      const user = verifyRefreshToken(refreshToken);
      if (user) {
        logger.info('User logged out', { userId: user.id, email: user.email });
      }
    }

    // Clear the refresh token cookie
    clearRefreshTokenCookie(res);

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('Logout error', { error: (error as Error).message });
    // Still clear the cookie even if there's an error
    clearRefreshTokenCookie(res);
    res.json({
      success: true,
      message: 'Logged out',
    });
  }
});

// ============================================================================
// GET /api/auth/me
// ============================================================================

/**
 * Get current user info from access token
 *
 * @returns {object}
 *   - user: User info (id, email, accountId, role)
 *
 * Requires valid access token in Authorization header
 */
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

    // Get fresh user data from database
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
      [user.id]
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

/**
 * Change password for authenticated user
 *
 * @body {string} currentPassword - Current password
 * @body {string} newPassword - New password (min 8 chars)
 *
 * @returns {object}
 *   - success: boolean
 *   - message: Confirmation message
 */
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

    // Get current password hash
    const dbUser = await queryOne<{ password_hash: string }>(
      `SELECT password_hash FROM admin_users WHERE id = $1`,
      [user.id]
    );

    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, dbUser.password_hash);

    if (!isValid) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    // Hash new password and update
    const newHash = await bcrypt.hash(newPassword, 12);

    await queryOne(
      `UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [newHash, user.id]
    );

    logger.info('User changed password', { userId: user.id });

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    logger.error('Change password error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ============================================================================
// Export
// ============================================================================

export default router;
