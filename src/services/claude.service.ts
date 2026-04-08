/**
 * Claude Service - Anthropic API Integration
 *
 * Handles all communication with the Claude API including
 * tool use, token tracking, and error handling.
 *
 * @example
 * import * as ClaudeService from './services/claude.service.js';
 *
 * const response = await ClaudeService.sendMessage(lead, conversationHistory);
 * // response.content = text response
 * // response.toolCalls = [{ name: 'update_lead_state', input: {...} }]
 */

import Anthropic from '@anthropic-ai/sdk';
import config from '../config/index.js';
import logger, { logClaude } from '../utils/logger.js';
import { buildPromptWithContext } from '../prompts/system-prompt.js';
import type { Lead } from '../types/index.js';
import type { RawTelemetryPayload } from './telemetry.service.js';
import { loadSettingsForLead } from './settings.service.js';
import type { AccountSettings } from './settings.service.js';
import { validateAIResponse } from '../utils/response-validator.js';
import { selectModel } from '../utils/model-router.js';
import type { RoutingDecision } from '../utils/model-router.js';
import { getActiveVersionForLead } from './prompt-version.service.js';

// ============================================================================
// History Sanitization — strip polluted credential claims from old bot messages
// ============================================================================

const FORBIDDEN_CLAIMS = /תואר ראשון|תואר שני|BA |MA |PhD|500 תלמידים|מאות תלמידים/gi;

// ============================================================================
// Types
// ============================================================================

/**
 * Message format for internal use
 * Accepts both internal format ('bot', 'system') and Claude API format ('assistant')
 */
interface ConversationMessage {
  role: 'user' | 'assistant' | 'bot' | 'system';
  content: string;
  timestamp?: Date;
}

/**
 * Tool call from Claude
 */
interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Response from Claude service
 */
export interface ClaudeResponse {
  /** Text content of the response */
  content: string;

  /** Tool calls made by Claude */
  toolCalls: ToolCall[];

  /** Whether Claude wants to use tools */
  hasToolUse: boolean;

  /** Stop reason */
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';

  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };

  /** Estimated cost in USD */
  costUsd: number;

  /** Model used */
  model: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Claude pricing per 1M tokens (as of 2024)
 * Claude 3 Sonnet pricing
 */
const PRICING = {
  'claude-3-sonnet-20240229': {
    input: 3.0,   // $3 per 1M input tokens
    output: 15.0, // $15 per 1M output tokens
  },
  'claude-3-5-sonnet-20241022': {
    input: 3.0,
    output: 15.0,
  },
  'claude-sonnet-4-20250514': {
    input: 3.0,
    output: 15.0,
  },
  'claude-3-haiku-20240307': {
    input: 0.25,
    output: 1.25,
  },
  'claude-haiku-4-5-20251001': {
    input: 0.80,
    output: 4.0,
  },
  default: {
    input: 3.0,
    output: 15.0,
  },
} as const;

/**
 * Retry configuration
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Tool: update_lead_state
 * Updates the lead's information in the database
 */
const UPDATE_LEAD_STATE_TOOL: Anthropic.Tool = {
  name: 'update_lead_state',
  description: `Update the lead's information in the database. Call this whenever you learn new information about the lead or need to change their status.

CRITICAL: NEVER set status to 'booked' directly. Only set 'ready_to_book' when the user confirms booking intent. The 'booked' status is reserved for confirmed Calendly events only.

Status progression: new → qualified → considering → hesitant → ready_to_book → booked (Calendly only)
'lost' can be set from any status.

FOLLOW-UP AUTOMATION: When user says "אחשוב על זה" / "אני צריך לחשוב" / "אעדכן", set lead_state to 'thinking' to trigger a 24h follow-up reminder.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description: "Lead's name",
      },
      subjects: {
        type: 'array',
        items: { type: 'string' },
        description: 'Subjects interested in (will be merged with existing)',
      },
      level: {
        type: 'string',
        enum: ['elementary', 'middle_school', 'high_school', 'college'],
        description: 'Education level',
      },
      grade_details: {
        type: 'string',
        description: 'Specific grade or year details',
      },
      format_preference: {
        type: 'string',
        enum: ['zoom', 'frontal', 'undecided'],
        description: 'Preferred tutoring format',
      },
      status: {
        type: 'string',
        enum: ['new', 'qualified', 'considering', 'hesitant', 'ready_to_book', 'lost'],
        description: 'Lead status in sales funnel (cannot set to booked)',
      },
      lead_state: {
        type: 'string',
        enum: ['new', 'engaged', 'thinking', 'trial_scheduled', 'converted', 'closed'],
        description: 'Lead state for follow-up automation. Set to "thinking" when user says they need to think about it.',
      },
      parent_or_student: {
        type: 'string',
        enum: ['parent', 'student', 'unknown'],
        description: 'Whether contact is parent or student',
      },
      has_exam: {
        type: 'boolean',
        description: 'Whether student has an upcoming exam',
      },
      urgency: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Urgency level',
      },
      objection_type: {
        type: 'string',
        enum: ['price', 'time', 'format', 'trust', 'other', 'none'],
        description: 'Type of objection raised',
      },
      trial_offered: {
        type: 'boolean',
        description: 'Whether a trial lesson was offered',
      },
      opted_out: {
        type: 'boolean',
        description: 'Whether lead has opted out of communications',
      },
      needs_human_followup: {
        type: 'boolean',
        description: 'Whether lead needs human follow-up',
      },
    },
    required: [],
  },
};

/**
 * Tool: send_interactive_message
 * Sends an interactive WhatsApp message with buttons
 */
const SEND_INTERACTIVE_MESSAGE_TOOL: Anthropic.Tool = {
  name: 'send_interactive_message',
  description: `Send an interactive WhatsApp message. Types: reply_buttons, list, cta_url.
- reply_buttons: up to 3 quick-reply buttons
- list: expandable list with sections and rows
- cta_url: single CTA button linking to a URL (e.g. Calendly)

The message will be sent after your text response.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      message_type: {
        type: 'string',
        enum: ['reply_buttons', 'list', 'cta_url'],
        description: 'Type of interactive message',
      },
      body_text: {
        type: 'string',
        description: 'Main message body text',
      },
      reply_buttons: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Button identifier' },
            title: { type: 'string', description: 'Button label (max 20 chars)' },
          },
          required: ['id', 'title'],
        },
        description: 'Buttons for reply_buttons type (max 3)',
      },
      list_button_text: {
        type: 'string',
        description: 'Text on the list open button (max 20 chars, for list type)',
      },
      list_sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Section title' },
            rows: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Row identifier' },
                  title: { type: 'string', description: 'Row title (max 24 chars)' },
                },
                required: ['id', 'title'],
              },
            },
          },
          required: ['rows'],
        },
        description: 'Sections for list type (max 3 sections)',
      },
      cta_url: {
        type: 'string',
        description: 'URL for cta_url type (e.g. Calendly link)',
      },
      cta_display_text: {
        type: 'string',
        description: 'Button text for cta_url type (max 20 chars)',
      },
    },
    required: ['message_type', 'body_text'],
  },
};

/**
 * All available tools
 */
const TOOLS: Anthropic.Tool[] = [
  UPDATE_LEAD_STATE_TOOL,
  SEND_INTERACTIVE_MESSAGE_TOOL,
];

// ============================================================================
// Claude Client
// ============================================================================

/**
 * Anthropic client instance
 */
let client: Anthropic | null = null;

/**
 * Get or create the Anthropic client
 */
/** AI call timeout in milliseconds (15 seconds) */
const AI_TIMEOUT_MS = 15_000;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: config.anthropic.apiKey,
      timeout: AI_TIMEOUT_MS,
    });
  }
  return client;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate cost based on token usage
 */
function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): number {
  const pricing = PRICING[model as keyof typeof PRICING] || PRICING.default;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Build system message blocks with prompt caching enabled.
 * Uses cache_control: ephemeral for 5-minute prompt cache (90% cost reduction on hits).
 * The SDK type (v0.27) doesn't include cache_control yet, so we use a broader type.
 */
function buildCachedSystemBlocks(systemPrompt: string): Anthropic.MessageCreateParams['system'] {
  return [
    {
      type: 'text',
      text: systemPrompt,
      cache_control: { type: 'ephemeral' },
    } as unknown as Anthropic.TextBlockParam,
  ];
}

/**
 * Format conversation messages for Claude API
 */
function formatMessagesForClaude(
  messages: ConversationMessage[]
): Anthropic.MessageParam[] {
  // Filter and map messages
  const claudeMessages: Anthropic.MessageParam[] = messages
    .filter((msg) => msg.content && msg.content.trim().length > 0)
    .map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    }));

  // Ensure conversation starts with user message
  while (claudeMessages.length > 0 && claudeMessages[0].role === 'assistant') {
    claudeMessages.shift();
  }

  // Merge consecutive messages from same role
  const mergedMessages: Anthropic.MessageParam[] = [];
  for (const msg of claudeMessages) {
    const lastMsg = mergedMessages[mergedMessages.length - 1];
    if (lastMsg && lastMsg.role === msg.role) {
      // Merge content
      if (typeof lastMsg.content === 'string' && typeof msg.content === 'string') {
        lastMsg.content = lastMsg.content + '\n\n' + msg.content;
      }
    } else {
      mergedMessages.push({ ...msg });
    }
  }

  return mergedMessages;
}

/**
 * Extract text content and tool calls from Claude response
 */
function parseResponse(response: Anthropic.Message): ClaudeResponse {
  let textContent = '';
  const toolCalls: ToolCall[] = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      textContent += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
    }
  }

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd = calculateCost(inputTokens, outputTokens, response.model);

  return {
    content: textContent.trim(),
    toolCalls,
    hasToolUse: toolCalls.length > 0,
    stopReason: response.stop_reason as ClaudeResponse['stopReason'],
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    costUsd,
    model: response.model,
  };
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if error is retryable
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Anthropic.RateLimitError) {
    return true;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return true;
  }
  if (error instanceof Anthropic.InternalServerError) {
    return true;
  }
  return false;
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Send a message to Claude and get a response
 *
 * @param lead - Current lead state
 * @param conversationHistory - Previous messages in the conversation
 * @returns Claude's response with content and tool calls
 */
export async function sendMessage(
  lead: Lead,
  conversationHistory: ConversationMessage[]
): Promise<ClaudeResponse> {
  const anthropic = getClient();

  // Load account settings for prompt personalization
  const settings = await safeLoadSettings(lead.id);

  // Build system prompt with lead state and conversation context
  const systemPrompt = buildPromptWithContext(conversationHistory, lead, settings);

  // Format messages for Claude
  const messages = formatMessagesForClaude(conversationHistory);

  // Ensure we have at least one message
  if (messages.length === 0) {
    throw new Error('No messages to send to Claude');
  }

  let lastError: Error | null = null;
  let delay = RETRY_CONFIG.initialDelayMs;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      logger.debug('Sending message to Claude', {
        leadId: lead.id,
        messageCount: messages.length,
        attempt: attempt + 1,
      });

      const response = await anthropic.messages.create({
        model: config.anthropic.model,
        max_tokens: config.anthropic.maxTokens,
        temperature: 0.4,
        system: buildCachedSystemBlocks(systemPrompt),
        messages,
        tools: TOOLS,
      });

      const parsed = parseResponse(response);

      // Log the API call
      logClaude('message_sent', { input: parsed.usage.inputTokens, output: parsed.usage.outputTokens }, {
        leadId: lead.id,
        model: parsed.model,
        costUsd: parsed.costUsd,
        hasToolUse: parsed.hasToolUse,
        toolNames: parsed.toolCalls.map((t) => t.name),
      });

      logger.info('Claude response received', {
        leadId: lead.id,
        contentLength: parsed.content.length,
        toolCalls: parsed.toolCalls.length,
        tokens: parsed.usage.totalTokens,
        costUsd: parsed.costUsd.toFixed(4),
      });

      return parsed;
    } catch (error) {
      lastError = error as Error;

      if (!isRetryableError(error) || attempt === RETRY_CONFIG.maxRetries) {
        logger.error('Claude API error', {
          leadId: lead.id,
          error: lastError.message,
          attempt: attempt + 1,
          willRetry: false,
        });
        throw error;
      }

      logger.warn('Claude API error, retrying', {
        leadId: lead.id,
        error: lastError.message,
        attempt: attempt + 1,
        nextDelayMs: delay,
      });

      await sleep(delay);
      delay = Math.min(delay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs);
    }
  }

  throw lastError || new Error('Claude API request failed after retries');
}

/**
 * Send a simple message without tools (for quick responses)
 *
 * @param systemPrompt - System prompt to use
 * @param userMessage - User's message
 * @returns Claude's text response
 */
export async function sendSimpleMessage(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const anthropic = getClient();

  try {
    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: config.anthropic.maxTokens,
      system: buildCachedSystemBlocks(systemPrompt),
      messages: [{ role: 'user', content: userMessage }],
    });

    const parsed = parseResponse(response);

    logClaude('simple_message', { input: parsed.usage.inputTokens, output: parsed.usage.outputTokens }, {
      model: parsed.model,
      costUsd: parsed.costUsd,
    });

    return parsed.content;
  } catch (error) {
    logger.error('Claude simple message error', { error });
    throw error;
  }
}

/**
 * Continue conversation after tool use
 *
 * @param lead - Current lead state
 * @param conversationHistory - Previous messages
 * @param toolResults - Results from tool executions
 * @returns Claude's follow-up response
 */
export async function continueAfterToolUse(
  lead: Lead,
  conversationHistory: ConversationMessage[],
  toolResults: Array<{ toolCallId: string; result: string; isError?: boolean }>
): Promise<ClaudeResponse> {
  const anthropic = getClient();

  // Load account settings for prompt personalization
  const settings = await safeLoadSettings(lead.id);

  // Build system prompt
  const systemPrompt = buildPromptWithContext(conversationHistory, lead, settings);

  // Format base messages
  const messages = formatMessagesForClaude(conversationHistory);

  // Add tool results as the last assistant message followed by tool results
  const toolResultContent: Anthropic.ToolResultBlockParam[] = toolResults.map((tr) => ({
    type: 'tool_result' as const,
    tool_use_id: tr.toolCallId,
    content: tr.result,
    is_error: tr.isError,
  }));

  // Append tool results to messages
  messages.push({
    role: 'user',
    content: toolResultContent,
  });

  try {
    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: config.anthropic.maxTokens,
      temperature: 0.4,
      system: buildCachedSystemBlocks(systemPrompt),
      messages,
      tools: TOOLS,
    });

    const parsed = parseResponse(response);

    logClaude('tool_continuation', { input: parsed.usage.inputTokens, output: parsed.usage.outputTokens }, {
      leadId: lead.id,
      model: parsed.model,
      costUsd: parsed.costUsd,
    });

    return parsed;
  } catch (error) {
    logger.error('Claude tool continuation error', { leadId: lead.id, error });
    throw error;
  }
}

// ============================================================================
// Telemetry Helpers
// ============================================================================

/** Valid detected_intent values per CHECK constraint in migration 005 */
type DetectedIntent =
  | 'greeting' | 'inquiry' | 'qualification'
  | 'objection_price' | 'objection_time' | 'objection_format' | 'objection_trust'
  | 'booking_intent' | 'booking_confirm' | 'thinking'
  | 'followup_request' | 'human_request' | 'opt_out' | 'off_topic' | 'unclear';

/**
 * Infer detected_intent from update_lead_state tool call input.
 * Returns null if no clear mapping — never fabricates values.
 */
function inferIntentFromToolCalls(toolCalls: ToolCall[]): DetectedIntent | null {
  const leadState = toolCalls.find((tc) => tc.name === 'update_lead_state');
  if (!leadState) return null;

  const input = leadState.input;
  if (input.needs_human_followup === true) return 'human_request';
  if (input.opted_out === true) return 'opt_out';
  if (input.lead_state === 'thinking') return 'thinking';
  if (input.status === 'ready_to_book') return 'booking_intent';
  if (input.objection_type === 'price') return 'objection_price';
  if (input.objection_type === 'time') return 'objection_time';
  if (input.objection_type === 'format') return 'objection_format';
  if (input.objection_type === 'trust') return 'objection_trust';
  if (input.status === 'qualified') return 'qualification';
  return null;
}

/**
 * Extract structured entities from update_lead_state tool call input.
 * Only includes fields that were actually set — returns null if empty.
 */
function extractEntitiesFromToolCalls(toolCalls: ToolCall[]): Record<string, unknown> | null {
  const leadState = toolCalls.find((tc) => tc.name === 'update_lead_state');
  if (!leadState) return null;

  const input = leadState.input;
  const entities: Record<string, unknown> = {};

  if (input.name) entities.name = input.name;
  if (input.subjects) entities.subjects = input.subjects;
  if (input.level) entities.level = input.level;
  if (input.grade_details) entities.grade_details = input.grade_details;
  if (input.format_preference) entities.format_preference = input.format_preference;
  if (input.parent_or_student) entities.parent_or_student = input.parent_or_student;
  if (input.has_exam !== undefined) entities.has_exam = input.has_exam;
  if (input.urgency) entities.urgency = input.urgency;

  return Object.keys(entities).length > 0 ? entities : null;
}

/**
 * Build RawTelemetryPayload from collected loop data.
 */
function buildTelemetryPayload(
  toolCalls: ToolCall[],
  reasoning: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  costUsd: number,
  model: string,
  isFallback: boolean,
): RawTelemetryPayload {
  return {
    detected_intent: inferIntentFromToolCalls(toolCalls),
    intent_confidence: null, // No confidence available from tool schema
    reasoning: reasoning || null,
    decision_path: toolCalls.length > 0
      ? toolCalls.map((tc) => ({ tool: tc.name, input: tc.input }))
      : null,
    entities_extracted: extractEntitiesFromToolCalls(toolCalls),
    tool_calls: toolCalls.length > 0
      ? toolCalls.map((tc) => ({ id: tc.id, name: tc.name, input: tc.input }))
      : null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    latency_ms: latencyMs,
    human_takeover: toolCalls.some(
      (tc) => tc.name === 'update_lead_state' && tc.input.needs_human_followup === true,
    ),
    is_fallback: isFallback,
    cost_usd: costUsd,
    model_name: model,
  };
}

// ============================================================================
// Settings Loader (for prompt personalization)
// ============================================================================

/**
 * Safely load account settings for a lead.
 * Returns null on any failure — prompt builder falls back to hardcoded prompt.
 */
async function safeLoadSettings(leadId: string): Promise<AccountSettings | null> {
  try {
    return await loadSettingsForLead(leadId);
  } catch (err) {
    logger.warn('Failed to load account settings, using default prompt', {
      leadId,
      error: (err as Error).message,
    });
    return null;
  }
}

// ============================================================================
// Agentic Loop - Multi-Turn Tool Execution
// ============================================================================

/**
 * Tool executor function type
 */
export type ToolExecutor = (
  toolCall: ToolCall
) => Promise<{ result: string; isError?: boolean }>;

/**
 * Result from the agentic loop
 */
export interface AgentLoopResult {
  /** Final text response for the user */
  content: string;

  /** All tool calls that were executed */
  executedToolCalls: ToolCall[];

  /** Total token usage across all API calls */
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };

  /** Total cost across all API calls */
  totalCostUsd: number;

  /** Model used */
  model: string;

  /** Number of API calls made */
  apiCallCount: number;

  /** Response time in milliseconds */
  responseTimeMs: number;

  /** Raw telemetry payload for ai_telemetry table */
  telemetry: RawTelemetryPayload;
}

/**
 * Maximum number of tool execution loops to prevent infinite loops
 */
const MAX_TOOL_LOOPS = 5;

// ============================================================================
// In-flight AbortController registry
// Keyed by leadId. Takeover calls abort() to cancel an in-progress AI call.
// ============================================================================

export const activeAbortControllers = new Map<string, AbortController>();

/**
 * Send a message with automatic tool execution loop
 *
 * This function implements a proper agentic loop:
 * 1. Send message to Claude
 * 2. If Claude returns tool_use, execute the tools
 * 3. Send tool results back to Claude
 * 4. Repeat until Claude returns a final text response (end_turn)
 *
 * @param lead - Current lead state
 * @param conversationHistory - Previous messages
 * @param executeTools - Function to execute tool calls
 * @returns Final response with text content guaranteed
 */
export async function sendMessageWithToolLoop(
  lead: Lead,
  conversationHistory: ConversationMessage[],
  executeTools: ToolExecutor
): Promise<AgentLoopResult> {
  const startTime = Date.now();
  const anthropic = getClient();

  // Register AbortController so takeover can cancel this in-flight request
  const abortController = new AbortController();
  const { signal } = abortController;
  activeAbortControllers.set(lead.id, abortController);

  try {

  // Load account settings for prompt personalization
  const settings = await safeLoadSettings(lead.id);

  // Load active wizard-generated prompt version (if any)
  let generatedPrompt: string | null = null;
  try {
    const activeVersion = await getActiveVersionForLead(lead.id);
    if (activeVersion?.system_prompt) {
      generatedPrompt = activeVersion.system_prompt;
    }
  } catch {
    // Non-critical — fallback to default prompt assembly
  }

  // --- Hybrid routing: select model based on message complexity ---
  const lastUserMsg = conversationHistory
    .filter(m => m.role === 'user')
    .pop()?.content || '';
  const routingDecision: RoutingDecision = selectModel(lastUserMsg, conversationHistory);
  const selectedModel = routingDecision.model;
  const isHaiku = selectedModel.includes('haiku');

  // --- Dynamic context: Haiku gets leaner prompt ---
  // Adaptive history: if numbers appeared in history, Haiku needs more context
  const historyHasNumbers = conversationHistory.some(h => /\d{2,}/.test(h.content || ''));
  const historyLimit = isHaiku
    ? (historyHasNumbers ? 8 : 8)
    : 12;
  const maxTokens = isHaiku ? 280 : config.anthropic.maxTokens;

  const systemPrompt = buildPromptWithContext(conversationHistory, lead, settings, generatedPrompt);

  // Trim conversation history based on model
  const trimmedHistory = conversationHistory.slice(-historyLimit);

  // ── History sanitization: strip polluted credential claims from old bot messages ──
  const cleanedHistory = trimmedHistory.map(msg => {
    if (msg.role === 'assistant' || msg.role === 'bot') {
      return {
        ...msg,
        content: msg.content.replace(FORBIDDEN_CLAIMS, '[...]'),
      };
    }
    return msg;
  });

  let messages = formatMessagesForClaude(cleanedHistory);

  if (messages.length === 0) {
    throw new Error('No messages to send to Claude');
  }

  logger.info('[ROUTER] Model selected', {
    leadId: lead.id,
    score: routingDecision.score,
    reasons: routingDecision.reasons,
    model: selectedModel,
    historyLimit,
    maxTokens,
  });

  const executedToolCalls: ToolCall[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let model = selectedModel;
  let apiCallCount = 0;
  let finalContent = '';

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    apiCallCount++;

    logger.debug('Agent loop iteration', {
      leadId: lead.id,
      loop: loop + 1,
      messageCount: messages.length,
    });

    // Make API call (signal enables abort on human takeover)
    const response = await anthropic.messages.create({
      model: selectedModel,
      max_tokens: maxTokens,
      temperature: 0.4,
      system: buildCachedSystemBlocks(systemPrompt),
      messages,
      tools: TOOLS,
    }, { signal });

    const parsed = parseResponse(response);
    model = parsed.model;

    // Accumulate usage
    totalInputTokens += parsed.usage.inputTokens;
    totalOutputTokens += parsed.usage.outputTokens;
    totalCostUsd += parsed.costUsd;

    // Log this API call
    logClaude('agent_loop_call', {
      input: parsed.usage.inputTokens,
      output: parsed.usage.outputTokens,
    }, {
      leadId: lead.id,
      loop: loop + 1,
      hasToolUse: parsed.hasToolUse,
      toolNames: parsed.toolCalls.map((t) => t.name),
      contentLength: parsed.content.length,
    });

    // Accumulate any text content
    if (parsed.content) {
      finalContent += (finalContent ? '\n\n' : '') + parsed.content;
    }

    // If no tool use, we're done — apply post-AI guards
    if (!parsed.hasToolUse || parsed.stopReason !== 'tool_use') {
      const latencyMs = Date.now() - startTime;

      // ── Post-AI Guard 1: Numeric hallucination check ──
      const profileData: Record<string, unknown> = {};
      if (settings?.profile) {
        const p = settings.profile as Record<string, unknown>;
        if (p.price_per_lesson) profileData.price_per_lesson = p.price_per_lesson;
        if (p.price_per_lesson_frontal) profileData.price_per_lesson_frontal = p.price_per_lesson_frontal;
      }

      const validation = validateAIResponse(finalContent, profileData);
      let hasFallback = false;

      if (!validation.isClean) {
        logger.warn('[AI-GUARD] Hallucination detected! Numbers:', {
          suspicious: validation.suspiciousNumbers,
          known: validation.knownNumbers,
          leadId: lead.id,
        });

        // If Haiku failed validation → fallback to Sonnet
        if (isHaiku) {
          logger.warn('[FALLBACK] Haiku failed validation → Sonnet retry', {
            leadId: lead.id,
            issues: validation.suspiciousNumbers,
            score: routingDecision.score,
            reasons: routingDecision.reasons,
          });

          try {
            const sonnetModel = process.env.AI_MODEL_SONNET || 'claude-sonnet-4-20250514';
            const fullHistory = conversationHistory.slice(-6);
            const sonnetMessages = formatMessagesForClaude(fullHistory);

            const fallbackResponse = await anthropic.messages.create({
              model: sonnetModel,
              max_tokens: config.anthropic.maxTokens,
              temperature: 0.4,
              system: buildCachedSystemBlocks(systemPrompt),
              messages: sonnetMessages,
              tools: TOOLS,
            }, { signal });

            const fallbackParsed = parseResponse(fallbackResponse);
            totalInputTokens += fallbackParsed.usage.inputTokens;
            totalOutputTokens += fallbackParsed.usage.outputTokens;
            totalCostUsd += fallbackParsed.costUsd;
            apiCallCount++;
            model = fallbackParsed.model;
            hasFallback = true;

            const fallbackValidation = validateAIResponse(fallbackParsed.content, profileData);
            if (fallbackValidation.isClean && fallbackParsed.content.length > 0) {
              logger.info('[FALLBACK] Sonnet retry succeeded', { leadId: lead.id });
              finalContent = fallbackParsed.content;
            } else {
              logger.warn('[FALLBACK] Sonnet also has issues, using Sonnet response anyway', {
                leadId: lead.id,
              });
              if (fallbackParsed.content.length > 0) {
                finalContent = fallbackParsed.content;
              }
            }
          } catch (fallbackErr) {
            logger.error('[FALLBACK] Sonnet retry failed', {
              error: (fallbackErr as Error).message,
              leadId: lead.id,
            });
          }
        } else {
          // Sonnet hallucination retry (existing logic)
          try {
            const retryMessages: Anthropic.MessageParam[] = [
              ...messages,
              { role: 'assistant', content: finalContent },
              { role: 'user', content: 'SYSTEM WARNING: Your response contained numbers not in the profile. Regenerate without inventing any numbers. Only use numbers from TUTOR_PROFILE.' },
            ];

            const retryResponse = await anthropic.messages.create({
              model: selectedModel,
              max_tokens: maxTokens,
              temperature: 0.2,
              system: buildCachedSystemBlocks(systemPrompt),
              messages: retryMessages,
              tools: TOOLS,
            }, { signal });

            const retryParsed = parseResponse(retryResponse);
            totalInputTokens += retryParsed.usage.inputTokens;
            totalOutputTokens += retryParsed.usage.outputTokens;
            totalCostUsd += retryParsed.costUsd;
            apiCallCount++;

            const retryValidation = validateAIResponse(retryParsed.content, profileData);
            if (retryValidation.isClean && retryParsed.content.length > 0) {
              logger.info('[AI-GUARD] Retry succeeded — clean response', { leadId: lead.id });
              finalContent = retryParsed.content;
            } else {
              logger.error('[AI-GUARD] Retry STILL has suspicious numbers', {
                suspicious: retryValidation.suspiciousNumbers,
                leadId: lead.id,
              });
            }
          } catch (retryErr) {
            logger.error('[AI-GUARD] Retry API call failed', {
              error: (retryErr as Error).message,
              leadId: lead.id,
            });
          }
        }
      }

      // ── Post-AI Guard 2: CTA append — DISABLED (5.5d) ──
      // CTA is now handled by CTA_RULE in HARD_CONSTRAINTS.
      // ensureCTA() was force-appending "אשמח לתאם שיעור ניסיון" to every message,
      // overriding the AI's contextual judgment.
      // const ctaResult = ensureCTA(finalContent);
      // finalContent = ctaResult.text;
      const ctaResult = { appended: false };

      // ── Router cost log ──
      logger.info(
        `[ROUTER] score=${routingDecision.score} ` +
        `reasons=[${routingDecision.reasons}] ` +
        `model=${model} ` +
        `input_tokens=${totalInputTokens} ` +
        `output_tokens=${totalOutputTokens} ` +
        `fallback=${hasFallback}`,
        { leadId: lead.id },
      );

      logger.info('Agent loop completed', {
        leadId: lead.id,
        loops: loop + 1,
        totalToolCalls: executedToolCalls.length,
        finalContentLength: finalContent.length,
        totalTokens: totalInputTokens + totalOutputTokens,
        totalCostUsd: totalCostUsd.toFixed(4),
        hallucinationGuardTriggered: !validation.isClean,
        ctaAppended: ctaResult.appended,
        routerScore: routingDecision.score,
        routerReasons: routingDecision.reasons,
        hasFallback,
      });

      return {
        content: finalContent,
        executedToolCalls,
        totalUsage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens,
        },
        totalCostUsd,
        model,
        apiCallCount,
        responseTimeMs: latencyMs,
        telemetry: buildTelemetryPayload(
          executedToolCalls, finalContent,
          totalInputTokens, totalOutputTokens,
          latencyMs, totalCostUsd, model, false,
        ),
      };
    }

    // Execute tools and collect results
    const toolResults: Array<{
      toolCallId: string;
      result: string;
      isError?: boolean;
    }> = [];

    for (const toolCall of parsed.toolCalls) {
      executedToolCalls.push(toolCall);

      try {
        const result = await executeTools(toolCall);
        toolResults.push({
          toolCallId: toolCall.id,
          result: result.result,
          isError: result.isError,
        });

        logger.debug('Tool executed in agent loop', {
          leadId: lead.id,
          tool: toolCall.name,
          isError: result.isError,
        });
      } catch (error) {
        toolResults.push({
          toolCallId: toolCall.id,
          result: `Error executing tool: ${(error as Error).message}`,
          isError: true,
        });

        logger.error('Tool execution error in agent loop', {
          leadId: lead.id,
          tool: toolCall.name,
          error: (error as Error).message,
        });
      }
    }

    // Build the assistant message with tool_use blocks
    const assistantContent: Anthropic.ContentBlock[] = [];

    // Add any text content from this response
    if (parsed.content) {
      assistantContent.push({ type: 'text', text: parsed.content });
    }

    // Add tool_use blocks
    for (const toolCall of parsed.toolCalls) {
      assistantContent.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
      });
    }

    // Append assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: assistantContent,
    });

    // Append tool results as user message
    const toolResultContent: Anthropic.ToolResultBlockParam[] = toolResults.map((tr) => ({
      type: 'tool_result' as const,
      tool_use_id: tr.toolCallId,
      content: tr.result,
      is_error: tr.isError,
    }));

    messages.push({
      role: 'user',
      content: toolResultContent,
    });
  }

  // If we hit max loops, log warning and return what we have
  logger.warn('Agent loop hit max iterations', {
    leadId: lead.id,
    maxLoops: MAX_TOOL_LOOPS,
    executedToolCalls: executedToolCalls.length,
  });

  // If we still have no content, generate a fallback
  const isFallback = !finalContent;
  if (!finalContent) {
    finalContent = 'שלום! איך אפשר לעזור לך היום? 🙂';
  }

  // CTA guard disabled (5.5d) — handled by CTA_RULE in HARD_CONSTRAINTS

  const latencyMs = Date.now() - startTime;

  return {
    content: finalContent,
    executedToolCalls,
    totalUsage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
    },
    totalCostUsd,
    model,
    apiCallCount,
    responseTimeMs: latencyMs,
    telemetry: buildTelemetryPayload(
      executedToolCalls, finalContent,
      totalInputTokens, totalOutputTokens,
      latencyMs, totalCostUsd, model, isFallback,
    ),
  };
  } finally {
    // Always clean up the AbortController registration
    activeAbortControllers.delete(lead.id);
  }
}

// ============================================================================
// Tool Validation
// ============================================================================

/**
 * Validate update_lead_state tool input
 */
export function validateUpdateLeadStateInput(
  input: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check status is not 'booked'
  if (input.status === 'booked') {
    errors.push("Cannot set status to 'booked' directly. Use 'ready_to_book' instead.");
  }

  // Validate level
  if (input.level && !['elementary', 'middle_school', 'high_school', 'college'].includes(input.level as string)) {
    errors.push(`Invalid level: ${input.level}`);
  }

  // Validate format_preference
  if (input.format_preference && !['zoom', 'frontal', 'undecided'].includes(input.format_preference as string)) {
    errors.push(`Invalid format_preference: ${input.format_preference}`);
  }

  // Validate urgency
  if (input.urgency && !['high', 'medium', 'low'].includes(input.urgency as string)) {
    errors.push(`Invalid urgency: ${input.urgency}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate send_interactive_message tool input
 */
export function validateInteractiveMessageInput(
  input: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const messageType = input.message_type as string | undefined;
  if (!messageType || !['reply_buttons', 'list', 'cta_url'].includes(messageType)) {
    errors.push('Invalid or missing message_type');
  }

  if (!input.body_text || typeof input.body_text !== 'string') {
    errors.push('Missing body_text');
  }

  if (messageType === 'reply_buttons') {
    const buttons = input.reply_buttons as Array<{ id?: string; title?: string }> | undefined;
    if (!buttons || !Array.isArray(buttons) || buttons.length === 0) {
      errors.push('reply_buttons type requires reply_buttons array');
    } else {
      if (buttons.length > 3) {
        errors.push('Maximum 3 reply_buttons allowed');
      }
      for (const btn of buttons) {
        if (!btn.id || !btn.title) {
          errors.push('Each button must have id and title');
        }
        if (btn.title && btn.title.length > 20) {
          errors.push(`Button title too long: ${btn.title}`);
        }
      }
    }
  }

  if (messageType === 'list') {
    const sections = input.list_sections as Array<unknown> | undefined;
    if (!sections || !Array.isArray(sections) || sections.length === 0) {
      errors.push('list type requires list_sections array');
    } else if (sections.length > 3) {
      errors.push('Maximum 3 list_sections allowed');
    }
    if (!input.list_button_text || typeof input.list_button_text !== 'string') {
      errors.push('list type requires list_button_text');
    }
  }

  if (messageType === 'cta_url') {
    if (!input.cta_url || typeof input.cta_url !== 'string') {
      errors.push('cta_url type requires cta_url string');
    }
    if (!input.cta_display_text || typeof input.cta_display_text !== 'string') {
      errors.push('cta_url type requires cta_display_text string');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Exports
// ============================================================================

export {
  TOOLS,
  UPDATE_LEAD_STATE_TOOL,
  SEND_INTERACTIVE_MESSAGE_TOOL,
  calculateCost,
  PRICING,
};

export type { ConversationMessage, ToolCall };
