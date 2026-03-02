/**
 * Telemetry Service — Integration Tests
 *
 * Validates logTelemetry INSERT behaviour, JSONB serialization,
 * null handling, and fire-and-forget error swallowing.
 * All DB access is mocked.
 */

import type { TelemetryRecord, RawTelemetryPayload } from '../../services/telemetry.service.js';

// ============================================================================
// Mocks — jest.mock() is hoisted above imports by the transform
// ============================================================================

jest.mock('../../database/connection.js', () => ({
  query: jest.fn(),
}));

jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { logTelemetry } from '../../services/telemetry.service.js';
import { query } from '../../database/connection.js';

const mockQuery = query as jest.Mock;

// ============================================================================
// Helpers
// ============================================================================

function buildRecord(overrides: Partial<TelemetryRecord> = {}): TelemetryRecord {
  return {
    lead_id: 'lead-001',
    conversation_id: 'conv-001',
    message_id: 'msg-001',
    prompt_version_id: null,
    detected_intent: 'booking_intent',
    intent_confidence: 0.92,
    reasoning: 'User wants to book',
    decision_path: [{ step: 'qualify' }],
    entities_extracted: { subject: 'math' },
    tool_calls: [{ name: 'update_lead_state', args: {} }],
    input_tokens: 500,
    output_tokens: 200,
    latency_ms: 1200,
    human_takeover: false,
    is_fallback: false,
    cost_usd: 0.005,
    model_name: 'claude-sonnet-4-20250514',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Telemetry Service', () => {
  beforeEach(() => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: 'INSERT' });
  });

  // --------------------------------------------------------------------------
  // logTelemetry — INSERT structure
  // --------------------------------------------------------------------------

  describe('logTelemetry()', () => {
    it('should INSERT into ai_telemetry with 18 parameter placeholders', async () => {
      await logTelemetry(buildRecord());

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const sql = mockQuery.mock.calls[0][0] as string;

      // Verify all 18 $N placeholders exist
      for (let i = 1; i <= 18; i++) {
        expect(sql).toContain(`$${i}`);
      }
    });

    it('should pass lead_id as the first parameter', async () => {
      await logTelemetry(buildRecord({ lead_id: 'lead-xyz' }));

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[0]).toBe('lead-xyz');
    });

    it('should pass conversation_id and message_id', async () => {
      await logTelemetry(buildRecord({ conversation_id: 'c-1', message_id: 'm-1' }));

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[1]).toBe('c-1');
      expect(params[2]).toBe('m-1');
    });

    // --------------------------------------------------------------------------
    // JSONB serialization
    // --------------------------------------------------------------------------

    it('should JSON.stringify decision_path when present', async () => {
      const dp: Record<string, unknown>[] = [{ step: 'qualify' }, { step: 'pitch' }];
      await logTelemetry(buildRecord({ decision_path: dp }));

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[7]).toBe(JSON.stringify(dp));
    });

    it('should JSON.stringify entities_extracted when present', async () => {
      const ee: Record<string, unknown> = { subject: 'physics', level: 'high_school' };
      await logTelemetry(buildRecord({ entities_extracted: ee }));

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[8]).toBe(JSON.stringify(ee));
    });

    it('should JSON.stringify tool_calls and compute tool_call_count', async () => {
      const tc: Record<string, unknown>[] = [{ name: 'a' }, { name: 'b' }];
      await logTelemetry(buildRecord({ tool_calls: tc }));

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[13]).toBe(JSON.stringify(tc));
      expect(params[14]).toBe(2); // tool_call_count
    });

    // --------------------------------------------------------------------------
    // Null handling
    // --------------------------------------------------------------------------

    it('should pass null for JSONB fields when they are null', async () => {
      await logTelemetry(
        buildRecord({
          decision_path: null,
          entities_extracted: null,
        }),
      );

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[7]).toBeNull();  // decision_path
      expect(params[8]).toBeNull();  // entities_extracted
    });

    it('should default tool_calls to "[]" string and count 0 when null', async () => {
      await logTelemetry(buildRecord({ tool_calls: null }));

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[13]).toBe('[]');
      expect(params[14]).toBe(0);
    });

    // --------------------------------------------------------------------------
    // Error propagation — callers use fire-and-forget, but logTelemetry throws
    // --------------------------------------------------------------------------

    it('should propagate DB errors to the caller', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection refused'));

      await expect(logTelemetry(buildRecord())).rejects.toThrow('connection refused');
    });
  });

  // --------------------------------------------------------------------------
  // RawTelemetryPayload shape
  // --------------------------------------------------------------------------

  describe('RawTelemetryPayload shape', () => {
    it('should accept a structurally valid payload (compile-time + runtime check)', () => {
      const payload: RawTelemetryPayload = {
        detected_intent: 'price_objection',
        intent_confidence: 0.85,
        reasoning: null,
        decision_path: null,
        entities_extracted: null,
        tool_calls: null,
        input_tokens: 100,
        output_tokens: 50,
        latency_ms: 800,
        human_takeover: false,
        is_fallback: true,
        cost_usd: null,
        model_name: null,
      };

      // All required fields exist
      expect(payload.input_tokens).toBe(100);
      expect(payload.output_tokens).toBe(50);
      expect(payload.latency_ms).toBe(800);
      expect(payload.is_fallback).toBe(true);
    });
  });
});
