/**
 * Database Connection Manager
 *
 * Handles PostgreSQL and Redis connections with proper
 * error handling, logging, and graceful shutdown.
 *
 * @example
 * import { connectDatabase, query, redisClient } from './database/connection.js';
 *
 * await connectDatabase();
 * const leads = await query('SELECT * FROM leads WHERE phone = $1', [phone]);
 * await redisClient.set('key', 'value');
 */

import pg from 'pg';
import { createClient, RedisClientType } from 'redis';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const { Pool } = pg;

// ============================================================================
// PostgreSQL Connection Pool
// ============================================================================

/**
 * PostgreSQL connection pool
 */
const pool = new Pool({
  connectionString: config.database.url,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000, // Return an error after 5 seconds if connection not established
});

// Handle pool errors
pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL pool error', { error: err });
});

pool.on('connect', () => {
  logger.debug('New PostgreSQL client connected');
});

pool.on('remove', () => {
  logger.debug('PostgreSQL client removed from pool');
});

// ============================================================================
// Redis Client
// ============================================================================

/**
 * Redis client instance
 */
const redisClient: RedisClientType = createClient({
  url: config.redis.url,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        logger.error('Redis max reconnection attempts reached');
        return new Error('Redis max reconnection attempts reached');
      }
      // Exponential backoff: 100ms, 200ms, 400ms, etc.
      const delay = Math.min(100 * Math.pow(2, retries), 5000);
      logger.warn(`Redis reconnecting in ${delay}ms`, { attempt: retries + 1 });
      return delay;
    },
  },
});

// Handle Redis events
redisClient.on('error', (err) => {
  logger.error('Redis client error', { error: err });
});

redisClient.on('connect', () => {
  logger.debug('Redis client connecting');
});

redisClient.on('ready', () => {
  logger.info('Redis client ready');
});

redisClient.on('reconnecting', () => {
  logger.warn('Redis client reconnecting');
});

redisClient.on('end', () => {
  logger.info('Redis client disconnected');
});

// ============================================================================
// Connection Management
// ============================================================================

/**
 * Connect to PostgreSQL and Redis
 * Should be called during application startup
 *
 * @throws {Error} If connection fails
 */
async function connectDatabase(): Promise<void> {
  logger.info('Connecting to databases...');

  try {
    // Test PostgreSQL connection
    const pgClient = await pool.connect();
    const pgResult = await pgClient.query('SELECT NOW() as now, version() as version');
    pgClient.release();

    logger.info('PostgreSQL connected', {
      timestamp: pgResult.rows[0].now,
      version: pgResult.rows[0].version.split(' ')[0] + ' ' + pgResult.rows[0].version.split(' ')[1],
    });

    // Connect Redis
    await redisClient.connect();

    // Test Redis connection
    const redisPing = await redisClient.ping();
    if (redisPing !== 'PONG') {
      throw new Error('Redis ping failed');
    }

    logger.info('All database connections established successfully');
  } catch (error) {
    logger.error('Failed to connect to databases', { error });
    throw error;
  }
}

/**
 * Gracefully disconnect from PostgreSQL and Redis
 * Should be called during application shutdown
 */
async function disconnectDatabase(): Promise<void> {
  logger.info('Disconnecting from databases...');

  const errors: Error[] = [];

  // Close Redis connection
  try {
    if (redisClient.isOpen) {
      await redisClient.quit();
      logger.info('Redis disconnected');
    }
  } catch (error) {
    logger.error('Error disconnecting from Redis', { error });
    errors.push(error as Error);
  }

  // Close PostgreSQL pool
  try {
    await pool.end();
    logger.info('PostgreSQL pool closed');
  } catch (error) {
    logger.error('Error closing PostgreSQL pool', { error });
    errors.push(error as Error);
  }

  if (errors.length > 0) {
    throw new Error(`Failed to disconnect cleanly: ${errors.map((e) => e.message).join(', ')}`);
  }

  logger.info('All database connections closed');
}

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * Query result type
 */
interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number | null;
  command: string;
}

/**
 * Execute a PostgreSQL query
 *
 * @param sql - SQL query string with $1, $2, etc. placeholders
 * @param params - Array of parameter values
 * @returns Query result with typed rows
 *
 * @example
 * const result = await query('SELECT * FROM leads WHERE phone = $1', ['+972501234567']);
 * console.log(result.rows[0]);
 */
async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  const start = Date.now();

  try {
    const result = await pool.query(sql, params);
    const duration = Date.now() - start;

    // Log slow queries (> 100ms)
    if (duration > 100) {
      logger.warn('Slow query detected', {
        sql: sql.substring(0, 100),
        duration: `${duration}ms`,
        rowCount: result.rowCount,
      });
    } else {
      logger.debug('Query executed', {
        sql: sql.substring(0, 50),
        duration: `${duration}ms`,
        rowCount: result.rowCount,
      });
    }

    return {
      rows: result.rows as T[],
      rowCount: result.rowCount,
      command: result.command,
    };
  } catch (error) {
    logger.error('Query failed', {
      sql: sql.substring(0, 100),
      error,
    });
    throw error;
  }
}

/**
 * Execute a query and return a single row or null
 *
 * @param sql - SQL query string
 * @param params - Array of parameter values
 * @returns Single row or null if not found
 */
async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const result = await query<T>(sql, params);
  return result.rows[0] || null;
}

/**
 * Execute a query within a transaction
 *
 * @param callback - Function that receives a client and executes queries
 * @returns Result of the callback
 *
 * @example
 * await transaction(async (client) => {
 *   await client.query('UPDATE leads SET status = $1 WHERE id = $2', ['booked', leadId]);
 *   await client.query('INSERT INTO analytics (event_type, lead_id) VALUES ($1, $2)', ['booking', leadId]);
 * });
 */
async function transaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    logger.debug('Transaction committed');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Transaction rolled back', { error });
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check database health
 * Returns status of PostgreSQL and Redis connections
 */
async function checkDatabaseHealth(): Promise<{
  postgres: { connected: boolean; latency?: number; error?: string };
  redis: { connected: boolean; latency?: number; error?: string };
}> {
  const health = {
    postgres: { connected: false, latency: undefined as number | undefined, error: undefined as string | undefined },
    redis: { connected: false, latency: undefined as number | undefined, error: undefined as string | undefined },
  };

  // Check PostgreSQL
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    health.postgres.connected = true;
    health.postgres.latency = Date.now() - start;
  } catch (error) {
    health.postgres.error = (error as Error).message;
  }

  // Check Redis
  try {
    const start = Date.now();
    await redisClient.ping();
    health.redis.connected = true;
    health.redis.latency = Date.now() - start;
  } catch (error) {
    health.redis.error = (error as Error).message;
  }

  return health;
}

/**
 * Execute a query and return rows directly (convenience wrapper)
 */
async function queryRows<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await query<T>(sql, params);
  return result.rows;
}

// ============================================================================
// Exports
// ============================================================================

export {
  connectDatabase,
  disconnectDatabase,
  query,
  queryRows,
  queryOne,
  transaction,
  checkDatabaseHealth,
  pool,
  redisClient,
};

export type { QueryResult };
