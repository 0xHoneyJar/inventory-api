-- Migration Template: Register scoring version and add user-facing changelog
--
-- Usage: Replace placeholders and write to supabase/migrations/{NNN}_v{X.Y}_user_changelog.sql
--
-- Placeholders:
--   {NNN}              - Migration number (e.g., 113)
--   {VERSION_SHORT}    - 2-part version for DB (e.g., 0.4)
--   {TITLE}            - Release title (e.g., Pipeline Optimization & Badges)
--   {USER_CHANGELOG}   - JSON array of {section, title, description} objects
--
-- Reference: supabase/migrations/102_v0.3_user_changelog.sql

-- Migration {NNN}: Register scoring version v{VERSION_SHORT} and add user-facing changelog

INSERT INTO scoring_versions (version, summary, scoring_config)
VALUES (
  'v{VERSION_SHORT}',
  '{TITLE}',
  jsonb_build_object(
    'user_changelog', '[
      {"section": "Scoring", "title": "{FEATURE_TITLE}", "description": "{USER_FACING_DESCRIPTION}"}
    ]'::jsonb
  )
)
ON CONFLICT (version) DO UPDATE
SET summary = EXCLUDED.summary,
    scoring_config = EXCLUDED.scoring_config;

-- Notes:
-- - Version uses 2-part format (v0.4, not v0.4.0) per migration 095
-- - ON CONFLICT makes this migration idempotent (safe to re-run)
-- - user_changelog entries appear in the FE changelog modal
-- - Section must be "Scoring" or "Interface"
-- - Description must follow zerker's voice: second person, direct, 1-2 sentences
