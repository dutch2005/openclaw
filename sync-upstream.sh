#!/bin/bash
#
# Sync postgresql-support branch with upstream OpenClaw
# Usage: ./sync-upstream.sh
#

set -e

cd "$(dirname "$0")"

echo "🔄 Syncing postgresql-support with upstream OpenClaw..."
echo ""

# Check if upstream remote exists
if ! git remote get-url upstream &>/dev/null; then
  echo "❌ Upstream remote not configured"
  echo "   Add it with:"
  echo "   git remote add upstream https://github.com/openclaw/openclaw.git"
  exit 1
fi

# Fetch upstream
echo "📥 Fetching upstream..."
git fetch upstream

# Check current branch
current_branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$current_branch" != "postgresql-support" ]; then
  echo "⚠️  Not on postgresql-support branch (currently on: $current_branch)"
  read -p "Switch to postgresql-support? (y/N) " -n 1 -r
  echo

  if [[ $REPLY =~ ^[Yy]$ ]]; then
    git checkout postgresql-support
  else
    echo "❌ Cancelled"
    exit 0
  fi
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
  echo "❌ You have uncommitted changes:"
  echo ""
  git status --short
  echo ""
  echo "Commit or stash them first:"
  echo "  git stash"
  echo "  # or"
  echo "  git commit -am 'WIP: temporary commit'"
  exit 1
fi

# Show status
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Current Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Branch: $(git rev-parse --abbrev-ref HEAD)"
echo "Latest local commit: $(git log -1 --oneline)"
echo ""

# Check how far ahead/behind
ahead=$(git rev-list --count upstream/main..postgresql-support)
behind=$(git rev-list --count postgresql-support..upstream/main)

echo "Commits ahead of upstream/main: $ahead"
echo "Commits behind upstream/main: $behind"
echo ""

if [ "$behind" -eq 0 ]; then
  echo "✅ Already up to date with upstream!"
  exit 0
fi

# Show what will change
echo "📊 Upstream changes to be synced:"
echo ""
git log --oneline --graph postgresql-support..upstream/main | head -20
echo ""

# Confirm
read -p "Continue with rebase? (y/N) " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Cancelled"
  exit 0
fi

# Create backup tag
backup_tag="backup-$(date +%Y%m%d-%H%M%S)"
echo ""
echo "📦 Creating backup tag: $backup_tag"
git tag "$backup_tag"
echo "   (Restore with: git reset --hard $backup_tag)"

# Rebase
echo ""
echo "🔀 Rebasing postgresql-support on upstream/main..."
echo ""

if git rebase upstream/main; then
  echo ""
  echo "✅ Rebase successful!"

  # Show new status
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Post-Rebase Status"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  ahead=$(git rev-list --count upstream/main..postgresql-support)
  echo "Commits ahead of upstream/main: $ahead"
  echo ""
  git log --oneline upstream/main..postgresql-support | head -10
  echo ""

  # Confirm push
  read -p "Push to origin (force-with-lease)? (y/N) " -n 1 -r
  echo

  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "📤 Pushing to origin..."
    git push origin postgresql-support --force-with-lease
    echo "✅ Pushed to origin"

    # Delete backup tag (no longer needed)
    git tag -d "$backup_tag"
  else
    echo ""
    echo "⚠️  Not pushed. Push manually with:"
    echo "   git push origin postgresql-support --force-with-lease"
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✅ Sync Complete!"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "Next steps:"
  echo "  1. Verify tests pass: npm test"
  echo "  2. Check health: node scripts/check-database-health.cjs"
  echo "  3. Test PostgreSQL: npm test -- src/memory/db-factory.test.ts"
  echo ""

else
  echo ""
  echo "❌ Rebase failed - conflicts detected"
  echo ""
  echo "Conflicting files:"
  git status --short | grep '^UU'
  echo ""
  echo "📝 Resolution steps:"
  echo "   1. Open conflicting files and resolve conflicts"
  echo "   2. Stage resolved files: git add <file>"
  echo "   3. Continue rebase: git rebase --continue"
  echo "   4. Repeat until rebase completes"
  echo "   5. Push: git push origin postgresql-support --force-with-lease"
  echo ""
  echo "Or abort and restore backup:"
  echo "   git rebase --abort"
  echo "   git reset --hard $backup_tag"
  echo ""
  exit 1
fi
