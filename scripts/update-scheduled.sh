#!/usr/bin/env bash
# =============================================================================
# openclaw-update-scheduled.sh
#
# Non-interactive scheduled update for the postgresql-support fork of OpenClaw.
# Fetches upstream/main, rebases postgresql-support onto it, rebuilds, and
# pushes to origin — while preserving all PostgreSQL-specific source files.
#
# Designed to run unattended via systemd timer (no stdin, no prompts).
# Exit codes:
#   0  — already up-to-date, or successfully updated
#   1  — rebase conflict (rebase was aborted, backup tag left in place)
#   2  — build failure (changes rolled back to backup tag)
#   3  — PostgreSQL files missing after rebase (rolled back)
#   4  — pre-flight check failed (wrong branch, dirty tree)
#   5  — push failed (local state is good; push can be retried)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
REPO_DIR="/home/molty/projects/openclaw"
TARGET_BRANCH="postgresql-support"
UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="main"
ORIGIN_REMOTE="origin"

LOG_DIR="/home/molty/.openclaw/logs"
LOG_FILE="${LOG_DIR}/openclaw-update-$(date +%Y%m%d).log"

# PostgreSQL-specific files that must survive the rebase
POSTGRESQL_FILES=(
  "src/memory/db-adapter.ts"
  "src/memory/db-factory.ts"
  "src/memory/sqlite-adapter.ts"
  "src/memory/postgresql-adapter.ts"
)

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
mkdir -p "$LOG_DIR"

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
info() { log "INFO  $*"; }
ok()   { log "OK    $*"; }
warn() { log "WARN  $*"; }
fail() { log "ERROR $*"; }

# ---------------------------------------------------------------------------
# Trap: always log the final outcome
# ---------------------------------------------------------------------------
_exit_code=0
cleanup() {
  local code=$?
  if [[ $code -eq 0 ]]; then
    info "=== Update run finished successfully ==="
  else
    fail "=== Update run FAILED (exit code ${code}) ==="
  fi
  exit $code
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Go to repo
# ---------------------------------------------------------------------------
info "=== OpenClaw PostgreSQL-aware scheduled update ==="
info "Repository : ${REPO_DIR}"
info "Target     : ${TARGET_BRANCH}"
info "Upstream   : ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
info "Log file   : ${LOG_FILE}"
echo ""

cd "$REPO_DIR"

# ---------------------------------------------------------------------------
# Pre-flight: must be on the right branch
# ---------------------------------------------------------------------------
current_branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$current_branch" != "$TARGET_BRANCH" ]]; then
  fail "Expected branch '${TARGET_BRANCH}', currently on '${current_branch}'"
  fail "Switching to ${TARGET_BRANCH}…"
  git checkout "$TARGET_BRANCH" 2>&1 | tee -a "$LOG_FILE" || {
    fail "Cannot switch branch — aborting"
    exit 4
  }
fi

# Pre-flight: working tree must be clean
if ! git diff-index --quiet HEAD --; then
  fail "Working tree has uncommitted changes — aborting to avoid data loss"
  git status --short 2>&1 | tee -a "$LOG_FILE"
  exit 4
fi

ok "Pre-flight checks passed (branch: ${TARGET_BRANCH}, tree: clean)"

# ---------------------------------------------------------------------------
# Fetch upstream
# ---------------------------------------------------------------------------
info "Fetching ${UPSTREAM_REMOTE}…"
git fetch "$UPSTREAM_REMOTE" 2>&1 | tee -a "$LOG_FILE"
ok "Fetch complete"

# ---------------------------------------------------------------------------
# Check if we are behind
# ---------------------------------------------------------------------------
behind=$(git rev-list --count "${TARGET_BRANCH}..${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}")
ahead=$(git rev-list  --count "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}..${TARGET_BRANCH}")

info "Branch status: ${ahead} ahead, ${behind} behind ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"

if [[ "$behind" -eq 0 ]]; then
  ok "Already up-to-date — nothing to do"
  exit 0
fi

info "New upstream commits (latest 20):"
git log --oneline --graph "${TARGET_BRANCH}..${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" \
    | head -20 | tee -a "$LOG_FILE"

# ---------------------------------------------------------------------------
# Create backup tag
# ---------------------------------------------------------------------------
backup_tag="backup-pre-update-$(date +%Y%m%d-%H%M%S)"
info "Creating backup tag: ${backup_tag}"
git tag "$backup_tag"
ok "Backup tag created (restore with: git reset --hard ${backup_tag})"

# ---------------------------------------------------------------------------
# Rebase
# ---------------------------------------------------------------------------
info "Rebasing ${TARGET_BRANCH} onto ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}…"

if ! git rebase "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" 2>&1 | tee -a "$LOG_FILE"; then
  fail "Rebase conflict detected — aborting rebase"
  git rebase --abort 2>&1 | tee -a "$LOG_FILE" || true
  fail "Backup tag '${backup_tag}' preserved for manual recovery"
  fail "To restore: git reset --hard ${backup_tag}"
  fail "To resolve manually: run ./sync-upstream.sh"
  exit 1
fi

ok "Rebase succeeded"

# ---------------------------------------------------------------------------
# Verify PostgreSQL files are still present
# ---------------------------------------------------------------------------
info "Verifying PostgreSQL-specific files survived the rebase…"
missing=()
for f in "${POSTGRESQL_FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    missing+=("$f")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  fail "PostgreSQL files missing after rebase:"
  for f in "${missing[@]}"; do
    fail "  MISSING: ${f}"
  done
  fail "Rolling back to backup tag '${backup_tag}'…"
  git reset --hard "$backup_tag" 2>&1 | tee -a "$LOG_FILE"
  exit 3
fi

ok "All PostgreSQL files intact"

# ---------------------------------------------------------------------------
# Reinstall dependencies
# ---------------------------------------------------------------------------
info "Installing dependencies (pnpm install)…"
pnpm install --frozen-lockfile 2>&1 | tee -a "$LOG_FILE" || {
  warn "Frozen lockfile install failed — retrying without --frozen-lockfile"
  pnpm install 2>&1 | tee -a "$LOG_FILE"
}
ok "Dependencies installed"

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
info "Building OpenClaw…"
if ! npm run build 2>&1 | tee -a "$LOG_FILE"; then
  fail "Build failed — rolling back to backup tag '${backup_tag}'…"
  git reset --hard "$backup_tag" 2>&1 | tee -a "$LOG_FILE"
  exit 2
fi

ok "Build succeeded"

# ---------------------------------------------------------------------------
# Push to origin
# ---------------------------------------------------------------------------
info "Pushing ${TARGET_BRANCH} to ${ORIGIN_REMOTE} (force-with-lease)…"
if ! git push "$ORIGIN_REMOTE" "$TARGET_BRANCH" --force-with-lease \
       2>&1 | tee -a "$LOG_FILE"; then
  fail "Push failed — local state is good; push can be retried manually:"
  fail "  git push ${ORIGIN_REMOTE} ${TARGET_BRANCH} --force-with-lease"
  exit 5
fi

ok "Pushed to origin/${TARGET_BRANCH}"

# ---------------------------------------------------------------------------
# Clean up old backup tags (keep last 5)
# ---------------------------------------------------------------------------
info "Pruning old backup tags (keeping 5 most recent)…"
mapfile -t old_tags < <(
  git tag | grep '^backup-pre-update-' | sort | head -n -5
)
for tag in "${old_tags[@]}"; do
  git tag -d "$tag" 2>&1 | tee -a "$LOG_FILE" && info "  Deleted tag: ${tag}"
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
new_ahead=$(git rev-list --count "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}..${TARGET_BRANCH}")
info "=== Update complete ==="
info "  Upstream commits merged : ${behind}"
info "  Our commits (PostgreSQL): ${new_ahead}"
info "  Backup tag              : ${backup_tag}"
info "  Log                     : ${LOG_FILE}"
info ""
info "  To verify:"
info "    git log --oneline -10"
info "    psql \$PG_CONN_STR -c '\\dn' | grep agent_"
