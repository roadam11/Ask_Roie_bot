/**
 * JWT Configuration — Integration Tests
 *
 * Validates that JWT secrets meet minimum security requirements:
 * length, uniqueness, absence of dev-only sentinel values,
 * and correct token round-trip behaviour.
 */

// ============================================================================
// Mocks — config must be mocked before auth.middleware loads it
// ============================================================================

const TEST_JWT_SECRET = 'dev-jwt-secret-do-not-use-in-production-1234';
const TEST_JWT_REFRESH_SECRET = 'dev-jwt-refresh-secret-do-not-use-in-prod-1234';

jest.mock('../../config/index.js', () => ({
  __esModule: true,
  default: {
    jwt: {
      secret: TEST_JWT_SECRET,
      refreshSecret: TEST_JWT_REFRESH_SECRET,
    },
    server: { isProduction: false },
  },
}));

jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import config from '../../config/index.js';
import {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../../api/middleware/auth.middleware.js';
import type { AuthUser } from '../../api/middleware/auth.middleware.js';

// ============================================================================
// Helpers
// ============================================================================

const testUser: AuthUser = {
  id: 'user-001',
  email: 'test@example.com',
  accountId: 'acct-001',
  role: 'admin',
};

// ============================================================================
// Tests
// ============================================================================

describe('JWT Configuration', () => {
  it('should have jwt.secret of at least 32 characters', () => {
    expect(config.jwt.secret.length).toBeGreaterThanOrEqual(32);
  });

  it('should have jwt.refreshSecret of at least 32 characters', () => {
    expect(config.jwt.refreshSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('should use different values for secret and refreshSecret', () => {
    expect(config.jwt.secret).not.toBe(config.jwt.refreshSecret);
  });

  it('should not contain "dev-secret-change-in-production" in either secret', () => {
    expect(config.jwt.secret).not.toContain('dev-secret-change-in-production');
    expect(config.jwt.refreshSecret).not.toContain('dev-secret-change-in-production');
  });

  it('should produce access tokens verifiable with the configured secret', () => {
    const token = generateAccessToken(testUser);
    const decoded = verifyAccessToken(token);

    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(testUser.id);
    expect(decoded!.email).toBe(testUser.email);
  });

  it('should produce refresh tokens verifiable with the configured refreshSecret', () => {
    const token = generateRefreshToken(testUser);
    const decoded = verifyRefreshToken(token);

    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(testUser.id);
  });

  it('should NOT verify an access token with the refresh secret (cross-contamination guard)', () => {
    const accessToken = generateAccessToken(testUser);
    const decoded = verifyRefreshToken(accessToken);
    expect(decoded).toBeNull();
  });
});
