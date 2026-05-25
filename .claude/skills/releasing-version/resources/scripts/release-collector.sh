#!/usr/bin/env bash
set -euo pipefail

# release-collector.sh — Collect release data from score-api + midi-interface repos
# Outputs structured JSON with closed issues, merged PRs, contributors, and new migrations.
#
# Usage:
#   release-collector.sh --since YYYY-MM-DD --version vX.Y [--output FILE]
#
# Requirements: gh (authenticated), jq, git

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"

# --- Defaults ---
SINCE=""
VERSION=""
OUTPUT=""
REPOS=("0xHoneyJar/score-api" "0xHoneyJar/midi-interface")
BOT_FILTER='select(.login != "github-actions[bot]" and .login != "dependabot[bot]" and .login != "renovate[bot]" and (.login | test("\\[bot\\]$") | not))'
# Team members to exclude from contributors — they report feedback, not provide it
TEAM_MEMBERS=("zksoju" "notzerker")
MIN_COMMENT_LENGTH=50

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --since)   SINCE="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --output)  OUTPUT="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: release-collector.sh --since YYYY-MM-DD --version vX.Y [--output FILE]"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# --- Validate ---
if [[ -z "$SINCE" || -z "$VERSION" ]]; then
  echo "Error: --since and --version are required" >&2
  exit 1
fi

if ! command -v gh &>/dev/null; then
  echo "Error: gh CLI not found. Install from https://cli.github.com" >&2
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "Error: gh not authenticated. Run 'gh auth login'" >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "Error: jq not found. Install via 'brew install jq'" >&2
  exit 1
fi

# --- Collect data ---
COLLECTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMMIT_HASH="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")"

# Temp dir for intermediate files
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Collect issues and PRs from each repo
for repo in "${REPOS[@]}"; do
  repo_key="${repo##*/}"  # Extract repo name (score-api or midi-interface)

  # Closed issues since date
  gh issue list --repo "$repo" \
    --state closed \
    --json number,title,body,author,closedAt,labels,comments \
    --limit 200 \
    2>/dev/null | jq --arg since "${SINCE}T00:00:00Z" '
    [.[] | select(.closedAt >= $since) | {
      number: .number,
      title: .title,
      body: (.body // ""),
      author: .author.login,
      closed_at: .closedAt,
      labels: [.labels[].name],
      comment_authors: [.comments[] | select((.body | length) > '"$MIN_COMMENT_LENGTH"') | .author.login] | unique
    }]
  ' > "$TMP_DIR/${repo_key}_issues.json"

  # Merged PRs since date
  gh pr list --repo "$repo" \
    --state merged \
    --json number,title,body,author,mergedAt,labels,comments \
    --limit 200 \
    2>/dev/null | jq --arg since "${SINCE}T00:00:00Z" '
    [.[] | select(.mergedAt >= $since) | {
      number: .number,
      title: .title,
      body: (.body // ""),
      author: .author.login,
      merged_at: .mergedAt,
      labels: [.labels[].name]
    }]
  ' > "$TMP_DIR/${repo_key}_prs.json"
done

# Collect new migration files since date
git -C "$REPO_ROOT" log --since="$SINCE" --name-only --diff-filter=A --format="" -- supabase/migrations/ 2>/dev/null \
  | sort -u \
  | sed 's|supabase/migrations/||' \
  | jq -R -s 'split("\n") | map(select(length > 0))' \
  > "$TMP_DIR/migrations.json"

# Extract unique contributors across all repos
jq -s '
  . as $all |
  # Gather all author+commenter pairs with their sources
  [
    # Issue authors
    ($all[0] // [] | .[] | {login: .author, type: "issue_author", repo: "score-api", ref: ("#" + (.number | tostring))}),
    ($all[1] // [] | .[] | {login: .author, type: "issue_author", repo: "midi-interface", ref: ("#" + (.number | tostring))}),
    # PR authors
    ($all[2] // [] | .[] | {login: .author, type: "pr_author", repo: "score-api", ref: ("#" + (.number | tostring))}),
    ($all[3] // [] | .[] | {login: .author, type: "pr_author", repo: "midi-interface", ref: ("#" + (.number | tostring))}),
    # Issue commenters
    ($all[0] // [] | .[] | .comment_authors[] as $ca | {login: $ca, type: "commenter", repo: "score-api", ref: ("#" + (.number | tostring))}),
    ($all[1] // [] | .[] | .comment_authors[] as $ca | {login: $ca, type: "commenter", repo: "midi-interface", ref: ("#" + (.number | tostring))})
  ]
  # Filter bots and team members (team members report feedback, not provide it)
  | map(select(.login != "github-actions[bot]" and .login != "dependabot[bot]" and .login != "renovate[bot]" and (.login | test("\\[bot\\]$") | not) and (.login | ascii_downcase) != "zksoju" and (.login | ascii_downcase) != "notzerker"))
  # Group by login
  | group_by(.login)
  | map({
      login: .[0].login,
      contributions: [.[] | {type: .type, repo: .repo, ref: .ref}] | unique
    })
  | sort_by(.login)
' \
  "$TMP_DIR/score-api_issues.json" \
  "$TMP_DIR/midi-interface_issues.json" \
  "$TMP_DIR/score-api_prs.json" \
  "$TMP_DIR/midi-interface_prs.json" \
  > "$TMP_DIR/contributors.json"

# --- Assemble final JSON ---
RESULT=$(jq -n \
  --arg version "$VERSION" \
  --arg since "$SINCE" \
  --arg collected_at "$COLLECTED_AT" \
  --arg commit_hash "$COMMIT_HASH" \
  --slurpfile sa_issues "$TMP_DIR/score-api_issues.json" \
  --slurpfile sa_prs "$TMP_DIR/score-api_prs.json" \
  --slurpfile mi_issues "$TMP_DIR/midi-interface_issues.json" \
  --slurpfile mi_prs "$TMP_DIR/midi-interface_prs.json" \
  --slurpfile contributors "$TMP_DIR/contributors.json" \
  --slurpfile migrations "$TMP_DIR/migrations.json" \
  '{
    version: $version,
    since: $since,
    collected_at: $collected_at,
    commit_hash: $commit_hash,
    repos: {
      "score-api": {
        issues: $sa_issues[0],
        pull_requests: $sa_prs[0]
      },
      "midi-interface": {
        issues: $mi_issues[0],
        pull_requests: $mi_prs[0]
      }
    },
    contributors: $contributors[0],
    new_migrations: $migrations[0]
  }')

# --- Output ---
if [[ -n "$OUTPUT" ]]; then
  echo "$RESULT" > "$OUTPUT"
  echo "Release data written to $OUTPUT" >&2
else
  echo "$RESULT"
fi
