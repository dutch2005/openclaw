#!/usr/bin/env node
/**
 * OpenClaw Database Advisor
 *
 * Analyzes your deployment and recommends the optimal database backend
 * (SQLite vs PostgreSQL) based on your specific use case.
 *
 * Usage:
 *   node scripts/database-advisor.cjs
 *   node scripts/database-advisor.cjs --config ~/.openclaw/openclaw.json
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

console.log("🦞 OpenClaw Database Advisor\n");
console.log("This tool will help you choose the right database backend for your deployment.\n");

// Parse command line arguments
const args = process.argv.slice(2);
const configPath = args.includes("--config")
  ? args[args.indexOf("--config") + 1]
  : path.join(process.env.HOME, ".openclaw", "openclaw.json");

// Load configuration if exists
let _existingConfig = null;
if (fs.existsSync(configPath)) {
  try {
    _existingConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    console.log(`📝 Loaded existing config: ${configPath}\n`);
  } catch (err) {
    console.log(`⚠️  Could not parse config file: ${err.message}\n`);
  }
}

// Questionnaire
const questions = [
  {
    id: "agents",
    question: "How many agents do you plan to run?",
    options: ["1", "2-3", "4-5", "6+"],
    weight: { sqlite: [5, 3, 1, 0], postgresql: [0, 2, 4, 5] },
  },
  {
    id: "shared_knowledge",
    question: "Do agents need to share knowledge and learn from each other?",
    options: ["Yes, essential", "Nice to have", "Not needed"],
    weight: { sqlite: [0, 1, 5], postgresql: [5, 4, 0] },
  },
  {
    id: "deployment",
    question: "What type of deployment?",
    options: [
      "Local/development",
      "Production (single server)",
      "Production (cloud/docker)",
      "Multi-server",
    ],
    weight: { sqlite: [5, 3, 1, 0], postgresql: [1, 3, 5, 5] },
  },
  {
    id: "backup",
    question: "What backup requirements do you have?",
    options: [
      "Manual file copies",
      "Automated backups",
      "Point-in-time recovery",
      "High availability",
    ],
    weight: { sqlite: [5, 3, 1, 0], postgresql: [2, 4, 5, 5] },
  },
  {
    id: "analytics",
    question: "Do you need analytics across all agents?",
    options: ["No", "Basic queries", "Advanced analytics", "Real-time dashboards"],
    weight: { sqlite: [5, 3, 1, 0], postgresql: [3, 4, 5, 5] },
  },
  {
    id: "team",
    question: "Is this for personal use or a team?",
    options: ["Personal", "Small team (2-5)", "Large team (6+)"],
    weight: { sqlite: [5, 2, 0], postgresql: [1, 4, 5] },
  },
  {
    id: "latency",
    question: "How important is lowest possible latency?",
    options: ["Critical", "Important", "Not a priority"],
    weight: { sqlite: [5, 3, 1], postgresql: [1, 3, 5] },
  },
  {
    id: "setup",
    question: "What's your preference for setup complexity?",
    options: ["Zero configuration preferred", "Some setup acceptable", "Complex setup OK"],
    weight: { sqlite: [5, 3, 1], postgresql: [0, 3, 5] },
  },
];

// Interactive questionnaire
async function runQuestionnaire() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answers = [];
  let sqliteScore = 0;
  let postgresqlScore = 0;

  for (const q of questions) {
    await new Promise((resolve) => {
      console.log(`\n${q.question}`);
      q.options.forEach((opt, i) => {
        console.log(`  ${i + 1}. ${opt}`);
      });

      rl.question("\nYour answer (number): ", (answer) => {
        const index = parseInt(answer) - 1;
        if (index >= 0 && index < q.options.length) {
          answers.push({ id: q.id, answer: q.options[index], index });
          sqliteScore += q.weight.sqlite[index];
          postgresqlScore += q.weight.postgresql[index];
        } else {
          console.log("Invalid answer, defaulting to first option.");
          answers.push({ id: q.id, answer: q.options[0], index: 0 });
          sqliteScore += q.weight.sqlite[0];
          postgresqlScore += q.weight.postgresql[0];
        }
        resolve();
      });
    });
  }

  rl.close();

  return { answers, sqliteScore, postgresqlScore };
}

// Analyze and recommend
async function analyze() {
  const { answers, sqliteScore, postgresqlScore } = await runQuestionnaire();

  console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 Analysis Results");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log(`SQLite Score:      ${sqliteScore}`);
  console.log(`PostgreSQL Score:  ${postgresqlScore}\n`);

  const winner = sqliteScore > postgresqlScore ? "SQLite" : "PostgreSQL";
  const confidence = Math.abs(sqliteScore - postgresqlScore);
  const confidenceLevel = confidence > 10 ? "High" : confidence > 5 ? "Medium" : "Low";

  console.log(`🎯 Recommendation: ${winner}`);
  console.log(`Confidence: ${confidenceLevel}\n`);

  // Detailed explanation
  if (winner === "SQLite") {
    console.log("✅ Why SQLite is recommended for you:\n");

    if (answers.find((a) => a.id === "agents" && a.index === 0)) {
      console.log("  • Single agent deployment → SQLite is optimized for this");
    }
    if (answers.find((a) => a.id === "deployment" && a.index === 0)) {
      console.log("  • Local development → Zero setup, just works");
    }
    if (answers.find((a) => a.id === "latency" && a.index === 0)) {
      console.log("  • Critical latency requirements → SQLite is ~3ms faster");
    }
    if (answers.find((a) => a.id === "setup" && a.index === 0)) {
      console.log("  • Prefer simplicity → No external dependencies needed");
    }
    if (answers.find((a) => a.id === "team" && a.index === 0)) {
      console.log("  • Personal use → Per-agent databases are sufficient");
    }

    console.log("\n⚠️  Consider PostgreSQL if in the future:\n");
    console.log("  • You scale to 4+ agents");
    console.log("  • You need shared knowledge across agents");
    console.log("  • You deploy to production/cloud");
    console.log("  • You need advanced analytics");

    console.log("\n📝 Configuration:\n");
    console.log("```json");
    console.log(
      JSON.stringify(
        {
          agents: {
            defaults: {
              memorySearch: {
                store: {
                  driver: "sqlite",
                  path: "~/.openclaw/memory/{agentId}.sqlite",
                  vector: {
                    enabled: true,
                  },
                },
              },
            },
          },
        },
        null,
        2,
      ),
    );
    console.log("```");
  } else {
    console.log("✅ Why PostgreSQL is recommended for you:\n");

    if (answers.find((a) => a.id === "agents" && a.index >= 2)) {
      console.log("  • Multiple agents (4+) → Shared knowledge and concurrency benefits");
    }
    if (answers.find((a) => a.id === "shared_knowledge" && a.index <= 1)) {
      console.log("  • Shared knowledge needed → All agents access same memory pool");
    }
    if (answers.find((a) => a.id === "deployment" && (a.index === 2 || a.index === 3))) {
      console.log("  • Cloud/Docker deployment → Works with managed PostgreSQL services");
    }
    if (answers.find((a) => a.id === "backup" && a.index >= 2)) {
      console.log("  • Advanced backup needs → Point-in-time recovery and replication");
    }
    if (answers.find((a) => a.id === "analytics" && a.index >= 2)) {
      console.log("  • Analytics requirements → SQL queries across all agents");
    }
    if (answers.find((a) => a.id === "team" && a.index >= 1)) {
      console.log("  • Team environment → Centralized management and monitoring");
    }

    console.log("\n⚡ Performance notes:\n");
    console.log("  • PostgreSQL is ~3ms slower per query (8ms vs 5ms)");
    console.log("  • BUT this is <1% of total latency (LLM inference dominates at ~2000ms)");
    console.log("  • AND PostgreSQL is 9x faster for concurrent access (5 agents)");

    console.log("\n📝 Configuration:\n");
    console.log("```json");
    console.log(
      JSON.stringify(
        {
          agents: {
            defaults: {
              memorySearch: {
                store: {
                  driver: "postgresql",
                  postgresql: {
                    connectionString: "postgresql://user:password@host:5432/openclaw",
                    schema: "agent_{agentId}",
                    pool: {
                      max: 10,
                      idleTimeoutMillis: 30000,
                    },
                    vector: {
                      extension: "pgvector",
                      dimensions: 1536,
                    },
                  },
                },
              },
            },
          },
        },
        null,
        2,
      ),
    );
    console.log("```");

    console.log("\n📋 Setup steps:\n");
    console.log("1. Install PostgreSQL:");
    console.log("   sudo apt install postgresql postgresql-15-pgvector\n");
    console.log("2. Create database:");
    console.log("   sudo -u postgres psql");
    console.log("   CREATE DATABASE openclaw;");
    console.log("   CREATE USER openclaw WITH PASSWORD 'your_password';");
    console.log("   GRANT ALL PRIVILEGES ON DATABASE openclaw TO openclaw;");
    console.log("   \\c openclaw");
    console.log("   CREATE EXTENSION vector;");
    console.log("   GRANT CREATE ON DATABASE openclaw TO openclaw;\n");
    console.log("3. Update config with connection details\n");
    console.log("4. (Optional) Migrate existing SQLite data:");
    console.log("   bash scripts/migrate-openclaw-to-postgres.sh");
  }

  console.log("\n\n📚 Documentation:");
  console.log("  • Database configuration: docs/gateway/database-configuration.md");
  console.log("  • Performance analysis: PERFORMANCE_ANALYSIS.md");
  console.log("  • Example configs: examples/configs/\n");
}

// Run
void analyze();
