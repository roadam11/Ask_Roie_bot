/**
 * WhatsApp 24-Hour Window Utilities
 *
 * WhatsApp Business API has a 24-hour messaging window policy:
 * - Within 24 hours of user's last message: Can send freeform messages
 * - After 24 hours: Must use pre-approved message templates
 *
 * These helpers determine which messaging mode to use.
 */

const WINDOW_HOURS = 24;

/**
 * Check if we're within the 24-hour messaging window
 *
 * @param lastUserMessageAt - Timestamp of the user's last message
 * @returns true if within 24 hours, false otherwise
 */
export function isWithin24HourWindow(lastUserMessageAt: Date | null): boolean {
  if (!lastUserMessageAt) return false;

  const hoursSinceLastMessage =
    (Date.now() - lastUserMessageAt.getTime()) / (1000 * 60 * 60);

  return hoursSinceLastMessage < WINDOW_HOURS;
}

/**
 * Check if we can send a freeform (non-template) message
 *
 * @param lastUserMessageAt - Timestamp of the user's last message
 * @returns true if freeform messages are allowed
 */
export function canSendFreeformMessage(lastUserMessageAt: Date | null): boolean {
  return isWithin24HourWindow(lastUserMessageAt);
}

/**
 * Check if we must use a template message
 *
 * @param lastUserMessageAt - Timestamp of the user's last message
 * @returns true if only template messages are allowed
 */
export function mustUseTemplate(lastUserMessageAt: Date | null): boolean {
  return !isWithin24HourWindow(lastUserMessageAt);
}

/**
 * Get remaining hours in the messaging window
 *
 * @param lastUserMessageAt - Timestamp of the user's last message
 * @returns Hours remaining, or 0 if window has expired
 */
export function getWindowRemainingHours(lastUserMessageAt: Date | null): number {
  if (!lastUserMessageAt) return 0;

  const hoursSinceLastMessage =
    (Date.now() - lastUserMessageAt.getTime()) / (1000 * 60 * 60);

  const remaining = WINDOW_HOURS - hoursSinceLastMessage;
  return remaining > 0 ? remaining : 0;
}

/**
 * Get window expiration timestamp
 *
 * @param lastUserMessageAt - Timestamp of the user's last message
 * @returns Expiration date, or null if no message
 */
export function getWindowExpiration(lastUserMessageAt: Date | null): Date | null {
  if (!lastUserMessageAt) return null;

  return new Date(lastUserMessageAt.getTime() + WINDOW_HOURS * 60 * 60 * 1000);
}

// Usage example:
// if (mustUseTemplate(lead.last_user_message_at)) {
//   await sendTemplateMessage(...);
// } else {
//   await sendFreeformMessage(...);
// }
