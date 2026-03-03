/**
 * AI Response Validator — Runtime Guards
 *
 * Post-AI safety checks applied BEFORE saving/sending:
 * 1. Numeric hallucination detection (with known-numbers whitelist)
 * 2. CTA append guard (zero-cost, guaranteed CTA in every response)
 */

import logger from './logger.js';

// ── Numeric Hallucination Guard ────────────────────────────────────────────

interface ValidationResult {
  isClean: boolean;
  suspiciousNumbers: string[];
  knownNumbers: string[];
}

/**
 * Validate that an AI response only references numbers present in the profile.
 * Numbers below 20, years (1990-2030), and known profile numbers are allowed.
 */
export function validateAIResponse(
  response: string,
  profileData: {
    price_per_lesson?: number;
    price_per_lesson_frontal?: number;
    package_discount_10?: number;
    package_discount_20?: number;
    [key: string]: unknown;
  },
): ValidationResult {
  // Extract all numbers >= 2 digits from response
  const numbersInResponse = (response.match(/\d{2,}/g) || []).map((n) =>
    parseInt(n, 10),
  );

  // Build known numbers from profile
  const knownNumbers: number[] = [];
  if (profileData.price_per_lesson) {
    knownNumbers.push(profileData.price_per_lesson);
  }
  if (profileData.price_per_lesson_frontal) {
    knownNumbers.push(profileData.price_per_lesson_frontal);
  }
  if (profileData.package_discount_10) {
    knownNumbers.push(profileData.package_discount_10);
  }
  if (profileData.package_discount_20) {
    knownNumbers.push(profileData.package_discount_20);
  }

  // Hardcoded known numbers from the system prompt (150, 170, 500+ students, 10%, 15%)
  const systemKnownNumbers = [150, 170, 500, 10, 15];
  const allKnown = [...new Set([...knownNumbers, ...systemKnownNumbers])];

  // Filter suspicious numbers
  const suspicious = numbersInResponse.filter((n) => {
    if (n <= 20) return false; // Small numbers OK (class levels, counts)
    if (n >= 1990 && n <= 2030) return false; // Years OK
    return !allKnown.includes(n);
  });

  return {
    isClean: suspicious.length === 0,
    suspiciousNumbers: suspicious.map(String),
    knownNumbers: allKnown.map(String),
  };
}

// ── CTA Append Guard ───────────────────────────────────────────────────────

const CTA_KEYWORDS = [
  'שיעור ניסיון',
  'לקבוע',
  'לתאם',
  'אשמח',
  'ליצור קשר',
  'נקבע',
  'מתי נוח',
  'נשמח',
  'calendly',
  'Calendly',
];

/**
 * Ensure every AI response contains a CTA.
 * If missing, appends a default one. Zero API cost.
 */
export function ensureCTA(response: string): { text: string; appended: boolean } {
  const hasCTA = CTA_KEYWORDS.some((kw) => response.includes(kw));
  if (!hasCTA) {
    logger.info('[AI-GUARD] CTA missing — appending default CTA');
    return {
      text: response + '\n\nאשמח לתאם שיעור ניסיון — מתי נוח לך? 😊',
      appended: true,
    };
  }
  return { text: response, appended: false };
}
