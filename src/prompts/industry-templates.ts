/**
 * Industry Templates — Pre-filled wizard starting points.
 *
 * Each template provides sensible defaults for a business type.
 * The wizard pre-fills answers from the selected template,
 * then the user customizes before generating their prompt.
 */

// ============================================================================
// Types
// ============================================================================

export interface WizardAnswers {
  businessName: string;
  businessType: string;
  subjects: string[];
  pricing: string;
  experience: string;
  credentials: string;
  usp: string;
  tone: 'friendly' | 'professional' | 'academic';
  availability: string;
  location: string;
  bookingLink: string;
  neverSay: string[];
  commonObjections: Array<{ objection: string; response: string }>;
  qualificationQuestions: string[];
  stages: string[];
}

export interface IndustryTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  defaults: WizardAnswers;
}

// ============================================================================
// Templates
// ============================================================================

export const TEMPLATES: IndustryTemplate[] = [
  {
    id: 'tutor',
    name: 'מורה פרטי',
    icon: '📚',
    description: 'שיעורים פרטיים — מתמטיקה, פיזיקה, אנגלית וכו׳',
    defaults: {
      businessName: '',
      businessType: 'מורה פרטי',
      subjects: ['מתמטיקה'],
      pricing: '150₪ לשעה בזום | 170₪ לשעה פרונטלי (מינימום 2 שעות)',
      experience: '',
      credentials: '',
      usp: 'תמיכה בווטסאפ בין השיעורים ללא תוספת תשלום',
      tone: 'friendly',
      availability: '',
      location: '',
      bookingLink: '',
      neverSay: ['לא לפתור שיעורי בית בצ׳אט', 'לא להבטיח ציונים'],
      commonObjections: [
        { objection: 'יקר לי', response: 'להדגיש ערך — תמיכה בווטסאפ + שיעור ניסיון' },
        { objection: 'צריך לחשוב', response: 'לכבד + לשלוח לינק לקביעה' },
        { objection: 'יש לי מורה', response: 'להציע שיעור ניסיון להשוואה' },
      ],
      qualificationQuestions: ['באיזה מקצוע ורמה?', 'יש מבחן קרוב?', 'הורה או תלמיד?'],
      stages: ['GREETING', 'QUALIFYING', 'DIAGNOSING', 'PRICING', 'BOOKING'],
    },
  },
  {
    id: 'clinic',
    name: 'קליניקה / מטפל',
    icon: '🏥',
    description: 'מרפאות, פיזיותרפיה, פסיכולוגיה, רפואה משלימה',
    defaults: {
      businessName: '',
      businessType: 'קליניקה',
      subjects: ['טיפול'],
      pricing: '',
      experience: '',
      credentials: '',
      usp: '',
      tone: 'professional',
      availability: '',
      location: '',
      bookingLink: '',
      neverSay: ['לא לתת אבחנות רפואיות', 'לא להבטיח תוצאות טיפוליות', 'לא לייעץ על תרופות'],
      commonObjections: [
        { objection: 'יקר לי', response: 'להדגיש ערך הטיפול + קופת חולים אם רלוונטי' },
        { objection: 'אני לא בטוח שזה מתאים לי', response: 'להציע פגישת היכרות' },
      ],
      qualificationQuestions: ['מה הבעיה העיקרית?', 'יש הפניה מרופא?', 'כמה זמן זה נמשך?'],
      stages: ['GREETING', 'UNDERSTANDING_NEED', 'EXPLAINING_SERVICE', 'SCHEDULING'],
    },
  },
  {
    id: 'coach',
    name: 'קואצ׳ר / יועץ',
    icon: '🎯',
    description: 'אימון אישי, ייעוץ עסקי, ליווי קריירה',
    defaults: {
      businessName: '',
      businessType: 'קואצ׳ר',
      subjects: ['אימון אישי'],
      pricing: '',
      experience: '',
      credentials: '',
      usp: '',
      tone: 'friendly',
      availability: '',
      location: '',
      bookingLink: '',
      neverSay: ['לא להבטיח תוצאות ספציפיות', 'לא לתת ייעוץ פסיכולוגי'],
      commonObjections: [
        { objection: 'מה זה בכלל קואצ׳ינג?', response: 'להסביר בקצרה + להציע שיחת היכרות' },
        { objection: 'יקר', response: 'להדגיש ROI + שיחת היכרות חינם' },
      ],
      qualificationQuestions: ['מה היעד שלך?', 'ניסית כבר משהו דומה?', 'מה לוח הזמנים?'],
      stages: ['GREETING', 'UNDERSTANDING_GOAL', 'PRESENTING_APPROACH', 'SCHEDULING_DISCOVERY'],
    },
  },
];

/**
 * Get a template by ID, or return null for "custom" (blank) template.
 */
export function getTemplate(id: string): IndustryTemplate | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * Get blank WizardAnswers for custom template.
 */
export function getBlankAnswers(): WizardAnswers {
  return {
    businessName: '',
    businessType: '',
    subjects: [],
    pricing: '',
    experience: '',
    credentials: '',
    usp: '',
    tone: 'friendly',
    availability: '',
    location: '',
    bookingLink: '',
    neverSay: [],
    commonObjections: [],
    qualificationQuestions: [],
    stages: ['GREETING', 'QUALIFYING', 'PRICING', 'BOOKING'],
  };
}
