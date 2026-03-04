-- Migration 015: Extract Roie's personal data from hardcoded SYSTEM_PROMPT into database
-- This enables the switch from Roie-specific prompt to GENERIC_SALES_PROMPT
--
-- IMPORTANT: credentials is INTENTIONALLY empty. If Roie has a degree, he fills it in Settings.

-- Find Roie's account and update the profile with all his data
UPDATE settings
SET profile = COALESCE(profile, '{}'::jsonb) || '{
  "ownerName": "רועי אדם",
  "subjects": ["מתמטיקה", "פיזיקה", "מדעי המחשב"],
  "levels": "יסודי, חטיבה, תיכון, אקדמיה",
  "experience": "5+ שנות ניסיון בהוראה פרטית, למעלה מ-500 תלמידים",
  "credentials": "",
  "pricing": "זום: 150₪ לשעה | פרונטלי: 170₪ לשעה (מינימום 2 שעות)",
  "price_per_lesson": 150,
  "packages": "חבילת 10 שיעורים: 10% הנחה | חבילת 20 שיעורים: 15% הנחה",
  "availability": "ראשון-חמישי 14:00-21:00, שישי 09:00-14:00, שבת סגור",
  "location": "זום: בכל מקום | פרונטלי: אזור השרון בלבד (הרצליה, רעננה, כפר סבא, נתניה) וצפון ת\"א",
  "formats": "זום, פרונטלי",
  "usp": "תמיכה בווטסאפ בין השיעורים ללא תוספת תשלום - תלמידים שולחים שאלות בכל זמן",
  "calendly_link": "https://calendly.com/roadam11/meet-with-me"
}'::jsonb
WHERE account_id = (
  SELECT account_id FROM agents LIMIT 1
);
