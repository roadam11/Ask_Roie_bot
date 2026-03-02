/**
 * Request Body Validation Middleware
 *
 * Validates req.body against a Zod schema before the controller runs.
 * Returns 400 with field-level error details on validation failure.
 * Strips unknown fields from the request body.
 */

import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema, ZodError } from 'zod';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const zodError = result.error as ZodError;
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: zodError.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        },
      });
      return;
    }

    req.body = result.data;
    next();
  };
}
