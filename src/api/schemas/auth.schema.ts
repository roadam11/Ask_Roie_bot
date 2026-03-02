/**
 * Auth Zod Schemas
 *
 * Validation schemas for authentication endpoints.
 */

import { z } from 'zod';

/** POST /api/auth/login */
export const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
}).strip();

/** POST /api/auth/change-password */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
}).strip();
