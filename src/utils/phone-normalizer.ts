/**
 * Phone Number Normalizer
 *
 * Normalizes phone numbers to E.164 format for consistent storage.
 * Default country code is Israel (+972).
 *
 * @example
 * import { normalizePhone, isValidPhone, formatDisplayPhone } from './utils/phone-normalizer.js';
 *
 * normalizePhone('050-123-4567')     // '+972501234567'
 * normalizePhone('0501234567')       // '+972501234567'
 * normalizePhone('+972501234567')    // '+972501234567'
 * isValidPhone('+972501234567')      // true
 * formatDisplayPhone('+972501234567') // '050-123-4567'
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Default country code (Israel)
 */
const DEFAULT_COUNTRY_CODE = '+972';

/**
 * Israeli mobile prefixes (after removing leading 0)
 */
const ISRAELI_MOBILE_PREFIXES = ['50', '51', '52', '53', '54', '55', '56', '57', '58', '59'];

/**
 * Israeli landline prefixes (after removing leading 0)
 */
const ISRAELI_LANDLINE_PREFIXES = ['2', '3', '4', '8', '9', '72', '73', '74', '76', '77', '78', '79'];

// ============================================================================
// Normalization
// ============================================================================

/**
 * Normalize a phone number to E.164 format
 *
 * @param phone - Phone number in any format
 * @param defaultCountryCode - Country code to add if missing (default: +972)
 * @returns Normalized phone number in E.164 format
 * @throws Error if phone number is invalid
 *
 * @example
 * normalizePhone('0501234567')       // '+972501234567'
 * normalizePhone('501234567', '+972') // '+972501234567'
 * normalizePhone('+972501234567')    // '+972501234567'
 * normalizePhone('050-123-4567')     // '+972501234567'
 * normalizePhone('972501234567')     // '+972501234567'
 */
export function normalizePhone(
  phone: string,
  defaultCountryCode: string = DEFAULT_COUNTRY_CODE
): string {
  if (!phone || typeof phone !== 'string') {
    throw new Error('Phone number is required');
  }

  // Remove all whitespace
  let normalized = phone.trim();

  // Check if it starts with +
  const hasPlus = normalized.startsWith('+');

  // Remove all non-digit characters except leading +
  normalized = normalized.replace(/[^\d+]/g, '');

  // If it had a + at the start, ensure it's preserved
  if (hasPlus && !normalized.startsWith('+')) {
    normalized = '+' + normalized;
  }

  // Remove any + signs that aren't at the start
  if (normalized.includes('+')) {
    normalized = '+' + normalized.replace(/\+/g, '');
  }

  // Handle different input formats
  if (normalized.startsWith('+')) {
    // Already has country code with +
    // Validate it's a reasonable length
    if (normalized.length < 10 || normalized.length > 16) {
      throw new Error(`Invalid phone number length: ${normalized}`);
    }
    return normalized;
  }

  // Check if it starts with country code without +
  // e.g., '972501234567'
  if (normalized.startsWith('972') && normalized.length >= 12) {
    return '+' + normalized;
  }

  // Handle Israeli format: 0501234567 → +972501234567
  if (normalized.startsWith('0')) {
    // Remove leading 0 and add country code
    normalized = defaultCountryCode + normalized.substring(1);
    return normalized;
  }

  // Handle format without leading 0: 501234567 → +972501234567
  if (normalized.length >= 9 && normalized.length <= 10) {
    return defaultCountryCode + normalized;
  }

  // If we get here, try adding the country code anyway
  if (normalized.length >= 7) {
    return defaultCountryCode + normalized;
  }

  throw new Error(`Cannot normalize phone number: ${phone}`);
}

/**
 * Safely normalize a phone number, returning null on error
 *
 * @param phone - Phone number in any format
 * @param defaultCountryCode - Country code to add if missing
 * @returns Normalized phone number or null if invalid
 */
export function normalizePhoneSafe(
  phone: string,
  defaultCountryCode: string = DEFAULT_COUNTRY_CODE
): string | null {
  try {
    return normalizePhone(phone, defaultCountryCode);
  } catch {
    return null;
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Check if a phone number is valid
 *
 * @param phone - Phone number (should be in E.164 format)
 * @returns true if valid
 *
 * @example
 * isValidPhone('+972501234567')  // true
 * isValidPhone('+1234567890')    // true
 * isValidPhone('invalid')        // false
 * isValidPhone('+123')           // false (too short)
 */
export function isValidPhone(phone: string): boolean {
  if (!phone || typeof phone !== 'string') {
    return false;
  }

  // Must start with +
  if (!phone.startsWith('+')) {
    return false;
  }

  // Remove the + and check if remaining is all digits
  const digits = phone.substring(1);
  if (!/^\d+$/.test(digits)) {
    return false;
  }

  // Check length (E.164 allows 1-15 digits after +)
  if (digits.length < 7 || digits.length > 15) {
    return false;
  }

  return true;
}

/**
 * Check if a phone number is a valid Israeli mobile number
 *
 * @param phone - Phone number in E.164 format
 * @returns true if valid Israeli mobile
 */
export function isIsraeliMobile(phone: string): boolean {
  if (!isValidPhone(phone)) {
    return false;
  }

  if (!phone.startsWith('+972')) {
    return false;
  }

  // Get the prefix after +972
  const localNumber = phone.substring(4);

  // Check if it starts with a valid mobile prefix
  return ISRAELI_MOBILE_PREFIXES.some((prefix) => localNumber.startsWith(prefix));
}

/**
 * Check if a phone number is a valid Israeli landline
 *
 * @param phone - Phone number in E.164 format
 * @returns true if valid Israeli landline
 */
export function isIsraeliLandline(phone: string): boolean {
  if (!isValidPhone(phone)) {
    return false;
  }

  if (!phone.startsWith('+972')) {
    return false;
  }

  // Get the prefix after +972
  const localNumber = phone.substring(4);

  // Check if it starts with a valid landline prefix
  return ISRAELI_LANDLINE_PREFIXES.some((prefix) => localNumber.startsWith(prefix));
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format a phone number for display (Israeli format)
 *
 * @param phone - Phone number in E.164 format
 * @returns Formatted phone number for display
 *
 * @example
 * formatDisplayPhone('+972501234567')  // '050-123-4567'
 * formatDisplayPhone('+97231234567')   // '03-123-4567'
 * formatDisplayPhone('+14155551234')   // '+1 415-555-1234'
 */
export function formatDisplayPhone(phone: string): string {
  if (!phone || !isValidPhone(phone)) {
    return phone || '';
  }

  // Handle Israeli numbers
  if (phone.startsWith('+972')) {
    const localNumber = phone.substring(4);

    // Mobile: 050-123-4567
    if (localNumber.length === 9 && ISRAELI_MOBILE_PREFIXES.some((p) => localNumber.startsWith(p))) {
      return `0${localNumber.substring(0, 2)}-${localNumber.substring(2, 5)}-${localNumber.substring(5)}`;
    }

    // Landline: 03-123-4567
    if (localNumber.length === 8) {
      return `0${localNumber.substring(0, 1)}-${localNumber.substring(1, 4)}-${localNumber.substring(4)}`;
    }

    // Landline with 2-digit area code: 072-123-4567
    if (localNumber.length === 9) {
      return `0${localNumber.substring(0, 2)}-${localNumber.substring(2, 5)}-${localNumber.substring(5)}`;
    }

    // Fallback
    return `0${localNumber}`;
  }

  // Handle US numbers
  if (phone.startsWith('+1') && phone.length === 12) {
    const number = phone.substring(2);
    return `+1 ${number.substring(0, 3)}-${number.substring(3, 6)}-${number.substring(6)}`;
  }

  // Generic international format
  return phone;
}

/**
 * Mask a phone number for privacy (show last 4 digits)
 *
 * @param phone - Phone number
 * @returns Masked phone number
 *
 * @example
 * maskPhone('+972501234567')  // '+972*****4567'
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 8) {
    return phone || '';
  }

  const visibleEnd = 4;
  const visibleStart = phone.startsWith('+') ? 4 : 0;

  if (phone.length <= visibleStart + visibleEnd) {
    return phone;
  }

  const start = phone.substring(0, visibleStart);
  const end = phone.substring(phone.length - visibleEnd);
  const masked = '*'.repeat(phone.length - visibleStart - visibleEnd);

  return start + masked + end;
}

// ============================================================================
// Extraction
// ============================================================================

/**
 * Extract country code from E.164 phone number
 *
 * @param phone - Phone number in E.164 format
 * @returns Country code with + (e.g., '+972', '+1')
 */
export function getCountryCode(phone: string): string | null {
  if (!isValidPhone(phone)) {
    return null;
  }

  // Common country codes (add more as needed)
  const countryCodes = [
    '+972', // Israel
    '+1',   // USA/Canada
    '+44',  // UK
    '+49',  // Germany
    '+33',  // France
    '+39',  // Italy
    '+34',  // Spain
    '+7',   // Russia
    '+86',  // China
    '+91',  // India
    '+81',  // Japan
    '+82',  // South Korea
    '+61',  // Australia
    '+55',  // Brazil
  ];

  for (const code of countryCodes) {
    if (phone.startsWith(code)) {
      return code;
    }
  }

  // Fallback: assume 1-3 digit country code
  const match = phone.match(/^\+(\d{1,3})/);
  return match ? '+' + match[1] : null;
}

/**
 * Extract local number (without country code)
 *
 * @param phone - Phone number in E.164 format
 * @returns Local number without country code
 */
export function getLocalNumber(phone: string): string | null {
  const countryCode = getCountryCode(phone);
  if (!countryCode) {
    return null;
  }

  return phone.substring(countryCode.length);
}

// ============================================================================
// Exports
// ============================================================================

export {
  DEFAULT_COUNTRY_CODE,
  ISRAELI_MOBILE_PREFIXES,
  ISRAELI_LANDLINE_PREFIXES,
};
