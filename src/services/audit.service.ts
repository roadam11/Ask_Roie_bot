/**
 * Audit Log Service
 *
 * Fire-and-forget audit trail for all data-modifying operations.
 * Automatically captures requestId from AsyncLocalStorage.
 * Never blocks or throws — errors are logged as warnings.
 */

import { query } from '../database/connection.js';
import { getRequestContext } from '../utils/request-context.js';
import logger from '../utils/logger.js';

export interface AuditEntry {
  accountId: string;
  userId?: string;
  action: string;        // 'lead.updated' | 'lead.deleted' | 'settings.updated' | etc.
  entityType: string;    // 'lead' | 'conversation' | 'settings' | 'knowledge' | 'user' | 'message'
  entityId?: string;
  beforeData?: Record<string, unknown>;
  afterData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Log an audit entry — fire-and-forget.
 * Never throws; errors are logged as warnings.
 */
export function logAudit(entry: AuditEntry): void {
  const ctx = getRequestContext();
  const requestId = ctx?.requestId ?? null;

  // Strip sensitive fields from before/after data
  const sanitize = (data: Record<string, unknown> | undefined): string | null => {
    if (!data) return null;
    const copy = { ...data };
    delete copy.password;
    delete copy.password_hash;
    delete copy.token;
    delete copy.accessToken;
    delete copy.refreshToken;
    return JSON.stringify(copy);
  };

  query(
    `INSERT INTO audit_logs (account_id, user_id, request_id, action, entity_type, entity_id, before_data, after_data, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)`,
    [
      entry.accountId,
      entry.userId ?? null,
      requestId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      sanitize(entry.beforeData),
      sanitize(entry.afterData),
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    ],
  ).catch((err: unknown) => {
    logger.warn('Audit log insert failed', { error: err, action: entry.action, entityType: entry.entityType });
  });
}
