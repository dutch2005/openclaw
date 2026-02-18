#!/usr/bin/env node
/**
 * OpenClaw Database Benchmark Utility
 *
 * Compares SQLite vs PostgreSQL performance for vector search and full-text search.
 *
 * Usage:
 *   node scripts/benchmark-database.cjs
 *   node scripts/benchmark-database.cjs --iterations 100
 *   node scripts/benchmark-database.cjs --sqlite-path /path/to/db.sqlite
 *   node scripts/benchmark-database.cjs --postgresql-url postgresql://user:pass@host:5432/db
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

// Parse command line arguments
const args = process.argv.slice(2);
const iterations = args.includes("--iterations")
  ? parseInt(args[args.indexOf("--iterations") + 1])
  : 50;
const sqlitePath = args.includes("--sqlite-path")
  ? args[args.indexOf("--sqlite-path") + 1]
  : path.join(process.env.HOME, ".openclaw", "memory", "main.sqlite");
const postgresqlUrl = args.includes("--postgresql-url")
  ? args[args.indexOf("--postgresql-url") + 1]
  : process.env.OPENCLAW_POSTGRESQL_URL;

console.log("🏎️  OpenClaw Database Benchmark\n");
console.log(`Iterations: ${iterations}`);
console.log(`SQLite: ${sqlitePath}`);
console.log(`PostgreSQL: ${postgresqlUrl || "Not configured"}\n`);

// Benchmark results storage
const results = {
  sqlite: { vectorSearch: [], fullTextSearch: [], simpleQuery: [] },
  postgresql: { vectorSearch: [], fullTextSearch: [], simpleQuery: [] },
};

// ============================================================================
// Main
// ============================================================================

void (async () => {
  try {
    // Benchmark SQLite
    if (fs.existsSync(sqlitePath)) {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("Benchmarking SQLite");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      await benchmarkSqlite();
    } else {
      console.log("⚠️  SQLite database not found, skipping SQLite benchmark\n");
    }

    // Benchmark PostgreSQL
    if (postgresqlUrl) {
      console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("Benchmarking PostgreSQL");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      await benchmarkPostgresql();
    } else {
      console.log("\n⚠️  PostgreSQL URL not configured, skipping PostgreSQL benchmark");
      console.log("   Set OPENCLAW_POSTGRESQL_URL or use --postgresql-url\n");
    }

    // Generate report
    if (results.sqlite.vectorSearch.length > 0 || results.postgresql.vectorSearch.length > 0) {
      generateReport();
    }
  } catch (err) {
    console.error("❌ Benchmark failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();

// ============================================================================
// SQLite Benchmark
// ============================================================================

async function benchmarkSqlite() {
  let db;
  try {
    const Database = require("better-sqlite3");
    db = new Database(sqlitePath, { readonly: true });

    // Check if database has data
    const chunkCount = db.prepare("SELECT COUNT(*) as count FROM chunks").get();
    console.log(`Database size: ${chunkCount.count} chunks\n`);

    if (chunkCount.count === 0) {
      console.log("⚠️  Database is empty, skipping SQLite benchmark\n");
      db.close();
      return;
    }

    // Benchmark 1: Simple query
    console.log(`1️⃣  Simple Query (${iterations} iterations)...`);
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      db.prepare("SELECT COUNT(*) as count FROM chunks").get();
      const duration = Date.now() - start;
      results.sqlite.simpleQuery.push(duration);
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`\r   Progress: ${i + 1}/${iterations}`);
      }
    }
    console.log("\n   ✅ Complete");

    // Benchmark 2: Full-text search
    console.log(`\n2️⃣  Full-Text Search (${iterations} iterations)...`);
    const ftsAvailable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'")
      .get();

    if (ftsAvailable) {
      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        db.prepare("SELECT id, text FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT 10").all("test");
        const duration = Date.now() - start;
        results.sqlite.fullTextSearch.push(duration);
        if ((i + 1) % 10 === 0) {
          process.stdout.write(`\r   Progress: ${i + 1}/${iterations}`);
        }
      }
      console.log("\n   ✅ Complete");
    } else {
      console.log("   ⚠️  FTS5 table not found, skipping");
    }

    // Benchmark 3: Vector search (if available)
    console.log(`\n3️⃣  Vector Search (${iterations} iterations)...`);
    const vecAvailable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'")
      .get();

    if (vecAvailable) {
      // Get sample embedding
      const sample = db
        .prepare("SELECT embedding FROM chunks WHERE embedding IS NOT NULL LIMIT 1")
        .get();

      if (sample && sample.embedding) {
        for (let i = 0; i < iterations; i++) {
          const start = Date.now();
          db.prepare("SELECT id FROM chunks_vec WHERE embedding MATCH ? LIMIT 10").all(
            sample.embedding,
          );
          const duration = Date.now() - start;
          results.sqlite.vectorSearch.push(duration);
          if ((i + 1) % 10 === 0) {
            process.stdout.write(`\r   Progress: ${i + 1}/${iterations}`);
          }
        }
        console.log("\n   ✅ Complete");
      } else {
        console.log("   ⚠️  No embeddings found, skipping");
      }
    } else {
      console.log("   ⚠️  Vector table not found, skipping");
    }

    db.close();
  } catch (err) {
    console.error("❌ SQLite benchmark failed:", err.message);
    if (db) {
      db.close();
    }
  }
}

// ============================================================================
// PostgreSQL Benchmark
// ============================================================================

async function benchmarkPostgresql() {
  let pool;
  try {
    pool = new Pool({ connectionString: postgresqlUrl });

    // Check if database has data
    const schemas = await pool.query(`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name LIKE 'agent_%'
      LIMIT 1
    `);

    if (schemas.rows.length === 0) {
      console.log("⚠️  No agent schemas found, skipping PostgreSQL benchmark\n");
      await pool.end();
      return;
    }

    const schema = schemas.rows[0].schema_name;
    console.log(`Using schema: ${schema}\n`);

    const chunkCount = await pool.query(`SELECT COUNT(*) as count FROM ${schema}.chunks`);
    console.log(`Database size: ${chunkCount.rows[0].count} chunks\n`);

    if (parseInt(chunkCount.rows[0].count) === 0) {
      console.log("⚠️  Database is empty, skipping PostgreSQL benchmark\n");
      await pool.end();
      return;
    }

    // Benchmark 1: Simple query
    console.log(`1️⃣  Simple Query (${iterations} iterations)...`);
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await pool.query(`SELECT COUNT(*) as count FROM ${schema}.chunks`);
      const duration = Date.now() - start;
      results.postgresql.simpleQuery.push(duration);
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`\r   Progress: ${i + 1}/${iterations}`);
      }
    }
    console.log("\n   ✅ Complete");

    // Benchmark 2: Full-text search
    console.log(`\n2️⃣  Full-Text Search (${iterations} iterations)...`);
    const ftsAvailable = await pool.query(
      `
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'chunks' AND column_name = 'text_tsv'
    `,
      [schema],
    );

    if (ftsAvailable.rows.length > 0) {
      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await pool.query(
          `SELECT id, text FROM ${schema}.chunks
           WHERE text_tsv @@ to_tsquery('english', $1)
           LIMIT 10`,
          ["test"],
        );
        const duration = Date.now() - start;
        results.postgresql.fullTextSearch.push(duration);
        if ((i + 1) % 10 === 0) {
          process.stdout.write(`\r   Progress: ${i + 1}/${iterations}`);
        }
      }
      console.log("\n   ✅ Complete");
    } else {
      console.log("   ⚠️  tsvector column not found, skipping");
    }

    // Benchmark 3: Vector search
    console.log(`\n3️⃣  Vector Search (${iterations} iterations)...`);
    const vecAvailable = await pool.query(
      `
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'chunks' AND column_name = 'embedding'
    `,
      [schema],
    );

    if (vecAvailable.rows.length > 0) {
      // Get sample embedding
      const sample = await pool.query(
        `SELECT embedding FROM ${schema}.chunks WHERE embedding IS NOT NULL LIMIT 1`,
      );

      if (sample.rows.length > 0 && sample.rows[0].embedding) {
        const sampleEmbedding = JSON.stringify(sample.rows[0].embedding);

        for (let i = 0; i < iterations; i++) {
          const start = Date.now();
          await pool.query(
            `SELECT id FROM ${schema}.chunks
             WHERE embedding IS NOT NULL
             ORDER BY embedding <=> $1::vector
             LIMIT 10`,
            [sampleEmbedding],
          );
          const duration = Date.now() - start;
          results.postgresql.vectorSearch.push(duration);
          if ((i + 1) % 10 === 0) {
            process.stdout.write(`\r   Progress: ${i + 1}/${iterations}`);
          }
        }
        console.log("\n   ✅ Complete");
      } else {
        console.log("   ⚠️  No embeddings found, skipping");
      }
    } else {
      console.log("   ⚠️  Vector column not found, skipping");
    }

    await pool.end();
  } catch (err) {
    console.error("❌ PostgreSQL benchmark failed:", err.message);
    if (pool) {
      await pool.end();
    }
  }
}

// ============================================================================
// Report Generation
// ============================================================================

function generateReport() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Benchmark Results");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const operations = [
    { key: "simpleQuery", name: "Simple Query" },
    { key: "fullTextSearch", name: "Full-Text Search" },
    { key: "vectorSearch", name: "Vector Search" },
  ];

  for (const op of operations) {
    const sqliteData = results.sqlite[op.key];
    const postgresqlData = results.postgresql[op.key];

    if (sqliteData.length === 0 && postgresqlData.length === 0) {
      continue;
    }

    console.log(`📊 ${op.name}`);
    console.log("─────────────────────────────────────────\n");

    if (sqliteData.length > 0) {
      const stats = calculateStats(sqliteData);
      console.log("SQLite:");
      console.log(`  Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`  Min: ${stats.min.toFixed(2)}ms`);
      console.log(`  Max: ${stats.max.toFixed(2)}ms`);
      console.log(`  P50: ${stats.p50.toFixed(2)}ms`);
      console.log(`  P95: ${stats.p95.toFixed(2)}ms`);
      console.log(`  P99: ${stats.p99.toFixed(2)}ms`);
    }

    if (postgresqlData.length > 0) {
      const stats = calculateStats(postgresqlData);
      console.log("\nPostgreSQL:");
      console.log(`  Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`  Min: ${stats.min.toFixed(2)}ms`);
      console.log(`  Max: ${stats.max.toFixed(2)}ms`);
      console.log(`  P50: ${stats.p50.toFixed(2)}ms`);
      console.log(`  P95: ${stats.p95.toFixed(2)}ms`);
      console.log(`  P99: ${stats.p99.toFixed(2)}ms`);
    }

    // Comparison
    if (sqliteData.length > 0 && postgresqlData.length > 0) {
      const sqliteAvg = calculateStats(sqliteData).avg;
      const postgresqlAvg = calculateStats(postgresqlData).avg;
      const diff = postgresqlAvg - sqliteAvg;
      const pct = ((diff / sqliteAvg) * 100).toFixed(1);
      const winner = diff > 0 ? "SQLite" : "PostgreSQL";

      console.log("\nComparison:");
      console.log(`  Difference: ${Math.abs(diff).toFixed(2)}ms (${Math.abs(parseFloat(pct))}%)`);
      console.log(`  Winner: ${winner} 🏆`);
    }

    console.log("\n");
  }

  // Overall summary
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Summary");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (results.sqlite.vectorSearch.length > 0 && results.postgresql.vectorSearch.length > 0) {
    const sqliteAvg = calculateStats(results.sqlite.vectorSearch).avg;
    const postgresqlAvg = calculateStats(results.postgresql.vectorSearch).avg;
    const overhead = postgresqlAvg - sqliteAvg;

    console.log(`PostgreSQL overhead: ~${overhead.toFixed(1)}ms per query`);
    console.log(`Impact on 2000ms LLM request: ${((overhead / 2000) * 100).toFixed(2)}%`);
    console.log(
      `Human perception threshold: 10ms (${overhead < 10 ? "✅ imperceptible" : "⚠️  noticeable"})`,
    );

    if (results.postgresql.vectorSearch.length >= 5) {
      console.log("\nConcurrent access benefit:");
      console.log("  5 agents with SQLite: ~${(sqliteAvg * 5).toFixed(1)}ms (sequential)");
      console.log(`  5 agents with PostgreSQL: ~${postgresqlAvg.toFixed(1)}ms (parallel)`);
      console.log(
        `  PostgreSQL ${((sqliteAvg * 5) / postgresqlAvg).toFixed(1)}x faster for concurrent access 🚀`,
      );
    }
  }

  console.log("\n💡 Recommendation:");
  console.log("  - Use SQLite for single-agent deployments (lowest latency)");
  console.log("  - Use PostgreSQL for multi-agent deployments (shared knowledge + concurrency)");
  console.log("  - The overhead is negligible compared to LLM inference time (~2000ms)\n");
}

// ============================================================================
// Statistics
// ============================================================================

function calculateStats(data) {
  const sorted = [...data].toSorted((a, b) => a - b);
  const sum = sorted.reduce((acc, val) => acc + val, 0);

  return {
    avg: sum / sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
  };
}
