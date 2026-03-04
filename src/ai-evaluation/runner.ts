/**
 * AI Quality Evaluation — Test Runner
 *
 * Orchestrates test execution: creates test leads, runs the AI pipeline,
 * evaluates responses, and cleans up test data.
 */

import { query, queryOne } from '../database/connection.js';
import { sendMessageWithToolLoop } from '../services/claude.service.js';
import type { ToolExecutor } from '../services/claude.service.js';
import type { Lead } from '../types/index.js';
import type { Scenario } from './scenarios.js';
import { evaluateResponse } from './evaluator.js';
import type { AssertionResult, FailureType, ScenarioStatus } from './evaluator.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ScenarioResult {
  id: string;
  group: string;
  input: string;
  response: string;
  response_time_ms: number;
  tokens_used: number;
  model_used: string;
  tool_calls: string[];
  assertions: AssertionResult[];
  binary_pass_rate: number;
  heuristic_pass_rate: number;
  status: ScenarioStatus;
  failure_types: FailureType[];
  error?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_LEAD_PREFIX = 'AI_EVAL_';
const TEST_PHONE = '0500000001';

// ── Test Tenant Setup ────────────────────────────────────────────────────────

interface TestTenant {
  accountId: string;
  agentId: string;
}

/**
 * Find or create a test tenant with known settings.
 * Reuses existing test account if present.
 */
export async function setupTestTenant(): Promise<TestTenant> {
  // Look for an existing account with an agent
  const existing = await queryOne<{ account_id: string; agent_id: string }>(
    `SELECT a.account_id, a.id as agent_id
     FROM agents a
     LIMIT 1`,
  );

  if (!existing) {
    throw new Error('No agent found in database — cannot run evaluation');
  }

  const { account_id: accountId, agent_id: agentId } = existing;

  // Ensure settings exist for this account with a complete test profile
  const settingsExist = await queryOne<{ id: string }>(
    `SELECT id FROM settings WHERE account_id = $1`,
    [accountId],
  );

  if (!settingsExist) {
    await query(
      `INSERT INTO settings (account_id, profile, behavior)
       VALUES ($1, $2::jsonb, $3::jsonb)
       ON CONFLICT (account_id) DO NOTHING`,
      [
        accountId,
        JSON.stringify({
          companyName: 'רועי אדם — מורה פרטי',
          ownerName: 'רועי המורה (טסט)',
          subjects: ['מתמטיקה', 'פיזיקה', 'מדעי המחשב'],
          levels: 'יסודי, חטיבה, תיכון, אקדמיה',
          experience: 'ניסיון בהוראה פרטית',
          credentials: '',
          pricing: 'זום: 150₪, פרונטלי: 170₪',
          price_per_lesson: 150,
          packages: 'חבילת 10 שיעורים: 10% הנחה | חבילת 20 שיעורים: 15% הנחה',
          availability: 'ראשון-חמישי 14:00-21:00, שישי 09:00-14:00, שבת סגור',
          location: 'זום: בכל מקום | פרונטלי: אזור השרון (הרצליה, רעננה, כפר סבא, נתניה) וצפון ת״א',
          formats: 'זום, פרונטלי',
          usp: 'תמיכה בווטסאפ בין השיעורים ללא תוספת תשלום',
          calendly_link: 'https://calendly.com/roadam11/meet-with-me',
          phone: '0500000000',
          timezone: 'Asia/Jerusalem',
        }),
        JSON.stringify({
          tone: 'friendly',
          strictness: 50,
          language: 'he',
        }),
      ],
    );
  }

  return { accountId, agentId };
}

// ── Single Scenario Execution ────────────────────────────────────────────────

/**
 * Run a single test scenario through the real AI pipeline.
 */
export async function runScenario(
  scenario: Scenario,
  tenant: TestTenant,
): Promise<ScenarioResult> {
  const leadName = `${TEST_LEAD_PREFIX}${scenario.id}`;
  let leadId: string | null = null;

  let originalProfile: unknown = null;

  try {
    // If scenario has a profile override, temporarily swap the settings profile
    if (scenario.profileOverride) {
      const currentSettings = await queryOne<{ profile: unknown }>(
        `SELECT profile FROM settings WHERE account_id = $1`,
        [tenant.accountId],
      );
      originalProfile = currentSettings?.profile ?? null;

      await query(
        `UPDATE settings SET profile = $1::jsonb WHERE account_id = $2`,
        [JSON.stringify(scenario.profileOverride), tenant.accountId],
      );
    }

    // Create test lead
    const leadRes = await queryOne<{ id: string }>(
      `INSERT INTO leads (phone, name, is_demo, agent_id, status, lead_state)
       VALUES ($1, $2, true, $3, 'new', 'new')
       RETURNING id`,
      [TEST_PHONE, leadName, tenant.agentId],
    );

    if (!leadRes) {
      throw new Error('Failed to create test lead');
    }

    leadId = leadRes.id;

    // Build a Lead object for the AI pipeline
    const lead: Lead = {
      id: leadId,
      phone: TEST_PHONE,
      name: leadName,
      status: 'new',
      is_demo: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Handle empty input scenario — return fallback without calling AI
    if (!scenario.input || !scenario.input.trim()) {
      const fallbackResponse = 'היי! 😊 במה אפשר לעזור?';
      return {
        id: scenario.id,
        group: scenario.group,
        input: scenario.input,
        response: fallbackResponse,
        response_time_ms: 0,
        tokens_used: 0,
        model_used: 'fallback',
        tool_calls: [],
        assertions: evaluateResponse(fallbackResponse, scenario.assertions).results,
        binary_pass_rate: evaluateResponse(fallbackResponse, scenario.assertions).binaryPassRate,
        heuristic_pass_rate: evaluateResponse(fallbackResponse, scenario.assertions).heuristicPassRate,
        status: evaluateResponse(fallbackResponse, scenario.assertions).status,
        failure_types: evaluateResponse(fallbackResponse, scenario.assertions).failureTypes,
      };
    }

    // Tool executor that records calls but skips side effects
    const toolCallNames: string[] = [];
    const toolExecutor: ToolExecutor = async (toolCall) => {
      toolCallNames.push(toolCall.name);

      if (toolCall.name === 'update_lead_state') {
        return {
          result: JSON.stringify({ success: true }),
          isError: false,
        };
      }
      if (toolCall.name === 'send_interactive_message' || toolCall.name === 'send_whatsapp_message') {
        return {
          result: 'Skipped: evaluation mode',
          isError: false,
        };
      }
      return {
        result: `Tool ${toolCall.name} not available in evaluation mode`,
        isError: false,
      };
    };

    // Multi-turn handling: send first message, capture response, then send second with history
    let aiResult;
    if (scenario.type === 'multi_turn' && scenario.messages && scenario.messages.length >= 2) {
      // Step 1: Send first user message
      const firstMsg = scenario.messages[0];
      const firstResult = await sendMessageWithToolLoop(
        lead,
        [{ role: 'user', content: firstMsg.content }],
        toolExecutor,
      );

      // Step 2: Build history with first exchange + second user message
      const secondMsg = scenario.messages[1];
      const history = [
        { role: 'user' as const, content: firstMsg.content },
        { role: 'assistant' as const, content: firstResult.content },
        { role: 'user' as const, content: secondMsg.content },
      ];

      // Step 3: Send second message with full history — evaluate THIS response
      aiResult = await sendMessageWithToolLoop(lead, history, toolExecutor);
      aiResult.totalUsage.totalTokens += firstResult.totalUsage.totalTokens;
      aiResult.responseTimeMs += firstResult.responseTimeMs;
    } else {
      // Standard single-turn
      aiResult = await sendMessageWithToolLoop(
        lead,
        [{ role: 'user', content: scenario.input }],
        toolExecutor,
      );
    }

    // Evaluate the response
    const evaluation = evaluateResponse(aiResult.content, scenario.assertions);

    return {
      id: scenario.id,
      group: scenario.group,
      input: scenario.input,
      response: aiResult.content,
      response_time_ms: aiResult.responseTimeMs,
      tokens_used: aiResult.totalUsage.totalTokens,
      model_used: aiResult.model,
      tool_calls: toolCallNames,
      assertions: evaluation.results,
      binary_pass_rate: evaluation.binaryPassRate,
      heuristic_pass_rate: evaluation.heuristicPassRate,
      status: evaluation.status,
      failure_types: evaluation.failureTypes,
    };
  } catch (err) {
    const error = err as Error;

    return {
      id: scenario.id,
      group: scenario.group,
      input: scenario.input,
      response: '',
      response_time_ms: 0,
      tokens_used: 0,
      model_used: 'unknown',
      tool_calls: [],
      assertions: [],
      binary_pass_rate: 0,
      heuristic_pass_rate: 0,
      status: 'FAIL',
      failure_types: ['F6_EMPTY_CRASH'],
      error: error.message,
    };
  } finally {
    // Restore original profile if we overrode it
    if (scenario.profileOverride && originalProfile !== null) {
      await query(
        `UPDATE settings SET profile = $1::jsonb WHERE account_id = $2`,
        [JSON.stringify(originalProfile), tenant.accountId],
      );
    }

    // Clean up this test lead immediately
    if (leadId) {
      await query(`DELETE FROM messages WHERE lead_id = $1`, [leadId]);
      await query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    }
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Clean up ALL remaining test data (safety net).
 */
export async function cleanupTestData(): Promise<number> {
  // Delete messages for test leads
  await query(
    `DELETE FROM messages WHERE lead_id IN (
      SELECT id FROM leads WHERE name LIKE '${TEST_LEAD_PREFIX}%'
    )`,
  );

  // Delete test leads
  const result = await query(
    `DELETE FROM leads WHERE name LIKE '${TEST_LEAD_PREFIX}%'`,
  );

  return result.rowCount || 0;
}
