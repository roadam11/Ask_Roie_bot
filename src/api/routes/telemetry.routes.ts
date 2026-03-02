/**
 * Telemetry Routes - AI telemetry and decision path endpoints
 */
import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { query } from '../../database/connection.js';

const router = Router();

// Get AI telemetry for a lead
router.get('/lead/:leadId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { leadId } = req.params;
  const { limit = '50' } = req.query;
  const accountId = req.user?.accountId;

  const result = await query(
    `SELECT t.* FROM ai_telemetry t
     JOIN leads l ON t.lead_id = l.id
     LEFT JOIN agents a ON l.agent_id = a.id
     WHERE t.lead_id = $1
       AND ($3::uuid IS NULL OR a.account_id = $3)
     ORDER BY t.created_at DESC
     LIMIT $2`,
    [leadId, Math.min(100, Number(limit)), accountId || null]
  );
  const telemetry = result.rows;

  return res.json({ telemetry });
});

// Get decision timeline for a conversation
router.get('/conversation/:conversationId/timeline', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { conversationId } = req.params;
  const accountId = req.user?.accountId;

  const result = await query(
    `SELECT t.* FROM ai_telemetry t
     JOIN leads l ON t.lead_id = l.id
     LEFT JOIN agents a ON l.agent_id = a.id
     WHERE t.conversation_id = $1
       AND ($2::uuid IS NULL OR a.account_id = $2)
     ORDER BY t.created_at ASC`,
    [conversationId, accountId || null]
  );
  const events = result.rows;

  return res.json({
    timeline: events.map((e: Record<string, unknown>) => ({
      timestamp: e.created_at,
      intent: e.detected_intent,
      confidence: e.intent_confidence,
      reasoning: e.reasoning,
      toolCalls: e.tool_calls,
      decisionPath: e.decision_path,
    }))
  });
});

// Get decision path details
router.get('/conversation/:conversationId/decision-path', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { conversationId } = req.params;
  const accountId = req.user?.accountId;

  const result = await query(
    `SELECT t.decision_path, t.entities_extracted, t.reasoning, t.tool_calls, t.created_at
     FROM ai_telemetry t
     JOIN leads l ON t.lead_id = l.id
     LEFT JOIN agents a ON l.agent_id = a.id
     WHERE t.conversation_id = $1
       AND t.decision_path IS NOT NULL
       AND ($2::uuid IS NULL OR a.account_id = $2)
     ORDER BY t.created_at DESC`,
    [conversationId, accountId || null]
  );
  const paths = result.rows;

  return res.json({
    decisionPaths: paths.map((t: Record<string, unknown>) => ({
      timestamp: t.created_at,
      path: t.decision_path,
      entities: t.entities_extracted,
      reasoning: t.reasoning,
      tools: t.tool_calls,
    }))
  });
});

// Get latest telemetry for a message
router.get('/message/:messageId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { messageId } = req.params;
  const accountId = req.user?.accountId;

  const result = await query(
    `SELECT t.* FROM ai_telemetry t
     JOIN leads l ON t.lead_id = l.id
     LEFT JOIN agents a ON l.agent_id = a.id
     WHERE t.message_id = $1
       AND ($2::uuid IS NULL OR a.account_id = $2)
     ORDER BY t.created_at DESC
     LIMIT 1`,
    [messageId, accountId || null]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Telemetry not found' });
  }

  return res.json({ telemetry: result.rows[0] });
});

export default router;
