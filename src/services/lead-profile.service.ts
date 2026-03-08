/**
 * Lead Profile Service (Sprint 5.6)
 *
 * Extracts structured data from conversation messages using regex.
 * No extra API calls — runs after each AI response.
 * Saves profile to leads.lead_profile JSONB column.
 */

import { query } from '../database/connection.js';
import logger from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface LeadProfile {
  name?: string;
  role?: string;           // תלמיד / הורה
  grade?: string;          // כיתה
  subject?: string;        // מקצוע
  topic?: string;          // נושא ספציפי
  exam_date?: string;      // תאריך מבחן
  urgency?: string;        // exam / regular
  format?: string;         // זום / פרונטלי
  preferred_time?: string; // ערב / בוקר / specific time
  location?: string;       // עיר / אזור
  booking_ready?: boolean; // true when enough info to close
  notes?: string;          // anything else mentioned
}

// ============================================================================
// Extraction Patterns
// ============================================================================

const SUBJECTS = [
  'מתמטיקה', 'פיזיקה', 'אנגלית', 'כימיה', 'ביולוגיה',
  'מדעי המחשב', 'היסטוריה', 'ספרות', 'תנ"ך', 'ערבית',
  'מתכונת', 'בגרות', 'חשבון', 'גיאוגרפיה', 'אזרחות',
];

const TOPICS = [
  'מכניקה', 'חשמל', 'אופטיקה', 'סדרות', 'הסתברות',
  'גיאומטריה', 'אלגברה', 'טריגונומטריה', 'אינטגרלים',
  'נגזרות', 'וקטורים', 'פונקציות', 'משוואות', 'גבולות',
  'סטטיסטיקה', 'קומבינטוריקה', 'חדו"א',
];

const CITIES = [
  'תל אביב', 'ירושלים', 'חיפה', 'באר שבע', 'רעננה',
  'הרצליה', 'כפר סבא', 'רמת גן', 'פתח תקווה', 'נתניה',
  'ראשון לציון', 'אשדוד', 'כוכב יאיר', 'צור יגאל',
  'הוד השרון', 'רמת השרון', 'גבעתיים', 'רחובות',
];

// ============================================================================
// Extraction Logic
// ============================================================================

/**
 * Extract structured lead profile data from conversation messages.
 * Merges with existing profile — never overwrites with empty values.
 */
export function extractLeadProfile(
  messages: Array<{ role: string; content: string }>,
  existingProfile: LeadProfile,
): LeadProfile {
  const profile: LeadProfile = { ...existingProfile };

  // Only process user messages
  const userMessages = messages.filter(m => m.role === 'user');

  for (const msg of userMessages) {
    const text = msg.content;
    const lower = text.toLowerCase();

    // Grade detection
    const gradeMatch = text.match(/כיתה\s*([\u05d0-\u05ea"׳]+|\d+)/);
    if (gradeMatch) {
      profile.grade = gradeMatch[1].trim();
    } else if (/^אני ב/.test(text)) {
      const match = text.match(/^אני ב(.{1,10})/);
      if (match) profile.grade = match[1].trim();
    }

    // Subject detection
    for (const subj of SUBJECTS) {
      if (text.includes(subj)) {
        profile.subject = subj;
        break;
      }
    }

    // Topic detection
    for (const topic of TOPICS) {
      if (text.includes(topic)) {
        profile.topic = topic;
        break;
      }
    }

    // Format detection
    if (lower.includes('זום') || lower.includes('zoom')) profile.format = 'זום';
    if (text.includes('פרונטלי') || text.includes('פנים אל פנים')) profile.format = 'פרונטלי';

    // Exam/urgency detection
    if (/מבחן|בחינה|בגרות|מתכונת/.test(text)) {
      profile.urgency = 'exam';
      const timeMatch = text.match(/(עוד\s+\S+|בעוד\s+\S+|השבוע|מחר|שבוע הבא|חודש הבא)/);
      if (timeMatch) profile.exam_date = timeMatch[0];
    }

    // Time preference detection
    const timePrefMatch = text.match(/(בערב|אחה"צ|אחהצ|בבוקר|בצהריים)/);
    if (timePrefMatch) profile.preferred_time = timePrefMatch[0];

    const specificTimeMatch = text.match(/(\d{1,2}:\d{2})/);
    if (specificTimeMatch) profile.preferred_time = specificTimeMatch[0];

    // Day/time like "מחר בערב" or "יום שלישי"
    const dayMatch = text.match(/(מחר|היום|יום\s*(ראשון|שני|שלישי|רביעי|חמישי|שישי))/);
    if (dayMatch) {
      profile.preferred_time = profile.preferred_time
        ? `${dayMatch[0]} ${profile.preferred_time}`
        : dayMatch[0];
    }

    // Role detection
    if (text.includes('תלמיד') || /^אני ב/.test(text)) profile.role = 'תלמיד';
    if (text.includes('הורה') || text.includes('הבן שלי') || text.includes('הבת שלי') || text.includes('הילד')) profile.role = 'הורה';

    // Location detection
    for (const city of CITIES) {
      if (text.includes(city)) {
        profile.location = city;
        break;
      }
    }

    // Name detection (from "אני X" pattern, only if short)
    if (!profile.name) {
      const nameMatch = text.match(/(?:קוראים לי|שמי|אני)\s+([^\s,.\d]{2,15})\b/);
      if (nameMatch && !['ב', 'מ', 'תלמיד', 'הורה', 'מחפש', 'צריך', 'רוצה', 'לומד'].includes(nameMatch[1])) {
        profile.name = nameMatch[1];
      }
    }
  }

  // Determine booking readiness
  profile.booking_ready = !!profile.subject && !!profile.preferred_time;

  return profile;
}

// ============================================================================
// DB Operations
// ============================================================================

/**
 * Load lead profile from DB.
 */
export async function loadLeadProfile(leadId: string): Promise<LeadProfile> {
  try {
    const result = await query<{ lead_profile: LeadProfile }>(
      `SELECT lead_profile FROM leads WHERE id = $1`,
      [leadId],
    );
    return (result.rows[0]?.lead_profile as LeadProfile) || {};
  } catch {
    return {};
  }
}

/**
 * Save lead profile to DB.
 */
export async function saveLeadProfile(leadId: string, profile: LeadProfile): Promise<void> {
  try {
    await query(
      `UPDATE leads SET lead_profile = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(profile), leadId],
    );
    logger.info(`[PROFILE_UPDATE] lead_id=${leadId} profile=${JSON.stringify(profile)}`);
  } catch (err) {
    logger.error(`[PROFILE_ERR] lead_id=${leadId} save_failed`, {
      error: (err as Error).message,
    });
  }
}
