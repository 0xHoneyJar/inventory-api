---
parallel_threshold: 3000
timeout_minutes: 30
zones:
  system:
    path: .claude
    permission: read
  state:
    paths: [grimoires/loa, .beads, .run]
    permission: read-write
  app:
    paths: [src, docs, supabase/migrations, scripts]
    permission: read-write
---

# Release Skill: Automated Versioning & Changelog

<objective>
Automate the scoring version release flow by collecting closed issues and merged PRs from both repos, categorizing changes, and generating three artifacts (changelog, migration, GH release) with human review before any writes.
</objective>

<zone_constraints>
## Zone Constraints

| Zone | Permission | Notes |
|------|-----------|-------|
| `.claude/` | Read | Read skill resources and templates |
| `docs/` | Read/Write | Prepend changelog entry |
| `supabase/migrations/` | Read/Write | Write migration SQL |
| `grimoires/loa/` | Read/Write | Session memory |
| `package.json` | Read/Write | Version bump |
</zone_constraints>

<kernel_framework>
## Task (N - Narrow Scope)
Generate a complete scoring version release with all three artifacts.

## Context (L - Logical Structure)
- Input: version (optional), since date (optional)
- Current state: Issues and PRs closed since last release, un-documented
- Desired state: Changelog entry, migration SQL, and GH release all published

## Constraints (E - Explicit)
- Must query both 0xHoneyJar/score-api AND 0xHoneyJar/midi-interface
- User changelog text must match zerker's established voice (see Voice Guide below)
- All artifacts require user review before writing
- Migration uses ON CONFLICT DO UPDATE for idempotency
- Version conventions: DB=v0.4, package.json=0.4.0, tag=v0.4, changelog=v0.4.0

## Verification (E - Easy to Verify)
- Changelog entry matches v0.2/v0.3 format in docs/CHANGELOG.md
- Migration SQL matches pattern in supabase/migrations/102_v0.3_user_changelog.sql
- All closed issues and merged PRs from both repos are captured
- Contributors are properly credited

## Reproducibility (R - Reproducible)
- release-collector.sh produces identical JSON for same inputs
- Templates enforce consistent output format
</kernel_framework>

---

## User Changelog Voice Guide

The `user_changelog` entries that appear in the FE changelog modal must match zerker's established voice.

### Content Priority (Most Important First)

1. **New features & additions** -- new scoring factors, new UI components, new flows, new badges. This is what users care about most. Like game patch notes, players want to see new content.
2. **Scoring formula changes** -- changes to how scores are calculated, new dimensions, weight adjustments. Users want to know how their score is affected.
3. **Bug fixes (minimal)** -- at most 1-2 high-level bullet points. Keep it brief and non-technical. Users expected these things to work already, so don't dwell on them. Frame as improvements, not admissions of broken things.

### Framing Philosophy

Think of it like a game update for players:
- Players want to hear about **new content, new mechanics, new rewards**
- Players do NOT want to read a long list of bug fixes -- those things should have worked in the first place
- A single line like "Various stability and accuracy improvements" covers most bug fixes
- Only call out a specific fix if users actively reported it and would want to know it's resolved

### Voice Characteristics
- Second person: "your", "you"
- Direct and conversational
- Explains user impact, not technical implementation
- 1-2 sentences max
- Mentions specific features by name (badges, Diamond Hands, etc.)
- Lead with what's new, not what was broken

### Pattern
- Features: `[New thing] + [what it means for you]`
- Scoring: `[What changed in scoring] + [how it affects your score]`
- Fixes (rare): `[Thing that works better now]` -- no need to explain what was broken

### Reference Examples (v0.2)
- "Scores now resync automatically every 6 hours to keep your profile up to date."
- "Staked and loaned Miberas now count toward your quality score instead of being excluded."
- "Burning Miberas is now recognized as a high-conviction action and positively impacts your onchain dimension score. Dedicated burners also unlock the Mibera Burner badge."
- "Staking, loaning, and burning Miberas are no longer counted as selling. If you never actually sold, your Diamond Hands status is restored."
- "Your profile now shows a detailed breakdown of your Mibera journey -- acquired, disposed, and active positions."
- "Your profile now shows a detailed breakdown of your Mibera collection with individual swag tier rankings."

### Reference Examples (v0.3)
- "You can now link multiple wallets together. All your linked wallets are combined into a single score, and transfers between your own wallets are ignored."
- "BGT validator boosts now track the correct Mibera Ancient validator. If your BGT amount looked lower than expected, it should now reflect your full boost history."
- "Link your additional wallets in the settings tab so all your activity -- holdings, mints, burns, staking, and DeFi -- counts towards one unified score."

### Anti-Patterns (DO NOT)
- Long bug fix lists: "Fixed X, fixed Y, fixed Z, fixed W" -- consolidate into one line
- Technical jargon: "Migrated from sequential to parallel Promise.allSettled execution"
- Third person: "Users can now..."
- Vague: "Performance improvements were made"
- Too long: More than 2 sentences
- Dwelling on bugs: Don't list every fix individually -- users expected it to work

---

<workflow>

## Phase 0: Pre-Flight

### Step 0.1: Verify Dependencies

```bash
gh auth status
jq --version
```

If either fails, halt with installation instructions.

### Step 0.2: Auto-Detect Since Date

Parse `docs/CHANGELOG.md` for the latest version header:
```
## vX.Y.Z (YYYY-MM-DD) -- Summary
```

Extract the date `YYYY-MM-DD`. This becomes the `--since` value.

If `--since` was provided as input, use that instead.

### Step 0.3: Auto-Detect Version

Read `package.json` -> `version` field (e.g., `0.3.0`).

Bump the minor component: `0.3.0` -> `0.4.0`.

Derive:
- Full version: `v0.4.0` (for changelog header)
- Short version: `v0.4` (for DB, git tag)
- Package version: `0.4.0` (for package.json)

If `--version` was provided as input, use that instead.

### Step 0.4: Auto-Detect Migration Number

List `supabase/migrations/` and find the highest numeric prefix:
```bash
ls supabase/migrations/ | grep -E '^[0-9]+_' | sed 's/_.*//' | sort -n | tail -1
```

Add 1 to get the next migration number.

### Step 0.5: Present Summary

Show the user:
```
Release Pre-Flight
  Version:    v0.4 (v0.4.0 in changelog, 0.4.0 in package.json)
  Since:      2026-02-16 (v0.3.0 release date)
  Migration:  113_v0.4_user_changelog.sql
  Repos:      score-api, midi-interface

Proceed? [Y/n]
```

Wait for user confirmation before continuing.

---

## Phase 1: Data Collection

### Step 1.1: Run Collection Script

```bash
.claude/skills/releasing-version/resources/scripts/release-collector.sh \
  --since "{since_date}" \
  --version "{version_short}" \
  --output /tmp/release-data.json
```

### Step 1.2: Parse and Summarize

Read `/tmp/release-data.json` and present:

```
Data Collection Summary
  score-api:       {N} closed issues, {M} merged PRs
  midi-interface:  {N} closed issues, {M} merged PRs
  New migrations:  {N} files
  Contributors:    {list of logins}
```

### Step 1.3: Validate

If total issues + PRs across both repos is 0:
- Warn: "No closed issues or merged PRs found since {since_date}."
- Ask: "Adjust date range or proceed with empty release?"

---

## Phase 2: AI-Assisted Categorization

Read the JSON from `/tmp/release-data.json` and perform the following steps.

### Step 2.1: Classify Changes

For each issue and PR, classify into one of:
- **Scoring**: changes to factors, weights, pipeline, badges, tiers, formulas, scoring logic
- **Interface**: FE display, API endpoints, UI/UX, user-facing features in midi-interface
- **Infrastructure**: performance, security, tooling, tests, refactoring, CI/CD

Use the issue/PR title, labels, and body to determine classification.

### Step 2.2: Group by Topic

Group related issues and PRs into topics. Examples:
- "Multi-Wallet Linking" groups score-api #24, #27, midi-interface #17
- "Validator Booster Fix" groups score-api #24, #25

Cross-repo items related to the same feature should be in the same group.

### Step 2.3: Draft Before/After Table

For each topic group, draft one or more rows for the "What Changed" table:

```
| Change | Before | After |
|--------|--------|-------|
| Feature name | Old behavior description | New behavior description |
```

Reference PR descriptions and issue bodies for accurate before/after descriptions.

### Step 2.4: Identify Why Topics

For any topic group that:
- Has 2+ issues/PRs, OR
- Represents a major architectural decision, OR
- Addresses a user-reported problem

Create a "Why" section with:
- **Problem:** (from issue body)
- **Decision:** (from PR description)
- **Why [decision]?** (reasoning from comments or commit messages)

### Step 2.5: Draft User Changelog Entries

For each user-visible change, draft a `{section, title, description}` entry following the Voice Guide above.

- `section`: "Scoring" or "Interface"
- `title`: Short feature name (2-4 words)
- `description`: User-facing impact description (1-2 sentences, second person)

### Step 2.6: Map Contributors

For each contributor identified in the collection data:
1. Determine what feedback they provided (from issue bodies and comments)
2. Map to the issues/PRs they contributed to
3. Use GitHub username as display name (user can override)

**Excluded from contributors:** Team members (zksoju, notzerker) are filtered out automatically — they report community feedback but are not the actual users who provided it. Only external community members appear in the contributors table.

Format:
```
| Contributor | Feedback | Issue |
|-------------|----------|-------|
| Name | What they reported/requested | repo #N, repo #M |
```

### Step 2.7: Auto-Suggest Release Title

#### Step 2.7a: Technical Subtitle

Based on the top 1-2 topic groups, suggest a release subtitle. Examples:
- "Multi-Wallet & Hardening"
- "Lifecycle Tracking"
- "Pipeline Optimization & Badges"

#### Step 2.7b: Codex Name Selection

Load `.claude/data/lore/mibera/codex-releases.yaml`.

1. Check `assigned` list — if this version already has a name, use it.
2. For new versions, read the `pool` entries and match tags against
   the release's topic classifications (from Step 2.1):
   - Scoring-heavy releases → favor tags: philosophy, time, transformation
   - Interface-heavy releases → favor tags: community, social, collective
   - Infrastructure-heavy releases → favor tags: precision, security, network
3. Present top 3 candidates:
   ```
   Codex Name Suggestions:
     1. {Name} — "{short}" (tags: {tags})
     2. {Name} — "{short}" (tags: {tags})
     3. {Name} — "{short}" (tags: {tags})
     Or: Enter a custom Codex name
     Or: Skip Codex naming

   Selected: ___
   ```
4. Compose final title: `{Codex Name} — {Technical Subtitle}`

If the lore file doesn't exist or pool is empty, skip Step 2.7b silently and use technical subtitle only.

### Step 2.8: Present for Review

Show the full categorization to the user:

```
Release: v0.4 -- "{suggested_title}"

Scoring Changes ({N}):
  [list of classified items]

Interface Changes ({N}):
  [list of classified items]

Infrastructure Changes ({N}):
  [list of classified items]

Why Topics: {list}

User Changelog ({N} entries):
  [draft entries]

Contributors ({N}):
  [contributor table]
```

Wait for user feedback. Allow edits to:
- Release title
- Change classifications
- User changelog text
- Contributor names and descriptions

---

## Phase 3: Artifact Generation

### Step 3.1: Generate Changelog Entry

Create the `docs/CHANGELOG.md` entry following the template in
`resources/templates/changelog-entry.md`.

**Format (must match v0.2/v0.3 exactly):**

If a Codex name was selected in Step 2.7b, use the enriched format. Otherwise, fall back to `## v{VERSION_FULL} ({DATE}) — {SUBTITLE}`.

```markdown
## v{VERSION_FULL} ({DATE}) — {CODEX_NAME} — {SUBTITLE}

**PRs:** [#N](https://github.com/0xHoneyJar/{repo}/pull/N), ...
**Issues:** [#N](https://github.com/0xHoneyJar/{repo}/issues/N), ...

### What Changed

| Change | Before | After |
|--------|--------|-------|
{rows from Step 2.3}

{Why sections from Step 2.4}

### Migrations

| Migration | Purpose |
|-----------|---------|
{migration rows from collected data}

### Contributors

Community feedback that drove v{VERSION_FULL} changes:

| Contributor | Feedback | Issue |
|-------------|----------|-------|
{contributor rows from Step 2.6}
```

**Placement:** Prepend after line 6 (`---`) of `docs/CHANGELOG.md`.

**Also update:**
- Issue Cross-Reference table at bottom of file
- Version Mapping table at bottom of file

Present for user review.

### Step 3.2: Generate Migration SQL

Create `supabase/migrations/{NNN}_v{VERSION_SHORT}_user_changelog.sql` following
`resources/templates/migration-user-changelog.sql`.

```sql
-- Migration {NNN}: Register scoring version v{VERSION_SHORT} and add user-facing changelog

INSERT INTO scoring_versions (version, summary, scoring_config)
VALUES (
  'v{VERSION_SHORT}',
  '{TITLE}',
  jsonb_build_object(
    'user_changelog', '[
      {user_changelog entries from Step 2.5, formatted as JSON}
    ]'::jsonb
  )
)
ON CONFLICT (version) DO UPDATE
SET summary = EXCLUDED.summary,
    scoring_config = EXCLUDED.scoring_config;
```

Present for user review.

### Step 3.3: Generate GitHub Release Notes

Create release notes following `resources/templates/github-release.md`.

```markdown
## {TITLE}

{2-3 sentence overview of what this release includes}

### Highlights

- {Top changes as bullet points}

### What's New for Users

- {User changelog entries as bullets}

---

Full changelog: [docs/CHANGELOG.md](docs/CHANGELOG.md)
```

Present for user review.

---

## Phase 4: Review & Apply

Each step requires explicit user approval before proceeding.

### Step 4.1: Write Changelog

Prepend the changelog entry to `docs/CHANGELOG.md`.
Update Issue Cross-Reference and Version Mapping tables.

### Step 4.2: Write Migration

Write the migration SQL file to `supabase/migrations/{NNN}_v{VERSION_SHORT}_user_changelog.sql`.

### Step 4.3: Bump Version

Update `package.json` version field from `{current}` to `{new}`.

### Step 4.4: Git Tag (Optional)

```bash
git tag -a v{VERSION_SHORT} -m "v{VERSION_SHORT}: {TITLE}"
```

Ask user if they want to create the tag.

### Step 4.5: GitHub Release (Optional)

```bash
gh release create v{VERSION_SHORT} --title "{CODEX_NAME} — {SUBTITLE}" --notes-file /tmp/release-notes.md
```

If no Codex name was selected, fall back to: `--title "v{VERSION_SHORT}: {SUBTITLE}"`

Ask user if they want to create the release.

### Step 4.6: Apply Migration (Optional)

```bash
./scripts/db-migrate.sh {NNN}
```

Ask user if they want to apply the migration now or defer.

### Step 4.7: Summary

Present final summary:
```
Release v{VERSION_SHORT} Complete
  Changelog:  docs/CHANGELOG.md updated
  Migration:  supabase/migrations/{NNN}_v{VERSION_SHORT}_user_changelog.sql written
  Version:    package.json bumped to {VERSION_FULL}
  Tag:        {created/skipped}
  Release:    {created/skipped}
  Migration:  {applied/deferred}
```

</workflow>

<success_criteria>
## Success Criteria

- All closed issues and merged PRs from both repos are captured in the collection
- Changelog entry matches v0.2/v0.3 format exactly
- User changelog text follows the Voice Guide
- Migration SQL is idempotent (re-runnable)
- Contributors are properly credited with accurate feedback descriptions
- All three artifacts are generated and reviewed before any writes
- Version conventions are correct across all outputs
</success_criteria>

<uncertainty_protocol>
When facing uncertainty:

1. **Missing contributor attribution**: Fall back to GitHub username, flag for user to provide community name
2. **Unclear change categorization**: Default to Infrastructure, present for user to reclassify
3. **Cross-repo issue linking unclear**: Present both separately, let user confirm grouping
4. **Before/After unclear from PR description**: Mark as "[needs description]", ask user to fill in
5. **Zero data collected**: Warn and confirm date range before proceeding
</uncertainty_protocol>
