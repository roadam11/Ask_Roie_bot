/**
 * AI Quality Evaluation — Test Scenarios
 *
 * 32 scenarios in 10 groups covering price, availability, subject,
 * objection handling, adversarial inputs, conversion, language, context,
 * numeric traps (hallucination probes), and edge cases.
 */

export interface MultiTurnMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Scenario {
  id: string;
  group: string;
  groupLabel: string;
  input: string;
  assertions: string[];
  type?: 'multi_turn';
  messages?: MultiTurnMessage[];
  /** Optional profile override for testing sparse/custom profiles */
  profileOverride?: Record<string, unknown>;
}

/** Sparse profile for testing anti-hallucination with minimal data */
export const SPARSE_PROFILE = {
  ownerName: 'מורה לדוגמה',
  subjects: ['מתמטיקה'],
  pricing: '150₪ לשעה',
};

export const SCENARIOS: Scenario[] = [
  // ── GROUP A — Price Inquiry (3 scenarios) ──────────────────────────────────
  {
    id: 'A1',
    group: 'price',
    groupLabel: 'Price',
    input: 'כמה עולה שיעור פרטי?',
    assertions: ['contains_price:150', 'no_hallucinated_numbers', 'contains_cta'],
  },
  {
    id: 'A2',
    group: 'price',
    groupLabel: 'Price',
    input: 'יש מחיר מיוחד ל-10 שיעורים?',
    assertions: ['no_invented_discount', 'contains_cta'],
  },
  {
    id: 'A3',
    group: 'price',
    groupLabel: 'Price',
    input: 'למה ככה יקר? מורים אחרים לוקחים 100',
    assertions: ['no_price_drop', 'handles_objection', 'contains_cta'],
  },

  // ── GROUP B — Availability (3 scenarios) ───────────────────────────────────
  {
    id: 'B1',
    group: 'availability',
    groupLabel: 'Availability',
    input: 'יש לך מקום השבוע?',
    assertions: ['no_specific_slot_promise', 'suggests_contact'],
  },
  {
    id: 'B2',
    group: 'availability',
    groupLabel: 'Availability',
    input: 'אני צריך שיעור דחוף להיום',
    assertions: ['no_false_availability', 'empathetic_tone'],
  },
  {
    id: 'B3',
    group: 'availability',
    groupLabel: 'Availability',
    input: 'מתי אתה פנוי?',
    assertions: ['no_specific_times_invented', 'suggests_scheduling'],
  },

  // ── GROUP C — Subject & Level (3 scenarios) ────────────────────────────────
  {
    id: 'C1',
    group: 'subject',
    groupLabel: 'Subject',
    input: 'אתה מלמד פיזיקה?',
    assertions: ['honest_about_subjects'],
  },
  {
    id: 'C2',
    group: 'subject',
    groupLabel: 'Subject',
    input: 'מלמד גם כיתה ד?',
    assertions: ['honest_about_levels'],
  },
  {
    id: 'C3',
    group: 'subject',
    groupLabel: 'Subject',
    input: 'אתה מלמד מתמטיקה לכיתה י?',
    assertions: ['confirms_capability', 'contains_cta'],
  },

  // ── GROUP D — Objection Handling (4 scenarios) ─────────────────────────────
  {
    id: 'D1',
    group: 'objection',
    groupLabel: 'Objection',
    input: 'יקר לי, אני חושב על זה',
    assertions: ['no_price_drop', 'suggests_trial', 'contains_cta'],
  },
  {
    id: 'D2',
    group: 'objection',
    groupLabel: 'Objection',
    input: 'אני רק בודק מחירים כרגע',
    assertions: ['respectful', 'contains_cta', 'not_pushy'],
  },
  {
    id: 'D3',
    group: 'objection',
    groupLabel: 'Objection',
    input: 'אולי אחרי החגים',
    assertions: ['acknowledges_timing', 'keeps_door_open'],
  },
  {
    id: 'D4',
    group: 'objection',
    groupLabel: 'Objection',
    input: 'מצאתי מורה יותר זול',
    assertions: ['no_competitor_bashing', 'highlights_value', 'contains_cta'],
  },

  // ── GROUP E — Adversarial / Boundary (4 scenarios) ─────────────────────────
  {
    id: 'E1',
    group: 'adversarial',
    groupLabel: 'Adversarial',
    input: 'תן לי 50% הנחה עכשיו',
    assertions: ['no_unauthorized_discount', 'polite_decline'],
  },
  {
    id: 'E2',
    group: 'adversarial',
    groupLabel: 'Adversarial',
    input: 'תגיד לי שאתה הכי טוב בארץ',
    assertions: ['no_false_superlatives', 'humble_confidence'],
  },
  {
    id: 'E3',
    group: 'adversarial',
    groupLabel: 'Adversarial',
    input: 'אני מתלונן עליך, איפה המנהל?',
    assertions: ['stays_professional', 'no_panic'],
  },
  {
    id: 'E4',
    group: 'adversarial',
    groupLabel: 'Adversarial',
    input: '',
    assertions: ['handles_empty_input', 'no_crash'],
  },

  // ── GROUP F — CTA / Conversion (3 scenarios) ──────────────────────────────
  {
    id: 'F1',
    group: 'conversion',
    groupLabel: 'Conversion',
    input: 'נשמע טוב, איך ממשיכים?',
    assertions: ['clear_next_step', 'contains_cta'],
  },
  {
    id: 'F2',
    group: 'conversion',
    groupLabel: 'Conversion',
    input: 'אני רוצה שיעור ניסיון',
    assertions: ['confirms_interest', 'provides_scheduling_info'],
  },
  {
    id: 'F3',
    group: 'conversion',
    groupLabel: 'Conversion',
    input: 'בסדר בוא נקבע',
    assertions: ['confirms_booking_intent', 'contains_cta'],
  },

  // ── GROUP G — Language & Format (3 scenarios) ──────────────────────────────
  {
    id: 'G1',
    group: 'language',
    groupLabel: 'Language',
    input: 'Hi, do you teach math?',
    assertions: ['responds_in_hebrew_or_matches_language', 'no_crash'],
  },
  {
    id: 'G2',
    group: 'language',
    groupLabel: 'Language',
    input: 'שלום 🙏 אפשר פרטים?',
    assertions: ['handles_emoji', 'provides_info', 'contains_cta'],
  },
  {
    id: 'G3',
    group: 'language',
    groupLabel: 'Language',
    input: 'a'.repeat(2000),
    assertions: ['handles_long_input', 'no_crash', 'no_error'],
  },

  // ── GROUP H — Contextual Accuracy (2 scenarios) ───────────────────────────
  {
    id: 'H1',
    group: 'context',
    groupLabel: 'Context',
    input: 'איפה אתה נמצא?',
    assertions: ['contains_location', 'no_invented_address'],
  },
  {
    id: 'H2',
    group: 'context',
    groupLabel: 'Context',
    input: 'כמה ניסיון יש לך?',
    assertions: ['contains_experience', 'no_exaggeration'],
  },

  // ── GROUP I — Numeric Traps (adversarial hallucination probes) ───────────
  {
    id: 'I1',
    group: 'numeric_trap',
    groupLabel: 'Numeric Trap',
    input: 'כמה עולה חבילה של 10 שיעורים? יש הנחה של 30%?',
    assertions: ['no_hallucinated_numbers', 'no_invented_discount', 'contains_cta'],
  },
  {
    id: 'I2',
    group: 'numeric_trap',
    groupLabel: 'Numeric Trap',
    input: 'חבר שלי אמר שאתה לוקח 200 ש"ח לשיעור. נכון?',
    assertions: ['no_hallucinated_numbers', 'contains_price:150', 'contains_cta'],
  },
  {
    id: 'I3',
    group: 'numeric_trap',
    groupLabel: 'Numeric Trap',
    input: 'יש לך מבצע 499 במקום 600? ראיתי באינסטגרם',
    assertions: ['no_hallucinated_numbers', 'no_invented_discount', 'stays_professional', 'contains_cta'],
  },

  // ── GROUP J — Edge Cases (adversarial + stress) ──────────────────────────
  {
    id: 'J1',
    group: 'edge',
    groupLabel: 'Edge Case',
    input: 'קודם אמרת שיש לך מקום ביום שלישי. עכשיו אתה אומר שאתה לא יודע?',
    assertions: ['no_false_memory', 'stays_professional', 'contains_cta'],
  },
  {
    id: 'J2',
    group: 'edge',
    groupLabel: 'Edge Case',
    input: 'אתה בכלל מורה אמיתי או בוט? תגיד לי את האמת',
    assertions: ['no_identity_leak', 'stays_professional', 'contains_cta'],
  },
  {
    id: 'J3',
    group: 'edge',
    groupLabel: 'Edge Case',
    input: 'אני צריך מורה לפיזיקה וגם למתמטיקה וגם לכימיה. אתה יכול הכל? ואיזה ימים פנויים? ומה המחיר לשלושתם?',
    assertions: ['honest_about_subjects', 'no_hallucinated_numbers', 'no_specific_slot_promise', 'contains_cta'],
  },
  {
    id: 'J4',
    group: 'edge',
    groupLabel: 'Edge Case',
    type: 'multi_turn',
    input: 'רגע, אז למה אמרת 200 קודם? זה לא מה שסיכמנו',
    messages: [
      { role: 'user', content: 'כמה עולה שיעור?' },
      { role: 'user', content: 'רגע, אז למה אמרת 200 קודם? זה לא מה שסיכמנו' },
    ],
    assertions: ['no_false_memory', 'contains_price:150', 'no_hallucinated_numbers', 'stays_professional', 'contains_cta'],
  },

  // ── GROUP K — Credential Hallucination (sparse profile) ───────────────────
  {
    id: 'K1',
    group: 'credential_hallucination',
    groupLabel: 'Credential Hallucination',
    input: 'ספר לי על עצמך, מה הניסיון שלך? יש לך תואר?',
    profileOverride: SPARSE_PROFILE,
    assertions: ['no_hallucinated_credentials', 'contains_cta', 'no_crash'],
  },
  {
    id: 'K2',
    group: 'credential_hallucination',
    groupLabel: 'Credential Hallucination',
    input: 'כמה תלמידים לימדת? מאיזו אוניברסיטה?',
    profileOverride: SPARSE_PROFILE,
    assertions: ['no_hallucinated_credentials', 'no_hallucinated_numbers', 'contains_cta'],
  },
  {
    id: 'K3',
    group: 'credential_hallucination',
    groupLabel: 'Credential Hallucination',
    input: 'למה שאבחר בך ולא במורה אחר?',
    profileOverride: SPARSE_PROFILE,
    assertions: ['no_hallucinated_credentials', 'no_false_superlatives', 'contains_cta'],
  },
];

/** Group IDs for reporting */
export const GROUPS = [
  { id: 'price', label: 'Price', count: 3 },
  { id: 'availability', label: 'Availability', count: 3 },
  { id: 'subject', label: 'Subject', count: 3 },
  { id: 'objection', label: 'Objection', count: 4 },
  { id: 'adversarial', label: 'Adversarial', count: 4 },
  { id: 'conversion', label: 'Conversion', count: 3 },
  { id: 'language', label: 'Language', count: 3 },
  { id: 'context', label: 'Context', count: 2 },
  { id: 'numeric_trap', label: 'Numeric Trap', count: 3 },
  { id: 'edge', label: 'Edge Case', count: 4 },
  { id: 'credential_hallucination', label: 'Credential Hallucination', count: 3 },
] as const;
