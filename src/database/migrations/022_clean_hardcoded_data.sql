-- Migration 022: Remove hardcoded founder personal data from DB rows
-- (Sprint 6.1a-4)
--
-- Migration 015 inserted Roie's personal Calendly link and name into the settings table.
-- Migration 004 seeded account/agent rows with "Ask ROIE" branding.
-- Migration 009 seeded settings.behavior with "Ask ROIE" branding.
--
-- These rows should contain generic defaults for a multi-tenant SaaS.
-- Existing tenants who have explicitly set their own calendly_link / ownerName
-- will NOT be affected because we only update rows where the value still matches
-- the founder-specific hardcoded value.
--
-- IMPORTANT: This migration is idempotent (safe to re-run).

-- 1. Clear founder's personal Calendly URL from settings where it was seeded by migration 015.
--    Tenants who set their own calendly_link will have a different value and will be skipped.
UPDATE settings
SET profile = profile - 'calendly_link' || '{"calendly_link": ""}'::jsonb
WHERE profile->>'calendly_link' = 'https://calendly.com/roadam11/meet-with-me';

-- 2. Replace founder name in settings.profile.ownerName with a generic placeholder,
--    only where the value still matches the hardcoded seed.
UPDATE settings
SET profile = profile || '{"ownerName": ""}'::jsonb
WHERE profile->>'ownerName' = 'רועי אדם';

-- 3. Replace "Ask ROIE" company name in settings.profile with empty string
--    (tenant must fill this in via onboarding wizard).
UPDATE settings
SET profile = profile || '{"companyName": ""}'::jsonb
WHERE profile->>'companyName' IN ('Ask ROIE', 'רועי אדם — מורה פרטי');

-- 4. Update the seeded account name from "Ask ROIE" to generic placeholder.
UPDATE accounts
SET name = 'My Business'
WHERE name = 'Ask ROIE';

-- 5. Update seeded agent name from "Ask ROIE Bot" to generic placeholder.
UPDATE agents
SET name = 'AI Sales Agent'
WHERE name IN ('Ask ROIE Bot', 'Ask ROIE WhatsApp', 'Ask ROIE Telegram');

-- 6. Clear hardcoded systemPrompt from settings.behavior seeded in migration 009.
UPDATE settings
SET behavior = behavior || '{"systemPrompt": ""}'::jsonb
WHERE behavior->>'systemPrompt' LIKE '%Ask ROIE%';
