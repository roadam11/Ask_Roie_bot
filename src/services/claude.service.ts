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
  'claude-3-haiku-20240307': {
    input: 0.25,
    output: 1.25,
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
'lost' can be set from any status.`,
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
  description: `Send an interactive WhatsApp message with buttons. Use this for:
- Sending Calendly booking link
- Offering format choice (Zoom vs Frontal)
- Quick reply options

The message will be sent after your text response.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        enum: ['button', 'list'],
        description: 'Type of interactive message',
      },
      body: {
        type: 'string',
        description: 'Main message body text',
      },
      buttons: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Button identifier',
            },
            title: {
              type: 'string',
              description: 'Button label (max 20 chars)',
            },
          },
          required: ['id', 'title'],
        },
        description: 'Buttons for interactive message (max 3)',
      },
      header: {
        type: 'string',
        description: 'Optional header text',
      },
      footer: {
        type: 'string',
        description: 'Optional footer text',
      },
    },
    required: ['type', 'body'],
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
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: config.anthropic.apiKey,
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

  // Build system prompt with lead state and conversation context
  const systemPrompt = buildPromptWithContext(conversationHistory, lead);

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
        system: systemPrompt,
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
      system: systemPrompt,
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

  // Build system prompt
  const systemPrompt = buildPromptWithContext(conversationHistory, lead);

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
      system: systemPrompt,
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
}

/**
 * Maximum number of tool execution loops to prevent infinite loops
 */
const MAX_TOOL_LOOPS = 5;

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
  const anthropic = getClient();
  const systemPrompt = buildPromptWithContext(conversationHistory, lead);
  let messages = formatMessagesForClaude(conversationHistory);

  if (messages.length === 0) {
    throw new Error('No messages to send to Claude');
  }

  const executedToolCalls: ToolCall[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let model = config.anthropic.model;
  let apiCallCount = 0;
  let finalContent = '';

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    apiCallCount++;

    logger.debug('Agent loop iteration', {
      leadId: lead.id,
      loop: loop + 1,
      messageCount: messages.length,
    });

    // Make API call
    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: config.anthropic.maxTokens,
      system: systemPrompt,
      messages,
      tools: TOOLS,
    });

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

    // If no tool use, we're done
    if (!parsed.hasToolUse || parsed.stopReason !== 'tool_use') {
      logger.info('Agent loop completed', {
        leadId: lead.id,
        loops: loop + 1,
        totalToolCalls: executedToolCalls.length,
        finalContentLength: finalContent.length,
        totalTokens: totalInputTokens + totalOutputTokens,
        totalCostUsd: totalCostUsd.toFixed(4),
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
  if (!finalContent) {
    finalContent = 'שלום! איך אפשר לעזור לך היום? 🙂';
  }

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
  };
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

  if (!input.type || !['button', 'list'].includes(input.type as string)) {
    errors.push('Invalid or missing type');
  }

  if (!input.body || typeof input.body !== 'string') {
    errors.push('Missing body text');
  }

  if (input.buttons && Array.isArray(input.buttons)) {
    if (input.buttons.length > 3) {
      errors.push('Maximum 3 buttons allowed');
    }
    for (const btn of input.buttons as Array<{ id?: string; title?: string }>) {
      if (!btn.id || !btn.title) {
        errors.push('Each button must have id and title');
      }
      if (btn.title && btn.title.length > 20) {
        errors.push(`Button title too long: ${btn.title}`);
      }
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
