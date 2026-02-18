# How to Submit PR to Upstream OpenClaw

## Automated Method (GitHub Web UI)

1. **Push your branch** (already done ✅):

   ```bash
   git push origin postgresql-support
   ```

2. **Visit your fork on GitHub**:

   ```
   https://github.com/dutch2005/openclaw
   ```

3. **GitHub will show a banner**:
   - "postgresql-support had recent pushes"
   - Click **"Compare & pull request"** button

4. **Or manually create PR**:
   - Go to: https://github.com/openclaw/openclaw/compare
   - Select:
     - **base repository**: openclaw/openclaw
     - **base**: main
     - **head repository**: dutch2005/openclaw
     - **compare**: postgresql-support
   - Click **"Create pull request"**

## PR Details to Fill In

### Title

```
feat(memory): Add configurable PostgreSQL support for multi-agent deployments
```

### Description

Use the comprehensive description from `/tmp/pr-description.md` or this summary:

````markdown
## Summary

Adds configurable PostgreSQL support as an optional database backend for OpenClaw's memory search system, enabling multi-agent shared knowledge deployments while keeping SQLite as the zero-config default.

## Key Changes

- **Database Adapter Layer**: Pluggable interface supporting SQLite and PostgreSQL
- **PostgreSQL Support**: pgvector for vector search, tsvector for full-text search
- **Schema Isolation**: Each agent gets its own PostgreSQL schema
- **Connection Pooling**: Efficient concurrent access
- **Migration Script**: Easy SQLite → PostgreSQL migration
- **Zero Breaking Changes**: SQLite remains the default

## Files Added

- `src/memory/db-adapter.ts` - Database adapter interface
- `src/memory/sqlite-adapter.ts` - SQLite adapter
- `src/memory/postgresql-adapter.ts` - PostgreSQL adapter with pgvector
- `src/memory/db-factory.ts` - Adapter factory
- `scripts/migrate-openclaw-to-postgres.sh` - Migration script
- `docs/gateway/database-configuration.md` - Comprehensive documentation
- `PERFORMANCE_ANALYSIS.md` - Performance comparison
- `IMPLEMENTATION_STATUS.md` - Status report

## Configuration Example

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "store": {
          "driver": "postgresql",
          "postgresql": {
            "connectionString": "postgresql://user:pass@host:5432/db",
            "schema": "agent_{agentId}",
            "pool": { "max": 10 }
          }
        }
      }
    }
  }
}
```
````

## Performance

- PostgreSQL: ~8ms vs SQLite: ~5ms (+3ms overhead)
- <1% impact on total request latency (LLM dominates at 2000ms)
- PostgreSQL wins for concurrent access (9x faster with 5 agents)
- See `PERFORMANCE_ANALYSIS.md` for detailed benchmarks

## Benefits

### SQLite (Default)

- Zero configuration
- Perfect for single-agent deployments
- Lowest latency

### PostgreSQL (Optional)

- **Shared knowledge**: All agents access shared memory pool
- **Concurrency**: Multiple agents read/write simultaneously
- **Enterprise**: Backups, replication, HA
- **Analytics**: Query across all agents
- **Cloud-native**: Works with AWS RDS, Supabase, Neon

## Testing

✅ Integration tested against PostgreSQL 16 + pgvector
✅ All existing SQLite tests pass
✅ Vector search verified (IVFFlat indexes)
✅ Full-text search verified (tsvector/GIN)
✅ Connection pooling functional
✅ Fully backward compatible

## Migration

Existing SQLite users can migrate easily:

```bash
export POSTGRES_HOST=host
export POSTGRES_DB=openclaw
export POSTGRES_USER=user
export POSTGRES_PASSWORD=pass

bash scripts/migrate-openclaw-to-postgres.sh
```

## Documentation

- **User Guide**: `docs/gateway/database-configuration.md` (67 pages)
  - When to use SQLite vs PostgreSQL
  - Setup instructions
  - Configuration examples
  - Migration guide
  - Performance tuning
  - Troubleshooting

- **Performance Analysis**: `PERFORMANCE_ANALYSIS.md`
- **Implementation Status**: `IMPLEMENTATION_STATUS.md`

## Breaking Changes

**None.** Fully backward compatible:

- SQLite remains the default
- Existing configurations work unchanged
- PostgreSQL is opt-in

## Security

- ✅ Parameterized queries (SQL injection prevention)
- ✅ Schema-per-agent isolation
- ✅ Environment variable support for credentials
- ✅ Connection pooling with timeouts

## Use Cases

**Use PostgreSQL when:**

- Multiple agents (3+) sharing knowledge
- Production deployment
- Need backups/HA
- Team environment
- Cloud deployment

**Use SQLite when:**

- Single agent
- Personal use
- Simplicity priority
- Want lowest latency

---

**Ready for review!** This is a production-ready, fully tested, backward-compatible addition that enables new deployment scenarios.

````

## After Creating the PR

1. **Link the PR in documentation**:
   - Update `IMPLEMENTATION_STATUS.md` with PR number

2. **Monitor for feedback**:
   - Address reviewer comments
   - Run additional tests if requested

3. **Prepare for merge**:
   - Squash commits if requested
   - Update documentation based on feedback

## Alternative: Create PR via Git Command

If you have push access to a branch on openclaw/openclaw:

```bash
# Create a feature branch on upstream (if you have access)
git push upstream postgresql-support:feature/postgresql-support

# Then create PR via web UI
````

## Checklist Before Submitting

- ✅ All commits pushed to origin
- ✅ Branch is up to date with upstream/main
- ✅ All tests passing
- ✅ Documentation complete
- ✅ Changelog updated
- ✅ No merge conflicts

## Direct PR Link

Once you push, you can create the PR directly at:

```
https://github.com/openclaw/openclaw/compare/main...dutch2005:postgresql-support
```

This link will open the PR creation form with your branch pre-selected.
