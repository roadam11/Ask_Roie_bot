/**
 * Request ID Middleware
 *
 * Assigns a unique requestId (UUID v4) to every incoming request.
 * - Accepts an external X-Request-Id header for distributed tracing
 * - Sets the X-Request-Id response header so clients can reference it
 * - Wraps the remaining handler chain inside AsyncLocalStorage so the
 *   requestId is available to the logger (and anything else) automatically
 */

import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { requestContext } from '../../utils/request-context.js';

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId =
    (req.headers['x-request-id'] as string | undefined) || randomUUID();

  // Attach to the request object (typed via express.d.ts)
  req.requestId = requestId;

  // Echo back to the client
  res.setHeader('X-Request-Id', requestId);

  // Run the rest of the middleware/route chain inside AsyncLocalStorage
  // so every logger call within this request picks up the context.
  requestContext.run({ requestId }, () => {
    next();
  });
}
