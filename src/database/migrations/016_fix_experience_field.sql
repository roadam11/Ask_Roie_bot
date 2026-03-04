-- Migration 016: Tone down experience field to prevent hallucination extrapolation
--
-- "5+ שנות ניסיון, 500+ תלמידים" was copied from hardcoded prompt.
-- Unless Roie explicitly confirms these numbers, use vague phrasing.
-- The "500 תלמידים" claim in particular leads to degree extrapolation.

UPDATE settings
SET profile = profile || '{
  "experience": "ניסיון בהוראה פרטית",
  "student_count": ""
}'::jsonb
WHERE account_id = (
  SELECT account_id FROM agents LIMIT 1
);
