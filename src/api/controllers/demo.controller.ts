/**
 * Demo Controller — Activation Engine
 *
 * POST /api/demo/simulate-lead
 * Creates a demo lead, runs the real AI pipeline, and returns the result.
 * Rate limited to 3 demos per tenant.
 */

import { Response } from 'express';
import { query, queryOne } from '../../database/connection.js';
import logger from '../../utils/logger.js';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import * as MessageService from '../../services/message.service.js';
import { sendMessageWithToolLoop } from '../../services/claude.service.js';
import type { ToolExecutor } from '../../services/claude.service.js';
import type { Lead } from '../../types/index.js';
import { getWebSocketServer } from '../../realtime/ws-server.js';
import {
  emitLeadCreated,
  emitConversationUpdated,
  emitOverviewRefresh,
} from '../../realtime/emitter.js';

const DEMO_PHONE = '0500000000';
const DEMO_LEAD_NAME = 'תלמיד לדוגמה';
const DEMO_MESSAGE = 'היי, אני מחפש/ת מורה פרטי למתמטיקה לכיתה י׳. כמה עולה שיעור?';
const MAX_DEMOS_PER_TENANT = 3;

function accountId(req: AuthenticatedRequest): string {
  return req.user?.accountId ?? '00000000-0000-0000-0000-000000000001';
}

export async function simulateLead(req: AuthenticatedRequest, res: Response): Promise<void> {
  const aid = accountId(req);

  try {
    // Rate limit: max 3 demos per tenant
    const demoCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM leads l
       LEFT JOIN agents a ON l.agent_id = a.id
       WHERE l.is_demo = true AND a.account_id = $1`,
      [aid],
    );

    if (parseInt(demoCount?.count ?? '0', 10) >= MAX_DEMOS_PER_TENANT) {
      res.status(429).json({
        code: 'DEMO_LIMIT_REACHED',
        message: 'Maximum demo simulations reached (3)',
      });
      return;
    }

    // Find teacher's agent
    const agent = await queryOne<{ id: string }>(
      `SELECT id FROM agents WHERE account_id = $1 LIMIT 1`,
      [aid],
    );

    if (!agent) {
      res.status(400).json({ code: 'NO_AGENT', message: 'No agent found for account' });
      return;
    }

    // Create demo lead
    const leadRes = await queryOne<{ id: string }>(
      `INSERT INTO leads (phone, name, is_demo, agent_id, status, lead_state)
       VALUES ($1, $2, true, $3, 'new', 'new')
       RETURNING id`,
      [DEMO_PHONE, DEMO_LEAD_NAME, agent.id],
    );

    if (!leadRes) {
      res.status(500).json({ code: 'LEAD_CREATE_FAILED', message: 'Failed to create demo lead' });
      return;
    }

    const leadId = leadRes.id;
    logger.info('[DEMO] Demo lead created', { leadId, agentId: agent.id, accountId: aid });

    // Build a Lead object for the AI pipeline
    const lead: Lead = {
      id: leadId,
      phone: DEMO_PHONE,
      name: DEMO_LEAD_NAME,
      status: 'new',
      is_demo: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Create conversation for demo lead
    const convRes = await queryOne<{ id: string }>(
      `INSERT INTO conversations (lead_id, agent_id, started_at, status, channel, ai_stage, message_count, last_message, last_message_at)
       VALUES ($1, $2, NOW(), 'active', 'demo', 'qualifying', 1, $3, NOW())
       RETURNING id`,
      [leadId, agent.id, DEMO_MESSAGE.slice(0, 200)],
    );

    if (!convRes) {
      res.status(500).json({ code: 'CONV_CREATE_FAILED', message: 'Failed to create conversation' });
      return;
    }

    const conversationId = convRes.id;
    logger.info('[DEMO] Conversation created', { conversationId, leadId });

    // Save student message (linked to conversation)
    await MessageService.createUserMessage(leadId, DEMO_MESSAGE, undefined, conversationId);

    // Tool executor that skips WhatsApp sends for demo leads
    const toolExecutor: ToolExecutor = async (toolCall) => {
      if (toolCall.name === 'send_interactive_message' || toolCall.name === 'send_whatsapp_message') {
        logger.info('[DEMO] Skipping WhatsApp tool for demo lead', {
          tool: toolCall.name,
          leadId,
        });
        return { result: 'Skipped: demo lead (no real WhatsApp number)', isError: false };
      }

      // For other tools (like update_lead_state), execute normally
      // Import and call the default tool executor from whatsapp controller would be complex,
      // so we handle the common tools inline
      if (toolCall.name === 'update_lead_state') {
        const input = toolCall.input as Record<string, unknown>;
        const newState = input.new_state as string | undefined;
        const newStatus = input.new_status as string | undefined;

        const updates: string[] = ['updated_at = NOW()'];
        const params: unknown[] = [];
        let pi = 1;

        if (newState) {
          updates.push(`lead_state = $${pi}`);
          params.push(newState);
          pi++;
        }
        if (newStatus) {
          updates.push(`status = $${pi}`);
          params.push(newStatus);
          pi++;
        }

        if (updates.length > 1) {
          params.push(leadId);
          await query(
            `UPDATE leads SET ${updates.join(', ')} WHERE id = $${pi}`,
            params,
          );
        }

        return { result: JSON.stringify({ success: true, new_state: newState, new_status: newStatus }), isError: false };
      }

      // Unknown tool — log and return gracefully
      logger.warn('[DEMO] Unknown tool in demo pipeline', { tool: toolCall.name });
      return { result: `Tool ${toolCall.name} not available in demo mode`, isError: false };
    };

    // Run REAL AI pipeline with teacher's settings
    logger.info('[DEMO] Starting AI pipeline', { leadId });
    const aiResult = await sendMessageWithToolLoop(
      lead,
      [{ role: 'user', content: DEMO_MESSAGE }],
      toolExecutor,
    );

    logger.info('[DEMO] AI pipeline completed', {
      leadId,
      contentLength: aiResult.content?.length ?? 0,
      toolCalls: aiResult.executedToolCalls.length,
      responseTimeMs: aiResult.responseTimeMs,
    });

    // Save AI response
    if (aiResult.content) {
      await MessageService.createBotMessage(
        leadId,
        aiResult.content,
        aiResult.totalUsage.totalTokens,
        aiResult.model,
        aiResult.responseTimeMs,
        aiResult.executedToolCalls.map(tc => tc.name),
        conversationId,
      );

      // Update conversation with last message
      await query(
        `UPDATE conversations SET last_message = $1, last_message_at = NOW(), message_count = message_count + 1
         WHERE id = $2`,
        [aiResult.content.slice(0, 200), conversationId],
      );
    }

    // Update activation_status (monotonic: none → demo only if currently none)
    await query(
      `UPDATE settings SET profile = profile || '{"activation_status":"demo"}'::jsonb
       WHERE account_id = $1 AND (profile->>'activation_status' = 'none' OR profile->>'activation_status' IS NULL)`,
      [aid],
    );

    // Emit WS events
    const wss = getWebSocketServer();
    if (wss) {
      emitLeadCreated(wss, leadId, aid);
      emitConversationUpdated(wss, conversationId, 'open', aid);
      emitOverviewRefresh(wss, aid);
    }

    res.json({
      lead_id: leadId,
      conversation_id: conversationId,
      activation_status: 'demo',
    });

  } catch (err) {
    const error = err as Error;
    logger.error('[DEMO] simulate-lead failed', {
      error: error.message,
      stack: error.stack,
      accountId: aid,
    });
    res.status(500).json({
      code: 'DEMO_FAILED',
      message: 'Demo simulation failed',
      detail: error.message,
    });
  }
}
