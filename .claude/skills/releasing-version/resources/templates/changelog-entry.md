# Changelog Entry Template

> This template defines the exact format for `docs/CHANGELOG.md` entries.
> Follow the structure precisely to match v0.2 and v0.3 entries.

## Format

```markdown
## v{VERSION_FULL} ({DATE}) -- {TITLE}

**PRs:** [#N](https://github.com/0xHoneyJar/score-api/pull/N), [#M](https://github.com/0xHoneyJar/midi-interface/pull/M)
**Issues:** [#N](https://github.com/0xHoneyJar/score-api/issues/N), [#M](https://github.com/0xHoneyJar/midi-interface/issues/M)

### What Changed

| Change | Before | After |
|--------|--------|-------|
| Feature name | Old behavior | New behavior |
| Bug description | Broken state | Fixed state |

### Why: {Topic Name}

**Problem:** {Description of the user-facing or architectural problem}

**Decision:** {What was decided and implemented}

**Why {decision}?** {Reasoning and tradeoffs}

### Migrations

| Migration | Purpose |
|-----------|---------|
| `{NNN}_{name}.sql` | {What it does} |

### Contributors

Community feedback that drove v{VERSION_FULL} changes:

| Contributor | Feedback | Issue |
|-------------|----------|-------|
| {Name} | {What they reported or requested} | {repo} #{N} |
```

## Rules

1. **PR/Issue links** include the full GitHub URL
2. **Cross-repo items** prefix with repo name: `score-api #24, midi-interface #17`
3. **What Changed table** uses pipe-delimited markdown, one row per visible change
4. **Why sections** only for major decisions (2+ issues or architectural significance)
5. **Migrations table** lists only NEW migrations added since last release
6. **Contributors table** credits community feedback-givers, not just PR authors
7. **Date format** is `YYYY-MM-DD`
8. **Version format** in header is 3-part: `v0.4.0`
