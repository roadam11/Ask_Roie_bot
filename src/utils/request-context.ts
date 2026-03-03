/**
 * Request Context via AsyncLocalStorage
 *
 * Stores per-request metadata (requestId, accountId, route) that is
 * automatically available to the Winston logger without passing it
 * through every function call.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  accountId?: string;
  route?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Get the current request context (if any).
 * Returns undefined when called outside a request lifecycle.
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}
