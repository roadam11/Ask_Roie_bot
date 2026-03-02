/**
 * AI Telemetry Service
 *
 * Persists structured telemetry for every AI interaction to the ai_telemetry table.
 * Called from controllers via fire-and-forget pattern (void ... .catch()).
 *
 * Schema: migrations 005_add_telemetry.sql + 007_add_analytics_tables.sql
 */

import { query } from '../database/connection.js';
import logger from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Raw telemetry payload built by claude.service.
 * Contains only data the AI service can provide — no DB-context IDs.
 */
export interface RawTelemetryPayload {
  detected_intent: string | null;
  intent_confidence: number | null;
  reasoning: string | null;
  decision_path: Record<string, unknown>[] | null;
  entities_extracted: Record<string, unknown> | null;
  tool_calls: Record<string, unknown>[] | null;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  human_takeover: boolean;
  is_fallback: boolean;
  cost_usd: number | null;
  model_name: string | null;
}

/**
 * Full telemetry record for DB insertion.
 * Extends RawTelemetryPayload with DB-context fields that controllers provide.
 */
export interface TelemetryRecord extends RawTelemetryPayload {
  lead_id: string;
  conversation_id: string | null;
  message_id: string | null;
  prompt_version_id: string | null;
}

// ============================================================================
// Telemetry Writer
// ============================================================================

/**
 * Insert a telemetry record into ai_telemetry.
 *
 * IMPORTANT: Callers must use `void logTelemetry(...).catch(...)` — never await
 * in the main response path. Telemetry failure must never affect user responses.
 *
 * Column mapping verified against migrations 005 + 007:
 * - NOT NULL: input_tokens, output_tokens, latency_ms
 * - GENERATED: total_tokens (excluded from INSERT)
 * - JSONB: decision_path, entities_extracted, tool_calls (JSON.stringify before insert)
 * - CHECK: detected_intent constrained to known values
 */
export async function logTelemetry(record: TelemetryRecord): Promise<void> {
  await query(
    `INSERT INTO ai_telemetry (
      lead_id, conversation_id, message_id, prompt_version_id,
      detected_intent, intent_confidence,
      reasoning, decision_path, entities_extracted,
      input_tokens, output_tokens, latency_ms,
      model_name, tool_calls, tool_call_count,
      human_takeover, is_fallback, cost_usd
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6,
      $7, $8, $9,
      $10, $11, $12,
      $13, $14, $15,
      $16, $17, $18
    )`,
    [
      record.lead_id,
      record.conversation_id,
      record.message_id,
      record.prompt_version_id,
      record.detected_intent,
      record.intent_confidence,
      record.reasoning,
      record.decision_path ? JSON.stringify(record.decision_path) : null,
      record.entities_extracted ? JSON.stringify(record.entities_extracted) : null,
      record.input_tokens,
      record.output_tokens,
      record.latency_ms,
      record.model_name,
      record.tool_calls ? JSON.stringify(record.tool_calls) : '[]',
      record.tool_calls?.length ?? 0,
      record.human_takeover,
      record.is_fallback,
      record.cost_usd,
    ],
  );

  logger.debug('Telemetry logged', {
    leadId: record.lead_id,
    intent: record.detected_intent,
    tokens: record.input_tokens + record.output_tokens,
    latencyMs: record.latency_ms,
  });
}
