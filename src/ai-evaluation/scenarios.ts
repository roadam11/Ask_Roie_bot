/**
 * AI Quality Evaluation — Test Scenarios
 *
 * 25 scenarios in 8 groups covering price, availability, subject,
 * objection handling, adversarial inputs, conversion, language, and context.
 */

export interface Scenario {
  id: string;
  group: string;
  groupLabel: string;
  input: string;
  assertions: string[];
}

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
] as const;
