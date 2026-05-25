# GitHub Release Template

> This template defines the format for GitHub Release notes.
> Used with: `gh release create v{VERSION} --title "v{VERSION}: {TITLE}" --notes-file /tmp/release-notes.md`

## Format

```markdown
## {TITLE}

{2-3 sentence overview of what this release includes. Keep it high-level and user-focused.}

### Highlights

- **{Feature/Fix Name}**: {One sentence description}
- **{Feature/Fix Name}**: {One sentence description}

### What's New for Users

- {User changelog entry 1 - same text as migration user_changelog description}
- {User changelog entry 2}

---

Full changelog: [docs/CHANGELOG.md](docs/CHANGELOG.md)
```

## Rules

1. **Overview** is 2-3 sentences max, conversational tone
2. **Highlights** are the top 3-5 most significant changes (technical + user-facing)
3. **What's New for Users** mirrors the `user_changelog` entries from the migration
4. **Link** to full changelog at the bottom
5. Do NOT include migration details or contributor table (those live in docs/CHANGELOG.md)
