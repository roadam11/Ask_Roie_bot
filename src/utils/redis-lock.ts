/**
 * Redis Distributed Lock
 *
 * Provides a distributed mutex using Redis SET NX EX to prevent
 * concurrent AI calls for the same lead across multiple server instances.
 *
 * Fallback: If Redis is unavailable, degrades gracefully to an in-memory Set
 * (safe for single-instance deployments, logged with [WA_LOCK_FALLBACK]).
 */

import crypto from 'node:crypto';
import { redisClient } from '../database/connection.js';
import logger from './logger.js';

// ============================================================================
// Constants
// ============================================================================

/** Lock TTL in seconds — matches the 15s Claude timeout + buffer */
const LOCK_TTL_SECONDS = 20;

/** Key prefix for all lead processing locks */
const LOCK_PREFIX = 'lock:lead:';

/**
 * Lua script for atomic check-and-delete.
 * Only deletes the key if the stored value matches our token (UUID).
 * Prevents releasing another holder's lock.
 */
const RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

// ============================================================================
// Fallback in-memory Set (single-instance safety net)
// ============================================================================

const fallbackSet = new Set<string>();

// ============================================================================
// RedisLock
// ============================================================================

export class RedisLock {
  private lockKey: string;
  private token: string;
  private usingFallback = false;

  constructor(leadId: string) {
    this.lockKey = `${LOCK_PREFIX}${leadId}`;
    this.token = crypto.randomUUID();
  }

  /**
   * Attempt to acquire the distributed lock.
   *
   * @returns true if the lock was acquired, false if already held.
   */
  async acquire(): Promise<boolean> {
    try {
      // SET key token NX EX <ttl> — atomic, only sets if key does not exist
      const result = await redisClient.set(this.lockKey, this.token, {
        NX: true,
        EX: LOCK_TTL_SECONDS,
      });

      // redis v4: returns 'OK' on success, null on NX miss
      return result === 'OK';
    } catch (err) {
      logger.warn('[WA_LOCK_FALLBACK] Redis lock failed, falling back to in-memory Set', {
        lockKey: this.lockKey,
        error: (err as Error).message,
      });

      this.usingFallback = true;

      if (fallbackSet.has(this.lockKey)) {
        return false;
      }
      fallbackSet.add(this.lockKey);
      return true;
    }
  }

  /**
   * Release the distributed lock.
   *
   * Uses an atomic Lua script so we only delete the key if we still own it.
   * Safe to call even if acquire() was never called or already released.
   */
  async release(): Promise<void> {
    if (this.usingFallback) {
      fallbackSet.delete(this.lockKey);
      return;
    }

    try {
      await redisClient.eval(RELEASE_SCRIPT, {
        keys: [this.lockKey],
        arguments: [this.token],
      });
    } catch (err) {
      // Best-effort — log but do not rethrow; the TTL will auto-expire the key
      logger.warn('[WA_LOCK_FALLBACK] Redis lock release failed (will auto-expire)', {
        lockKey: this.lockKey,
        error: (err as Error).message,
      });
      // Also clean up fallback set as a safety measure
      fallbackSet.delete(this.lockKey);
    }
  }

  /**
   * Check whether a lead is currently locked WITHOUT acquiring.
   * Used by admin endpoints to detect active AI processing.
   */
  static async isLocked(leadId: string): Promise<boolean> {
    const key = `${LOCK_PREFIX}${leadId}`;
    try {
      const value = await redisClient.get(key);
      return value !== null;
    } catch {
      // Fall back to the in-memory set
      return fallbackSet.has(key);
    }
  }
}
