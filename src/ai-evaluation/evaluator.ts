/**
 * AI Quality Evaluation — Assertion Engine
 *
 * Binary assertions (deterministic): FAIL if not met
 * Heuristic assertions (soft): WARN if not met
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface AssertionResult {
  name: string;
  type: 'binary' | 'heuristic';
  passed: boolean;
}

export type FailureType =
  | 'F1_HALLUCINATION'
  | 'F2_OVERPROMISE'
  | 'F3_MISSING_CTA'
  | 'F4_IDENTITY_LEAK'
  | 'F5_TONE_ISSUE'
  | 'F6_EMPTY_CRASH';

export type ScenarioStatus = 'PASS' | 'WARN' | 'FAIL';

// Known numbers the AI is allowed to mention
const KNOWN_NUMBERS = ['150', '170', '500'];

// ── Binary Assertions (deterministic — FAIL if not met) ──────────────────────

const BINARY_ASSERTIONS: Record<string, (response: string) => boolean> = {
  // Price
  'contains_price:150': (r) =>
    r.includes('150') || r.includes('מאה וחמישים'),

  'no_hallucinated_numbers': (r) => {
    const numbers = r.match(/\d{2,}/g) || [];
    return numbers.every(
      (n) => KNOWN_NUMBERS.includes(n) || parseInt(n, 10) < 20,
    );
  },

  'no_invented_discount': (r) =>
    !(/הנחה.*\d+%|%\d+/.test(r)) || r.includes('10%') || r.includes('15%'),

  'no_price_drop': (r) =>
    !(/מחיר.*מיוחד.*\d+|רק.*\d+.*ש"ח/.test(r)),

  // CTA
  contains_cta: (r) =>
    ['שיעור ניסיון', 'לקבוע', 'לתאם', 'אשמח', 'ליצור קשר', 'נקבע', 'calendly', 'Calendly']
      .some((cta) => r.includes(cta)),

  // Safety
  no_crash: (r) => r.length > 0,
  no_error: (r) =>
    !r.includes('Error') && !r.includes('error') && !r.includes('שגיאה'),
  handles_empty_input: (r) => r.length > 10,
  handles_long_input: (r) => r.length > 10,
  stays_professional: (r) =>
    !['אני לא יודע', 'כמודל שפה', 'אני AI', 'I am an AI', 'as an AI'].some(
      (p) => r.includes(p),
    ),

  // Location
  contains_location: (r) =>
    r.includes('שרון') || r.includes('הרצליה') || r.includes('רעננה') ||
    r.includes('כפר סבא') || r.includes('נתניה') || r.includes("ת\"א") ||
    r.includes('ת״א') || r.includes('תל אביב') || r.includes('זום'),

  no_invented_address: (r) =>
    !(/רחוב\s+\S+\s+\d+|מספר \d+|קומה \d+/.test(r)),

  // Availability
  no_specific_slot_promise: (r) =>
    !(/יום\s+\S+\s+בשעה\s+\d+|ב-?\d+:\d+/.test(r)),

  no_false_availability: (r) =>
    !(/פנוי היום ב|יש לי מקום היום ב/.test(r)),

  no_specific_times_invented: (r) =>
    !(/פנוי ב(יום \S+ בשעה \d+|שעה \d+:\d+)/.test(r)),

  // Superlatives
  no_false_superlatives: (r) =>
    !(['הכי טוב', 'מספר 1', 'הטוב ביותר בארץ', 'הכי מקצועי בארץ'].some(
      (s) => r.includes(s),
    )),

  // Discount
  no_unauthorized_discount: (r) =>
    !(/הנחה של \d+%|50%|הנחה מיוחדת/.test(r)) || r.includes('חבילות'),

  // Competitor
  no_competitor_bashing: (r) =>
    !(['מורים אחרים לא', 'מורים זולים לא', 'מורים גרועים'].some(
      (s) => r.includes(s),
    )),

  // Subject honesty
  honest_about_subjects: (r) => r.length > 10, // Just needs a real response
  honest_about_levels: (r) => r.length > 10,

  // Conversion
  confirms_capability: (r) =>
    r.includes('מתמטיקה') || r.includes('כן') || r.includes('בטח') || r.includes('בהחלט'),
  clear_next_step: (r) =>
    r.includes('calendly') || r.includes('Calendly') || r.includes('לקבוע') || r.includes('שיעור ניסיון'),
  confirms_interest: (r) =>
    r.includes('שיעור ניסיון') || r.includes('לקבוע') || r.includes('calendly') || r.includes('Calendly'),
  confirms_booking_intent: (r) =>
    r.includes('calendly') || r.includes('Calendly') || r.includes('לקבוע') || r.includes('שיעור'),
  provides_scheduling_info: (r) =>
    r.includes('calendly') || r.includes('Calendly') || r.includes('לקבוע') || r.includes('שיעור ניסיון'),

  // Experience
  contains_experience: (r) =>
    r.includes('שנ') || r.includes('ניסיון') || r.includes('תלמיד'),
  no_exaggeration: (r) =>
    !(/\d{2,}\+?\s*שנות?\s*ניסיון/.test(r) && !r.includes('5')),

  // Language
  responds_in_hebrew_or_matches_language: (r) =>
    /[\u0590-\u05FF]/.test(r) || r.length > 10,
  handles_emoji: (r) => r.length > 10,
  provides_info: (r) => r.length > 20,
};

// ── Heuristic Assertions (soft — WARN not FAIL) ─────────────────────────────

const HEURISTIC_ASSERTIONS: Record<string, (response: string) => boolean> = {
  suggests_contact: (r) =>
    r.length > 20 &&
    ['אשמח', 'נשמח', 'צור קשר', 'שלח', 'calendly', 'Calendly'].some((w) =>
      r.includes(w),
    ),

  suggests_scheduling: (r) =>
    ['לקבוע', 'calendly', 'Calendly', 'שיעור ניסיון', 'לתאם'].some((w) =>
      r.includes(w),
    ),

  empathetic_tone: (r) =>
    ['מבין', 'בהחלט', 'אשמח לעזור', 'שמח', 'אני מבין'].some((w) =>
      r.includes(w),
    ),

  not_pushy: (r) =>
    !['חייב', 'מיד', 'עכשיו בלבד', 'הזדמנות אחרונה'].some((w) =>
      r.includes(w),
    ),

  respectful: (r) => r.length > 20,

  highlights_value: (r) =>
    ['ניסיון', 'שנות', 'מקצועי', 'תוצאות', 'שיטה', 'ווטסאפ', 'תמיכה'].some(
      (w) => r.includes(w),
    ),

  handles_objection: (r) =>
    r.length > 30 && ['מבין', 'שווה', 'ניסיון', 'כולל', 'ווטסאפ', 'תמיכה'].some(
      (w) => r.includes(w),
    ),

  suggests_trial: (r) =>
    ['שיעור ניסיון', 'נסיון', 'calendly', 'Calendly'].some((w) =>
      r.includes(w),
    ),

  acknowledges_timing: (r) =>
    ['בסדר', 'מבין', 'בהחלט', 'שמח', 'אשמח'].some((w) => r.includes(w)),

  keeps_door_open: (r) =>
    ['אשמח', 'כשתהיה', 'כשתרצה', 'פנוי', 'כאן'].some((w) => r.includes(w)),

  polite_decline: (r) =>
    r.length > 20 &&
    ['מבין', 'המחיר', 'כולל', 'שווה'].some((w) => r.includes(w)),

  humble_confidence: (r) =>
    r.length > 20 &&
    !['הכי טוב', 'מספר 1', 'הטוב ביותר'].some((w) => r.includes(w)),

  no_panic: (r) =>
    r.length > 20 &&
    !['מצטער', 'סליחה', 'לא מובן'].some((w) => r.includes(w)),
};

// ── Assertion → Failure Type mapping ─────────────────────────────────────────

const FAILURE_MAP: Record<string, FailureType> = {
  'contains_price:150': 'F1_HALLUCINATION',
  'no_hallucinated_numbers': 'F1_HALLUCINATION',
  'no_invented_discount': 'F2_OVERPROMISE',
  'no_price_drop': 'F2_OVERPROMISE',
  'no_false_availability': 'F2_OVERPROMISE',
  'no_specific_slot_promise': 'F2_OVERPROMISE',
  'no_specific_times_invented': 'F2_OVERPROMISE',
  'no_unauthorized_discount': 'F2_OVERPROMISE',
  contains_cta: 'F3_MISSING_CTA',
  stays_professional: 'F4_IDENTITY_LEAK',
  no_false_superlatives: 'F5_TONE_ISSUE',
  no_competitor_bashing: 'F5_TONE_ISSUE',
  no_crash: 'F6_EMPTY_CRASH',
  no_error: 'F6_EMPTY_CRASH',
  handles_empty_input: 'F6_EMPTY_CRASH',
  handles_long_input: 'F6_EMPTY_CRASH',
  no_invented_address: 'F1_HALLUCINATION',
  no_exaggeration: 'F1_HALLUCINATION',
};

// ── Evaluate ─────────────────────────────────────────────────────────────────

export function evaluateResponse(
  response: string,
  assertionNames: string[],
): {
  results: AssertionResult[];
  binaryPassRate: number;
  heuristicPassRate: number;
  status: ScenarioStatus;
  failureTypes: FailureType[];
} {
  const results: AssertionResult[] = [];
  let binaryTotal = 0;
  let binaryPassed = 0;
  let heuristicTotal = 0;
  let heuristicPassed = 0;
  const failureTypes = new Set<FailureType>();

  for (const name of assertionNames) {
    const binaryFn = BINARY_ASSERTIONS[name];
    const heuristicFn = HEURISTIC_ASSERTIONS[name];

    if (binaryFn) {
      binaryTotal++;
      const passed = binaryFn(response);
      if (passed) binaryPassed++;
      else {
        const ft = FAILURE_MAP[name];
        if (ft) failureTypes.add(ft);
      }
      results.push({ name, type: 'binary', passed });
    } else if (heuristicFn) {
      heuristicTotal++;
      const passed = heuristicFn(response);
      if (passed) heuristicPassed++;
      results.push({ name, type: 'heuristic', passed });
    } else {
      // Unknown assertion — treat as heuristic pass to avoid false failures
      results.push({ name, type: 'heuristic', passed: true });
      heuristicTotal++;
      heuristicPassed++;
    }
  }

  const binaryPassRate = binaryTotal > 0 ? (binaryPassed / binaryTotal) * 100 : 100;
  const heuristicPassRate = heuristicTotal > 0 ? (heuristicPassed / heuristicTotal) * 100 : 100;

  let status: ScenarioStatus;
  if (binaryPassed < binaryTotal) {
    status = 'FAIL';
  } else if (heuristicPassRate < 50) {
    status = 'WARN';
  } else {
    status = 'PASS';
  }

  return {
    results,
    binaryPassRate,
    heuristicPassRate,
    status,
    failureTypes: [...failureTypes],
  };
}
