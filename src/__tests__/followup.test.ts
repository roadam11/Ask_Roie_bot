/**
 * Tests for followup.service.ts
 *
 * Verifies scheduling guards, deduplication, and the 24h WhatsApp window rule.
 * All DB and queue calls are mocked.
 */

import { jest } from '@jest/globals';

// ── Mock stubs ────────────────────────────────────────────────────────────────

const mockQueryOne = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>();
const mockQuery = jest.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>();

jest.unstable_mockModule('../database/connection.js', () => ({
  queryOne: mockQueryOne,
  query: mockQuery,
}));

const mockEnqueue = jest.fn<() => Promise<string>>().mockResolvedValue('job-1');

jest.unstable_mockModule('../workers/queue.js', () => ({
  scheduleFollowUp: mockEnqueue,
}));

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

const {
  canScheduleFollowUp,
  scheduleFollowUp,
  cancelPendingFollowUps,
  markFollowUpSent,
} = await import('../services/followup.service.js');

// ============================================================================
// Helpers
// ============================================================================

function makeLead(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'lead-abc',
    phone: '+972501234567',
    status: 'new',
    opted_out: false,
    follow_up_count: 0,
    last_followup_sent_at: null,
    last_user_message_at: new Date(), // within 24h by default
    ...overrides,
  };
}

// ============================================================================
// canScheduleFollowUp
// ============================================================================

describe('canScheduleFollowUp()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows scheduling when all guards pass', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeLead())   // findLeadById
      .mockResolvedValueOnce(null);         // no pending follow-up

    const result = await canScheduleFollowUp('lead-abc');

    expect(result.allowed).toBe(true);
  });

  it('rejects when lead does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await canScheduleFollowUp('lead-unknown');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Lead not found');
  });

  it('rejects when lead has opted out', async () => {
    mockQueryOne.mockResolvedValueOnce(makeLead({ opted_out: true }));

    const result = await canScheduleFollowUp('lead-abc');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Lead has opted out');
  });

  it('rejects when lead is already booked', async () => {
    mockQueryOne.mockResolvedValueOnce(makeLead({ status: 'booked' }));

    const result = await canScheduleFollowUp('lead-abc');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Lead already booked');
  });

  it('rejects when follow_up_count >= 3 (anti-spam)', async () => {
    mockQueryOne.mockResolvedValueOnce(makeLead({ follow_up_count: 3 }));

    const result = await canScheduleFollowUp('lead-abc');

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Max follow-ups/);
  });

  it('rejects when last_user_message_at is older than 24h (24h window guard)', async () => {
    const over24h = new Date(Date.now() - 25 * 60 * 60 * 1000);
    mockQueryOne.mockResolvedValueOnce(makeLead({ last_user_message_at: over24h }));

    const result = await canScheduleFollowUp('lead-abc');

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/24h/);
  });

  it('rejects when cooldown has not expired (23h guard)', async () => {
    const recentFollowUp = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    mockQueryOne.mockResolvedValueOnce(makeLead({ last_followup_sent_at: recentFollowUp }));

    const result = await canScheduleFollowUp('lead-abc');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Cooldown active');
    expect(result.cooldownRemaining).toBeGreaterThan(0);
  });

  it('rejects when a pending follow-up already exists (deduplication)', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeLead())                  // findLeadById
      .mockResolvedValueOnce({ id: 'existing-followup' }); // pending found

    const result = await canScheduleFollowUp('lead-abc');

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Pending follow-up already exists/);
  });
});

// ============================================================================
// scheduleFollowUp
// ============================================================================

describe('scheduleFollowUp()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts a followup row and enqueues a BullMQ job', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeLead())   // findLeadById
      .mockResolvedValueOnce(null)          // no pending
      .mockResolvedValueOnce({ id: 'fu-1', lead_id: 'lead-abc', type: '24h', status: 'pending' }); // INSERT RETURNING

    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await scheduleFollowUp('lead-abc', '24h');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('fu-1');
    expect(mockEnqueue).toHaveBeenCalledWith('lead-abc', '24h', 'fu-1', expect.any(Number));
  });

  it('returns null when guard prevents scheduling', async () => {
    mockQueryOne.mockResolvedValueOnce(makeLead({ opted_out: true }));

    const result = await scheduleFollowUp('lead-abc', '24h');

    expect(result).toBeNull();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

// ============================================================================
// cancelPendingFollowUps
// ============================================================================

describe('cancelPendingFollowUps()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cancels all pending follow-ups for the lead', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 2 });

    const count = await cancelPendingFollowUps('lead-abc');

    expect(count).toBe(2);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'cancelled'"),
      ['lead-abc'],
    );
  });

  it('returns 0 when no pending follow-ups exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const count = await cancelPendingFollowUps('lead-abc');

    expect(count).toBe(0);
  });
});

// ============================================================================
// markFollowUpSent
// ============================================================================

describe('markFollowUpSent()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates followup status and lead counters', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    await markFollowUpSent('fu-1', 'lead-abc');

    // Should have made at least 2 DB updates (followup + lead)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'sent'"),
      ['fu-1'],
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('last_followup_sent_at'),
      ['lead-abc'],
    );
  });
});
