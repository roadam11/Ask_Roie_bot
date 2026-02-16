/**
 * Database Migration Runner
 *
 * Automatically runs SQL migrations in order, tracking which have been applied.
 * Designed to run on Railway deployment before the server starts.
 *
 * Usage:
 *   npm run migrate
 *
 * The runner:
 * 1. Creates a migrations table if it doesn't exist
 * 2. Reads all .sql files from migrations/ folder
 * 3. Executes them in alphabetical order
 * 4. Skips already-applied migrations
 * 5. Logs success/failure for each migration
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config as dotenvConfig } from 'dotenv';

// Load environment variables
dotenvConfig();

const { Pool } = pg;

// Get current directory (ESM compatibility)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('railway') || DATABASE_URL.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined,
});

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// ============================================================================
// Migration Tracking Table
// ============================================================================

const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Log with timestamp
 */
function log(message: string, type: 'info' | 'success' | 'error' | 'warn' = 'info'): void {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: '\x1b[36m[INFO]\x1b[0m',
    success: '\x1b[32m[SUCCESS]\x1b[0m',
    error: '\x1b[31m[ERROR]\x1b[0m',
    warn: '\x1b[33m[WARN]\x1b[0m',
  }[type];
  console.log(`${timestamp} ${prefix} ${message}`);
}

/**
 * Get list of applied migrations
 */
async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await pool.query('SELECT name FROM migrations ORDER BY id');
  return new Set(result.rows.map((row) => row.name));
}

/**
 * Get list of migration files
 */
function getMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    log(`Migrations directory not found: ${MIGRATIONS_DIR}`, 'warn');
    return [];
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort(); // Sort alphabetically (001_, 002_, etc.)
}

/**
 * Apply a single migration
 */
async function applyMigration(filename: string): Promise<void> {
  const filepath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filepath, 'utf-8');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Execute migration SQL
    await client.query(sql);

    // Record migration
    await client.query('INSERT INTO migrations (name) VALUES ($1)', [filename]);

    await client.query('COMMIT');
    log(`Applied: ${filename}`, 'success');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// Main Migration Runner
// ============================================================================

async function runMigrations(): Promise<void> {
  log('Starting database migration runner...');
  log(`Database: ${DATABASE_URL?.replace(/:[^:@]+@/, ':***@')}`); // Hide password

  try {
    // Test connection
    log('Testing database connection...');
    await pool.query('SELECT NOW()');
    log('Database connection successful', 'success');

    // Create migrations table if not exists
    log('Ensuring migrations table exists...');
    await pool.query(CREATE_MIGRATIONS_TABLE);

    // Get already applied migrations
    const appliedMigrations = await getAppliedMigrations();
    log(`Found ${appliedMigrations.size} previously applied migrations`);

    // Get migration files
    const migrationFiles = getMigrationFiles();
    log(`Found ${migrationFiles.length} migration files`);

    if (migrationFiles.length === 0) {
      log('No migration files found', 'warn');
      return;
    }

    // Apply pending migrations
    let appliedCount = 0;
    let skippedCount = 0;

    for (const filename of migrationFiles) {
      if (appliedMigrations.has(filename)) {
        log(`Skipped (already applied): ${filename}`);
        skippedCount++;
        continue;
      }

      log(`Applying migration: ${filename}...`);
      await applyMigration(filename);
      appliedCount++;
    }

    // Summary
    log('----------------------------------------');
    log(`Migration run complete!`, 'success');
    log(`  - Applied: ${appliedCount} migration(s)`);
    log(`  - Skipped: ${skippedCount} migration(s) (already applied)`);
    log(`  - Total:   ${migrationFiles.length} migration file(s)`);
    log('----------------------------------------');

  } catch (error) {
    log(`Migration failed: ${(error as Error).message}`, 'error');
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// ============================================================================
// Run Migrations
// ============================================================================

runMigrations()
  .then(() => {
    log('Migration runner finished successfully', 'success');
    process.exit(0);
  })
  .catch((error) => {
    log(`Migration runner failed: ${error.message}`, 'error');
    process.exit(1);
  });
