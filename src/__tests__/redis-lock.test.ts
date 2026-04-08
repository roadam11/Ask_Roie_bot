/**
 * Tests for RedisLock distributed mutex
 *
 * Mocks the Redis client so tests run without a live Redis connection.
 * Uses jest.unstable_mockModule for correct ESM module mocking.
 */

import { jest } from '@jest/globals';

// ── Mock stubs (defined before module setup so factories can close over them)

const mockSet = jest.fn<(key: string, value: string, opts: { NX: boolean; EX: number }) => Promise<string | null>>();
const mockGet = jest.fn<(key: string) => Promise<string | null>>();
const mockEval = jest.fn<(script: string, opts: { keys: string[]; arguments: string[] }) => Promise<number>>();

// ── ESM-safe module mock ──────────────────────────────────────────────────────

jest.unstable_mockModule('../database/connection.js', () => ({
  redisClient: {
    set: mockSet,
    get: mockGet,
    eval: mockEval,
  },
  query: jest.fn(),
  queryOne: jest.fn(),
}));

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ── Import AFTER mocks are registered ────────────────────────────────────────

const { RedisLock } = await import('../utils/redis-lock.js');

// ============================================================================
// Tests
// ============================================================================

describe('RedisLock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── acquire ──────────────────────────────────────────────────────────────

  describe('acquire()', () => {
    it('returns true when Redis SET NX succeeds (lock not held)', async () => {
      mockSet.mockResolvedValueOnce('OK');

      const lock = new RedisLock('lead-123');
      const result = await lock.acquire();

      expect(result).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        'lock:lead:lead-123',
        expect.any(String),
        { NX: true, EX: 20 },
      );
    });

    it('returns false when Redis SET NX returns null (lock already held)', async () => {
      mockSet.mockResolvedValueOnce(null);

      const lock = new RedisLock('lead-456');
      const result = await lock.acquire();

      expect(result).toBe(false);
    });

    it('falls back to in-memory Set when Redis throws', async () => {
      mockSet.mockRejectedValueOnce(new Error('Redis connection refused'));

      const lock = new RedisLock('lead-fallback-new');
      const result = await lock.acquire();

      expect(result).toBe(true);

      // Clean up fallback
      await lock.release();
    });

    it('in-memory fallback blocks duplicate acquisition for same lead', async () => {
      mockSet.mockRejectedValue(new Error('Redis down'));

      const lock1 = new RedisLock('lead-dup-2');
      const lock2 = new RedisLock('lead-dup-2');

      const first = await lock1.acquire();
      const second = await lock2.acquire();

      expect(first).toBe(true);
      expect(second).toBe(false);

      // Clean up
      await lock1.release();
      mockSet.mockReset();
    });
  });

  // ── release ──────────────────────────────────────────────────────────────

  describe('release()', () => {
    it('calls Redis eval with Lua script and correct token', async () => {
      mockSet.mockResolvedValueOnce('OK');
      mockEval.mockResolvedValueOnce(1);

      const lock = new RedisLock('lead-789');
      await lock.acquire();
      await lock.release();

      expect(mockEval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call'),
        {
          keys: ['lock:lead:lead-789'],
          arguments: [expect.any(String)],
        },
      );
    });

    it('does not throw when Redis eval fails (best-effort release)', async () => {
      mockSet.mockResolvedValueOnce('OK');
      mockEval.mockRejectedValueOnce(new Error('Redis error'));

      const lock = new RedisLock('lead-error-rel');
      await lock.acquire();

      await expect(lock.release()).resolves.not.toThrow();
    });

    it('uses fallback release when fallback was used for acquire', async () => {
      mockSet.mockRejectedValueOnce(new Error('Redis down'));

      const lock = new RedisLock('lead-fb-rel');
      await lock.acquire();
      await lock.release();

      // eval should NOT have been called since we used in-memory fallback
      expect(mockEval).not.toHaveBeenCalled();
    });
  });

  // ── isLocked ─────────────────────────────────────────────────────────────

  describe('isLocked()', () => {
    it('returns true when a lock key exists in Redis', async () => {
      mockGet.mockResolvedValueOnce('some-token');

      const result = await RedisLock.isLocked('lead-check');

      expect(result).toBe(true);
      expect(mockGet).toHaveBeenCalledWith('lock:lead:lead-check');
    });

    it('returns false when no lock key exists in Redis', async () => {
      mockGet.mockResolvedValueOnce(null);

      const result = await RedisLock.isLocked('lead-free');

      expect(result).toBe(false);
    });

    it('falls back to in-memory check when Redis get throws', async () => {
      mockGet.mockRejectedValueOnce(new Error('Redis error'));

      // Not in fallback set → should return false
      const result = await RedisLock.isLocked('lead-fallback-check-2');

      expect(result).toBe(false);
    });
  });

  // ── lock lifecycle ────────────────────────────────────────────────────────

  describe('lock lifecycle', () => {
    it('allows reacquisition after release', async () => {
      mockSet
        .mockResolvedValueOnce('OK')   // first acquire
        .mockResolvedValueOnce('OK');  // second acquire after release
      mockEval.mockResolvedValue(1);

      const lock = new RedisLock('lead-lifecycle-2');
      expect(await lock.acquire()).toBe(true);
      await lock.release();

      const lock2 = new RedisLock('lead-lifecycle-2');
      expect(await lock2.acquire()).toBe(true);
      await lock2.release();
    });
  });
});
