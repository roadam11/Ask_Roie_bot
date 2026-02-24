/**
 * Follow-up Messages Configuration
 *
 * Marketing-optimized messages for automated follow-ups.
 * All messages include Calendly links for easy booking.
 *
 * CRITICAL: All time calculations in UTC to prevent timezone bugs
 */

import type { AutomationFollowUpType } from '../types/index.js';

// ============================================================================
// Constants
// ============================================================================

export const CALENDLY_LINK = 'https://calendly.com/roadam11/meet-with-me';

// Priority levels (0-100, higher = more important)
export const FOLLOW_UP_PRIORITIES: Record<AutomationFollowUpType, number> = {
  trial_reminder_2h: 100,    // Highest - don't miss the lesson!
  trial_followup_24h: 95,    // Very high - strike while iron is hot
  thinking_24h: 80,          // High - they showed interest
  idle_48h: 50,              // Medium - re-engagement attempt
};

// ============================================================================
// Message Templates
// ============================================================================

export interface FollowUpMessageConfig {
  /** The message text with optional placeholders */
  text: string;
  /** Priority level (0-100, higher = send first) */
  priority: number;
  /** Human-readable description for logging */
  description: string;
  /** Placeholders that can be substituted */
  placeholders?: string[];
}

/**
 * Follow-up message templates - PREMIUM POSITIONED
 *
 * Placeholders:
 * - {time} - Trial lesson time (for reminders)
 * - {zoom_link} - Zoom meeting link
 * - {name} - Lead's name (if known)
 * - {subject} - Subject they're interested in
 */
export const FOLLOW_UP_MESSAGES: Record<AutomationFollowUpType, FollowUpMessageConfig> = {
  /**
   * thinking_24h - 24 hours after "אחשוב על זה"
   *
   * Goal: Create urgency with scarcity + relate to their subject
   * Tone: Personal, expert sharing, soft scarcity
   */
  thinking_24h: {
    text: `היי! בדיוק סיימתי להעביר שיעור על אנרגיה ומכניקה ונזכרתי בשיחה שלנו. הרבה תלמידים מסתבכים שם כי מנסים לשנן במקום להבין את העיקרון.

בכל מקרה, אם החלטת שאתה רוצה לעשות סדר ולקפוץ למים, השבוע נשארו לי 2 משבצות אחרונות לשיעורי ניסיון. הנה הלינק לתיאום:
${CALENDLY_LINK}`,
    priority: FOLLOW_UP_PRIORITIES.thinking_24h,
    description: '24h after user said they need to think - scarcity play',
    placeholders: [],
  },

  /**
   * trial_reminder_2h - 2 hours before trial lesson
   *
   * Goal: Ensure they show up, reduce no-shows
   * Tone: Friendly reminder with all needed info
   */
  trial_reminder_2h: {
    text: `תזכורת ידידותית - שיעור הניסיון שלנו היום ב-{time}

הקישור לזום: {zoom_link}

מצפה לראות אותך! 🙂`,
    priority: FOLLOW_UP_PRIORITIES.trial_reminder_2h,
    description: '2h before trial lesson - reduce no-shows',
    placeholders: ['time', 'zoom_link'],
  },

  /**
   * trial_followup_24h - 24 hours after trial lesson
   *
   * Goal: Get feedback, convert to paying student
   * Tone: Caring, asking for feedback, soft CTA with "reserve spot" framing
   */
  trial_followup_24h: {
    text: `היי! איך היה השיעור אתמול?

אשמח לשמוע איך הרגשת ואם יש משהו שתרצה לשפר.

אם תרצה להמשיך באופן קבוע, אפשר לשריין מקום כאן:
${CALENDLY_LINK}`,
    priority: FOLLOW_UP_PRIORITIES.trial_followup_24h,
    description: '24h after trial - convert to paying student',
    placeholders: [],
  },

  /**
   * idle_48h - 48 hours with no response
   *
   * Goal: Re-engage with empathy, give easy exit, clean waitlist framing
   * Tone: Understanding, low pressure, scarcity without being pushy
   */
  idle_48h: {
    text: `היי, ראיתי שהשיחה שלנו נעצרה. הכל בסדר, תקופת מבחנים זה עמוס!

אני מנקה עכשיו את רשימת ההמתנה שלי לקראת שבוע הבא - להשאיר אותך ברשימה או שכרגע פחות רלוונטי לשריין לך מקום? בקלילות 🙂`,
    priority: FOLLOW_UP_PRIORITIES.idle_48h,
    description: '48h no response - waitlist cleanup framing',
    placeholders: [],
  },
};

// ============================================================================
// Message Building Helpers
// ============================================================================

/**
 * Build a follow-up message with placeholder substitution
 *
 * @param type - Follow-up type
 * @param data - Placeholder values
 * @returns Formatted message text
 */
export function buildFollowUpMessage(
  type: AutomationFollowUpType,
  data: Record<string, string> = {}
): string {
  const config = FOLLOW_UP_MESSAGES[type];
  let message = config.text;

  // Substitute placeholders
  for (const [key, value] of Object.entries(data)) {
    message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }

  return message;
}

/**
 * Get the priority for a follow-up type
 */
export function getFollowUpPriority(type: AutomationFollowUpType): number {
  return FOLLOW_UP_PRIORITIES[type];
}

/**
 * Check if one follow-up type has higher priority than another
 */
export function hasHigherPriority(
  newType: AutomationFollowUpType,
  existingType: AutomationFollowUpType
): boolean {
  return FOLLOW_UP_PRIORITIES[newType] > FOLLOW_UP_PRIORITIES[existingType];
}

// ============================================================================
// Timing Constants
// CRITICAL: UTC math only - prevents 2AM messages
// ============================================================================

/**
 * Follow-up delay configurations in milliseconds
 */
export const FOLLOW_UP_DELAYS: Record<AutomationFollowUpType, number> = {
  thinking_24h: 24 * 60 * 60 * 1000,      // 24 hours
  trial_reminder_2h: 2 * 60 * 60 * 1000,  // 2 hours (before trial)
  trial_followup_24h: 24 * 60 * 60 * 1000, // 24 hours (after trial)
  idle_48h: 48 * 60 * 60 * 1000,           // 48 hours
};

/**
 * Calculate the scheduled time for a follow-up
 * CRITICAL: UTC math only - prevents 2AM messages
 *
 * @param type - Follow-up type
 * @param referenceTime - Reference time (e.g., when user said "אחשוב", trial time, last message)
 * @returns Scheduled time as UTC Date
 */
export function calculateFollowUpTime(
  type: AutomationFollowUpType,
  referenceTime: Date
): Date {
  // CRITICAL: UTC math only - prevents 2AM messages
  const refMs = referenceTime.getTime();

  switch (type) {
    case 'trial_reminder_2h':
      // 2 hours BEFORE trial
      return new Date(refMs - FOLLOW_UP_DELAYS.trial_reminder_2h);

    case 'thinking_24h':
    case 'trial_followup_24h':
    case 'idle_48h':
      // Delay AFTER reference time
      return new Date(refMs + FOLLOW_UP_DELAYS[type]);

    default:
      // TypeScript exhaustiveness check
      const _exhaustive: never = type;
      throw new Error(`Unknown follow-up type: ${_exhaustive}`);
  }
}

// ============================================================================
// Exports
// ============================================================================

export default FOLLOW_UP_MESSAGES;
