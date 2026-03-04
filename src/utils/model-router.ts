/**
 * Model Router — Complexity-scoring hybrid router for Haiku/Sonnet.
 *
 * Routes simple queries to Haiku (cheap, fast) and complex ones to Sonnet.
 * Zero API cost for routing — keyword + heuristic scoring only.
 *
 * Scoring: Each message gets a complexity score based on multiple factors.
 * Score >= SONNET_THRESHOLD → Sonnet. Below → Haiku.
 */

const SONNET = process.env.AI_MODEL_SONNET || 'claude-sonnet-4-20250514';
const HAIKU = process.env.AI_MODEL_HAIKU || 'claude-haiku-4-5-20251001';

const SONNET_THRESHOLD = 4;

export interface RoutingDecision {
  model: string;
  score: number;
  reasons: string[];
}

interface ConversationMessage {
  role: string;
  content: string;
}

export function selectModel(
  userMessage: string,
  history: ConversationMessage[]
): RoutingDecision {
  // If AI_MODEL env var is explicitly set (e.g., for eval), bypass router
  if (process.env.AI_MODEL) {
    return { model: process.env.AI_MODEL, score: -1, reasons: ['env_override'] };
  }

  const msg = userMessage.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  // --- Factor 1: Objection / hesitation signals (+3) ---
  const objectionPatterns = [
    'יקר', 'יותר זול', 'מצאתי זול', 'הנחה', 'מבצע',
    'לא בטוח', 'אולי', 'חושב על זה', 'נראה לי',
    'לא מסתדר', 'לא מתאים כרגע', 'בודק מחירים',
  ];
  if (objectionPatterns.some(p => msg.includes(p))) {
    score += 3;
    reasons.push('objection_signal');
  }

  // --- Factor 2: Memory reference (+3) ---
  const memoryPatterns = ['אמרת', 'סיכמנו', 'קודם', 'דיברנו', 'הבטחת'];
  if (memoryPatterns.some(p => msg.includes(p))) {
    score += 3;
    reasons.push('memory_reference');
  }

  // --- Factor 3: Long message (+2) ---
  if (msg.length > 180) {
    score += 2;
    reasons.push('long_message');
  }

  // --- Factor 4: Deep conversation (+2) ---
  if (history.length > 4) {
    score += 2;
    reasons.push('deep_conversation');
  }

  // --- Factor 5: Multiple questions (+2) ---
  if ((msg.match(/\?/g) || []).length >= 2) {
    score += 2;
    reasons.push('multi_question');
  }

  // --- Factor 6: Numeric reasoning (+2) ---
  if (/\d+/.test(msg) && (msg.includes('%') || msg.includes('₪') || msg.includes('ש"ח'))) {
    score += 2;
    reasons.push('numeric_reasoning');
  }

  // --- Factor 7: Haiku-known-failure keywords (+3) ---
  // From Job 2 eval: I2 (hallucinated number on price challenge), H1 (missing location), F2 (scheduling)
  const haikuFailKeywords = [
    'אמר שאתה לוקח',   // I2: price challenge from friend
    'איפה אתה נמצא',    // H1: location question
    'שיעור ניסיון',      // F2: trial lesson booking
    'הכי טוב',          // E2: superlative challenge
  ];
  if (haikuFailKeywords.some(kw => msg.includes(kw))) {
    score += 3;
    reasons.push('haiku_known_failure');
  }

  // --- Hard overrides (always Sonnet, bypass scoring) ---
  if (msg.includes('מתלונן') || msg.includes('מנהל') || msg.includes('תלונה')) {
    return { model: SONNET, score: 999, reasons: ['hard_override_complaint'] };
  }

  // --- Decision ---
  if (score >= SONNET_THRESHOLD) {
    return { model: SONNET, score, reasons };
  }
  return { model: HAIKU, score, reasons };
}

export { SONNET, HAIKU };
