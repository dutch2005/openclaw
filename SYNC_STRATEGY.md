# Sync Strategy for PostgreSQL Support Branch

## Overview

The `postgresql-support` branch contains 34 commits of PostgreSQL functionality built on top of OpenClaw. This document explains how to keep it synchronized with upstream while preserving all PostgreSQL features.

## Current Branch Status

```bash
Branch: postgresql-support
Based on: openclaw/openclaw:main (commit a19ea7d40)
Commits ahead: 34
Commits behind: TBD (check with: git fetch upstream && git log postgresql-support..upstream/main)
```

## Key PostgreSQL Commits

1. **Core Implementation** (84ec6da0b)
   - Database adapter interface
   - SQLite adapter (refactored from existing code)
   - PostgreSQL adapter (new)
   - Factory for creating adapters
   - Configuration schema updates

2. **Documentation & Tools** (19b7b9184, cdcd9e8e2, a93335047)
   - Comprehensive 67-page database configuration guide
   - Performance analysis
   - Implementation status
   - PR instructions

3. **Migration & Setup** (1f1c0ddf2, 462d195a2, a3899185a)
   - Migration script (SQLite → PostgreSQL)
   - Database health check utility
   - Benchmark script
   - Setup automation
   - Decision advisor

4. **Testing** (29d2c460b, e328bc142)
   - Database factory tests (26 test cases)

5. **Example Configurations** (4 files in examples/configs/)
   - SQLite single-agent
   - PostgreSQL multi-agent
   - PostgreSQL production
   - PostgreSQL Docker

## Synchronization Methods

### Method 1: Rebase on Upstream (Clean History)

**Pros:**

- Linear commit history
- Easy to review in PR
- No merge commits

**Cons:**

- Rewrites history (requires force push)
- Can be complex if conflicts arise

**Steps:**

```bash
# 1. Fetch latest upstream
git fetch upstream

# 2. Rebase postgresql-support on upstream/main
git checkout postgresql-support
git rebase upstream/main

# 3. Resolve any conflicts
# If conflicts:
#   - Fix conflicts in files
#   - git add <resolved-files>
#   - git rebase --continue
# Repeat until rebase completes

# 4. Force push (updates your fork)
git push origin postgresql-support --force-with-lease
```

**Handling Conflicts:**

If the same files were modified in both branches:

- **src/memory/manager.ts** - Most likely conflict point
- **package.json** - Dependencies may conflict
- **CHANGELOG.md** - Merge both entries

To abort if things go wrong:

```bash
git rebase --abort
```

### Method 2: Merge from Upstream (Preserves History)

**Pros:**

- Preserves exact commit history
- Easier to resolve conflicts
- Can undo with `git reset`

**Cons:**

- Creates merge commits
- Less clean history

**Steps:**

```bash
# 1. Fetch latest upstream
git fetch upstream

# 2. Merge upstream/main into postgresql-support
git checkout postgresql-support
git merge upstream/main

# 3. Resolve any conflicts
# If conflicts:
#   - Fix conflicts in files
#   - git add <resolved-files>
#   - git commit

# 4. Push to your fork
git push origin postgresql-support
```

### Method 3: Cherry-pick Specific Upstream Commits

**Use when:** You only need specific upstream fixes

```bash
# 1. Fetch upstream
git fetch upstream

# 2. Find commit you want
git log upstream/main --oneline | grep "bug fix"

# 3. Cherry-pick it
git cherry-pick <commit-hash>

# 4. Push
git push origin postgresql-support
```

## Automated Sync Script

Create `/home/molty/projects/openclaw/sync-upstream.sh`:

```bash
#!/bin/bash
#
# Sync postgresql-support branch with upstream OpenClaw
#

set -e

cd "$(dirname "$0")"

echo "🔄 Syncing postgresql-support with upstream..."

# Fetch upstream
echo "📥 Fetching upstream..."
git fetch upstream

# Check current branch
current_branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$current_branch" != "postgresql-support" ]; then
  echo "⚠️  Not on postgresql-support branch. Switching..."
  git checkout postgresql-support
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
  echo "❌ You have uncommitted changes. Commit or stash them first."
  exit 1
fi

# Show what will change
echo ""
echo "📊 Upstream changes:"
git log --oneline postgresql-support..upstream/main | head -10

echo ""
read -p "Continue with rebase? (y/N) " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Cancelled"
  exit 0
fi

# Rebase
echo ""
echo "🔀 Rebasing..."
if git rebase upstream/main; then
  echo "✅ Rebase successful!"

  # Push
  echo ""
  read -p "Push to origin? (y/N) " -n 1 -r
  echo

  if [[ $REPLY =~ ^[Yy]$ ]]; then
    git push origin postgresql-support --force-with-lease
    echo "✅ Pushed to origin"
  fi

  # Show summary
  echo ""
  echo "📊 Commits ahead of upstream:"
  git log --oneline upstream/main..postgresql-support | wc -l
else
  echo "❌ Rebase failed. Resolve conflicts and run:"
  echo "   git add <resolved-files>"
  echo "   git rebase --continue"
  echo ""
  echo "Or abort with:"
  echo "   git rebase --abort"
  exit 1
fi
```

Make it executable:

```bash
chmod +x sync-upstream.sh
```

Run it:

```bash
./sync-upstream.sh
```

## Deployment Strategy

### Scenario A: PR Accepted Quickly

```bash
# 1. PR merged into openclaw/openclaw:main
# 2. Update your fork's main branch
git checkout main
git pull upstream main
git push origin main

# 3. Delete postgresql-support branch (no longer needed)
git branch -d postgresql-support
git push origin --delete postgresql-support

# 4. Deploy official OpenClaw
npm install -g openclaw@latest
```

### Scenario B: Using Fork While PR Pending

```bash
# 1. Keep syncing with upstream
./sync-upstream.sh  # Run weekly

# 2. Deploy from your fork
cd /home/molty/projects/openclaw
npm run build
npm pack

# 3. Install on production LXCs
scp openclaw-*.tgz root@192.168.1.173:/root/
ssh root@192.168.1.173 "npm install -g /root/openclaw-*.tgz"
```

### Scenario C: Long-term Fork Maintenance

```bash
# 1. Version your fork differently
# package.json: "version": "2026.2.16-postgresql.1"

# 2. Keep syncing
./sync-upstream.sh  # Weekly

# 3. Tag releases
git tag v2026.2.16-postgresql.1
git push origin --tags
```

## Checking Sync Status

At any time, check how many commits you're ahead/behind:

```bash
# Fetch latest
git fetch upstream

# Commits behind (upstream has that you don't)
echo "Commits behind:"
git log --oneline postgresql-support..upstream/main | wc -l

# Commits ahead (you have that upstream doesn't)
echo "Commits ahead:"
git log --oneline upstream/main..postgresql-support | wc -l

# Show actual commits
git log --oneline postgresql-support..upstream/main    # Behind
git log --oneline upstream/main..postgresql-support    # Ahead
```

## Conflict Resolution Tips

### Common Conflict Points

1. **src/memory/manager.ts**
   - Your changes: Added adapter factory usage
   - Potential upstream changes: Bug fixes, new features
   - **Resolution:** Keep both changes, integrate them

2. **package.json**
   - Your changes: Added `pg`, `pgvector-node` dependencies
   - Potential upstream changes: Version bump, new dependencies
   - **Resolution:** Merge dependencies, keep latest version

3. **CHANGELOG.md**
   - Your changes: PostgreSQL feature entry
   - Potential upstream changes: Other feature entries
   - **Resolution:** Keep both entries in chronological order

### Conflict Resolution Workflow

```bash
# 1. During rebase, if conflict occurs:
git status  # See conflicting files

# 2. Open conflicting file, look for:
<<<<<<< HEAD
Your changes
=======
Upstream changes
>>>>>>> upstream/main

# 3. Edit file to keep both changes (if possible)

# 4. Stage resolved file
git add <file>

# 5. Continue rebase
git rebase --continue

# 6. Repeat for all conflicts
```

## Verification After Sync

After syncing, verify PostgreSQL support still works:

```bash
# 1. Run tests
npm test -- src/memory/db-factory.test.ts

# 2. Check health
node scripts/check-database-health.cjs --driver postgresql

# 3. Run benchmark
node scripts/benchmark-database.cjs --iterations 10

# 4. Verify integration (if PostgreSQL available)
# Test vector search, full-text search, etc.
```

## Rollback Plan

If sync breaks something:

```bash
# Option 1: Abort rebase
git rebase --abort

# Option 2: Reset to previous state
git reflog  # Find previous HEAD
git reset --hard HEAD@{1}

# Option 3: Force push previous version
git push origin postgresql-support --force
```

## Best Practices

1. **Sync Regularly**
   - Run `./sync-upstream.sh` weekly
   - Don't let postgresql-support drift too far

2. **Test After Sync**
   - Run test suite
   - Verify health check passes
   - Test on dev environment before production

3. **Commit Granularly**
   - Keep PostgreSQL changes in separate commits
   - Makes conflict resolution easier

4. **Document Conflicts**
   - If you resolve a conflict, note it in commit message
   - Example: "Merge upstream/main, resolved conflict in manager.ts"

5. **Backup Before Sync**
   ```bash
   git tag backup-$(date +%Y%m%d)
   git push origin --tags
   ```

## Summary

**To answer your original question:**

✅ **Yes, the postgresql-support branch can be submitted to official OpenClaw**

- Via PR: https://github.com/openclaw/openclaw/compare/main...dutch2005:postgresql-support

✅ **Yes, updates from main can be merged without losing functionality**

- Use rebase (clean history) or merge (preserves history)
- PostgreSQL code is isolated in specific files
- Conflicts are unlikely and easy to resolve

✅ **Backward compatible**

- SQLite remains default
- PostgreSQL is opt-in
- No breaking changes

**Recommended workflow:**

1. Submit PR now
2. While PR is under review, keep syncing with upstream using `./sync-upstream.sh`
3. Use your fork in production until PR is merged
4. Once merged, switch to official OpenClaw

---

**Next Steps:**

1. **Immediate:** Submit PR to upstream

   ```bash
   # Visit: https://github.com/openclaw/openclaw/compare/main...dutch2005:postgresql-support
   ```

2. **Weekly:** Sync with upstream

   ```bash
   ./sync-upstream.sh
   ```

3. **As needed:** Deploy from fork
   ```bash
   npm run build && npm pack
   # Deploy to production LXCs
   ```
