#!/usr/bin/env node
/**
 * OpenClaw Database Health Check Utility
 *
 * Checks database connectivity, configuration, and health for both SQLite and PostgreSQL.
 *
 * Usage:
 *   node scripts/check-database-health.cjs
 *   node scripts/check-database-health.cjs --driver postgresql
 *   node scripts/check-database-health.cjs --config ~/.openclaw/openclaw.json
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

// Parse command line arguments
const args = process.argv.slice(2);
const configPath = args.includes("--config")
  ? args[args.indexOf("--config") + 1]
  : path.join(process.env.HOME, ".openclaw", "openclaw.json");
const forceDriver = args.includes("--driver") ? args[args.indexOf("--driver") + 1] : null;

console.log("🏥 OpenClaw Database Health Check\n");

// Configuration
const config = loadConfig(configPath);
const driver = forceDriver || config?.agents?.defaults?.memorySearch?.store?.driver || "sqlite";

console.log(`Driver: ${driver}`);
console.log(`Config: ${configPath}\n`);

// Run health check
void (async () => {
  if (driver === "sqlite") {
    await checkSqliteHealth(config);
  } else if (driver === "postgresql") {
    await checkPostgresqlHealth(config);
  } else {
    console.error(`❌ Unknown driver: ${driver}`);
    process.exit(1);
  }
})();

// ============================================================================
// SQLite Health Check
// ============================================================================

async function checkSqliteHealth(config) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("SQLite Health Check");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const memoryDir = path.join(process.env.HOME, ".openclaw", "memory");
  const sqlitePath =
    config?.agents?.defaults?.memorySearch?.store?.path || "~/.openclaw/memory/{agentId}.sqlite";

  // Check 1: Memory directory
  console.log("📁 Checking memory directory...");
  if (!fs.existsSync(memoryDir)) {
    console.log("❌ Memory directory not found:", memoryDir);
    console.log("   Create it with: mkdir -p", memoryDir);
    return;
  }
  console.log("✅ Memory directory exists:", memoryDir);

  // Check 2: Database files
  console.log("\n📊 Checking database files...");
  const dbFiles = fs.readdirSync(memoryDir).filter((f) => f.endsWith(".sqlite"));
  if (dbFiles.length === 0) {
    console.log("⚠️  No .sqlite files found (database will be created on first use)");
  } else {
    console.log(`✅ Found ${dbFiles.length} database file(s):`);
    for (const file of dbFiles) {
      const filePath = path.join(memoryDir, file);
      const stats = fs.statSync(filePath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`   - ${file}: ${sizeMB} MB`);
    }
  }

  // Check 3: SQLite availability
  console.log("\n🔍 Checking SQLite availability...");
  try {
    const Database = require("better-sqlite3");
    console.log("✅ better-sqlite3 module available");

    // Test database creation
    const testDb = path.join(memoryDir, ".health-check-test.sqlite");
    try {
      const db = new Database(testDb);
      db.exec("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)");
      db.exec("INSERT INTO test (id) VALUES (1)");
      const _result = db.prepare("SELECT COUNT(*) as count FROM test").get();
      db.close();
      fs.unlinkSync(testDb);
      console.log("✅ SQLite read/write test passed");
    } catch (err) {
      console.log("❌ SQLite test failed:", err.message);
    }
  } catch (err) {
    console.log("❌ better-sqlite3 not available:", err.message);
    console.log("   Install with: npm install better-sqlite3");
  }

  // Check 4: sqlite-vec extension
  console.log("\n🔍 Checking sqlite-vec extension...");
  const vectorEnabled = config?.agents?.defaults?.memorySearch?.store?.vector?.enabled ?? true;
  if (!vectorEnabled) {
    console.log("⚠️  Vector search disabled in config");
  } else {
    try {
      // Check if sqlite-vec is available
      console.log("⚠️  sqlite-vec check requires Node.js sqlite module");
      console.log("   Vector search will be enabled if extension loads successfully");
    } catch (err) {
      console.log("⚠️  Cannot check sqlite-vec:", err.message);
    }
  }

  // Check 5: Configuration
  console.log("\n⚙️  Configuration:");
  console.log(`   Path pattern: ${sqlitePath}`);
  console.log(`   Vector search: ${vectorEnabled ? "enabled" : "disabled"}`);

  console.log("\n✅ SQLite health check complete\n");
}

// ============================================================================
// PostgreSQL Health Check
// ============================================================================

async function checkPostgresqlHealth(config) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("PostgreSQL Health Check");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const pgConfig = config?.agents?.defaults?.memorySearch?.store?.postgresql;

  if (!pgConfig) {
    console.log("❌ PostgreSQL configuration not found in config file");
    console.log('   Add "postgresql" section to store configuration');
    return;
  }

  // Build connection string
  let connectionString = pgConfig.connectionString;
  if (!connectionString && pgConfig.host && pgConfig.database) {
    const auth = pgConfig.user && pgConfig.password ? `${pgConfig.user}:${pgConfig.password}@` : "";
    const port = pgConfig.port || 5432;
    connectionString = `postgresql://${auth}${pgConfig.host}:${port}/${pgConfig.database}`;
  }

  if (!connectionString) {
    console.log("❌ No connection string or host/database configured");
    return;
  }

  // Mask password in output
  const displayString = connectionString.replace(/:([^@]+)@/, ":***@");
  console.log("🔌 Connection:", displayString);

  const pool = new Pool({ connectionString });

  try {
    // Check 1: Connection
    console.log("\n📡 Testing connection...");
    const client = await pool.connect();
    const versionResult = await client.query("SELECT version()");
    const version = versionResult.rows[0].version.split(" ").slice(0, 2).join(" ");
    console.log("✅ Connected to:", version);
    client.release();

    // Check 2: pgvector extension
    console.log("\n🔍 Checking pgvector extension...");
    const extResult = await pool.query("SELECT * FROM pg_extension WHERE extname = 'vector'");
    if (extResult.rows.length > 0) {
      console.log("✅ pgvector extension installed");

      // Check vector type
      const typeResult = await pool.query("SELECT typname FROM pg_type WHERE typname = 'vector'");
      if (typeResult.rows.length > 0) {
        console.log("✅ vector type available");
      }
    } else {
      console.log("❌ pgvector extension not found");
      console.log("   Install with:");
      console.log("   sudo apt install postgresql-15-pgvector");
      console.log('   psql -c "CREATE EXTENSION vector"');
    }

    // Check 3: Agent schemas
    console.log("\n📊 Checking agent schemas...");
    const schemaResult = await pool.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name LIKE 'agent_%'
      ORDER BY schema_name
    `);

    if (schemaResult.rows.length === 0) {
      console.log("⚠️  No agent schemas found (will be created on first use)");
    } else {
      console.log(`✅ Found ${schemaResult.rows.length} agent schema(s):`);
      for (const row of schemaResult.rows) {
        // Get statistics for each schema
        const statsResult = await pool.query(`
          SELECT
            (SELECT COUNT(*) FROM ${row.schema_name}.chunks) as chunks,
            (SELECT COUNT(*) FROM ${row.schema_name}.files) as files,
            (SELECT COUNT(*) FROM ${row.schema_name}.embedding_cache) as cache
        `);
        const stats = statsResult.rows[0];
        console.log(
          `   - ${row.schema_name}: ${stats.chunks} chunks, ${stats.files} files, ${stats.cache} cached`,
        );
      }
    }

    // Check 4: Database size
    console.log("\n💾 Database size:");
    const sizeResult = await pool.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `);
    console.log(`   Total: ${sizeResult.rows[0].size}`);

    // Check 5: Connection pool
    console.log("\n🔄 Connection pool:");
    console.log(`   Total connections: ${pool.totalCount}`);
    console.log(`   Idle connections: ${pool.idleCount}`);
    console.log(`   Waiting clients: ${pool.waitingCount}`);
    console.log(`   Max connections: ${pgConfig.pool?.max || 10}`);

    // Check 6: Performance settings
    console.log("\n⚡ Performance settings:");
    const settingsResult = await pool.query(`
      SELECT name, setting, unit
      FROM pg_settings
      WHERE name IN ('shared_buffers', 'effective_cache_size', 'work_mem', 'maintenance_work_mem', 'max_connections')
      ORDER BY name
    `);
    for (const row of settingsResult.rows) {
      const value = row.unit ? `${row.setting}${row.unit}` : row.setting;
      console.log(`   ${row.name}: ${value}`);
    }

    // Check 7: Configuration
    console.log("\n⚙️  Configuration:");
    console.log(`   Schema pattern: ${pgConfig.schema || "agent_{agentId}"}`);
    console.log(`   Vector dimensions: ${pgConfig.vector?.dimensions || 1536}`);
    console.log(`   Pool max: ${pgConfig.pool?.max || 10}`);
    console.log(`   Pool idle timeout: ${pgConfig.pool?.idleTimeoutMillis || 30000}ms`);

    console.log("\n✅ PostgreSQL health check complete\n");
  } catch (err) {
    console.error("\n❌ Health check failed:", err.message);
    console.error("\nTroubleshooting:");
    console.error("  1. Check PostgreSQL is running: systemctl status postgresql");
    console.error("  2. Verify connection settings in config");
    console.error("  3. Check firewall allows port 5432");
    console.error("  4. Verify user has correct permissions");
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// ============================================================================
// Utilities
// ============================================================================

function loadConfig(configPath) {
  try {
    const resolvedPath = configPath.replace("~", process.env.HOME);
    if (!fs.existsSync(resolvedPath)) {
      console.log(`⚠️  Config file not found: ${resolvedPath}`);
      console.log("   Using default settings\n");
      return null;
    }
    const content = fs.readFileSync(resolvedPath, "utf8");
    return JSON.parse(content);
  } catch (err) {
    console.log(`⚠️  Failed to load config: ${err.message}`);
    console.log("   Using default settings\n");
    return null;
  }
}
