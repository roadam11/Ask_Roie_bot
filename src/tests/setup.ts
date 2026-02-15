/**
 * Jest Test Setup
 *
 * Configures test environment, database connections,
 * and global test utilities.
 */

import { Pool } from 'pg';

// ============================================================================
// Mock Environment Variables
// ============================================================================

// Set test environment variables before any imports
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Minimize log noise in tests

// Database
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/ask_roie_test';

// API Keys (use test/mock values)
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';
process.env.WHATSAPP_ACCESS_TOKEN = 'test-whatsapp-token';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.CALENDLY_ACCESS_TOKEN = 'test-calendly-token';
process.env.ADMIN_API_KEY = 'test-admin-key';

// Redis (optional in tests)
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/1';

// ============================================================================
// Test Database Pool
// ============================================================================

let testPool: Pool | null = null;

/**
 * Get or create the test database pool
 */
export function getTestPool(): Pool {
  if (!testPool) {
    testPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });
  }
  return testPool;
}

/**
 * Close the test database pool
 */
export async function closeTestPool(): Promise<void> {
  if (testPool) {
    await testPool.end();
    testPool = null;
  }
}

// ============================================================================
// Database Utilities
// ============================================================================

/**
 * Clean all test data from the database
 * Deletes in correct order to respect foreign key constraints
 */
export async function cleanDatabase(): Promise<void> {
  const pool = getTestPool();

  await pool.query('DELETE FROM analytics');
  await pool.query('DELETE FROM followups');
  await pool.query('DELETE FROM messages');
  await pool.query('DELETE FROM leads');
}

/**
 * Create a test lead with default values
 */
export async function createTestLead(
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; phone: string }> {
  const pool = getTestPool();

  const phone = overrides.phone || `+9725${Math.random().toString().slice(2, 10)}`;
  const name = overrides.name || 'Test User';
  const status = overrides.status || 'new';

  const result = await pool.query(
    `INSERT INTO leads (phone, name, status) VALUES ($1, $2, $3) RETURNING id, phone`,
    [phone, name, status]
  );

  return result.rows[0];
}

/**
 * Create a test message
 */
export async function createTestMessage(
  leadId: string,
  role: 'user' | 'bot' | 'system' = 'user',
  content = 'Test message'
): Promise<{ id: string }> {
  const pool = getTestPool();

  const result = await pool.query(
    `INSERT INTO messages (lead_id, role, content) VALUES ($1, $2, $3) RETURNING id`,
    [leadId, role, content]
  );

  return result.rows[0];
}

// ============================================================================
// Jest Lifecycle Hooks
// ============================================================================

// Increase timeout for database operations
jest.setTimeout(10000);

// Clean up after all tests
afterAll(async () => {
  await closeTestPool();
});

// ============================================================================
// Global Test Utilities
// ============================================================================

/**
 * Wait for a specified number of milliseconds
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a random phone number for tests
 */
export function randomPhone(): string {
  return `+9725${Math.random().toString().slice(2, 10)}`;
}

/**
 * Generate a random UUID-like string for tests
 */
export function randomId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * Create a mock lead object
 */
export function mockLead(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomId(),
    phone: randomPhone(),
    name: 'Test User',
    subjects: null,
    level: null,
    grade_details: null,
    format_preference: null,
    status: 'new',
    parent_or_student: 'unknown',
    has_exam: null,
    urgency: null,
    objection_type: null,
    trial_offered: false,
    booking_completed: false,
    booked_at: null,
    calendly_event_uri: null,
    opted_out: false,
    needs_human_followup: false,
    last_user_message_at: null,
    last_bot_message_at: null,
    last_followup_sent_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

/**
 * Create a mock message object
 */
export function mockMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomId(),
    lead_id: randomId(),
    role: 'user',
    content: 'Test message',
    whatsapp_message_id: null,
    tokens_used: null,
    model_used: null,
    created_at: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Exports
// ============================================================================

export { testPool };
