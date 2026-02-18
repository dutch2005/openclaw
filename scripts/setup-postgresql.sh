#!/bin/bash
#
# OpenClaw PostgreSQL Quick Setup
#
# This script automates the PostgreSQL setup process for OpenClaw,
# including database creation, user setup, pgvector extension, and
# configuration file generation.
#
# Usage:
#   bash scripts/setup-postgresql.sh
#   bash scripts/setup-postgresql.sh --host localhost --database openclaw
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🦞 OpenClaw PostgreSQL Quick Setup"
echo ""

# Parse arguments
POSTGRES_HOST="${1:-localhost}"
POSTGRES_PORT="${2:-5432}"
POSTGRES_DB="${3:-openclaw}"
POSTGRES_USER="${4:-openclaw}"
POSTGRES_PASSWORD=""
OPENCLAW_CONFIG="${HOME}/.openclaw/openclaw.json"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --host)
      POSTGRES_HOST="$2"
      shift 2
      ;;
    --port)
      POSTGRES_PORT="$2"
      shift 2
      ;;
    --database)
      POSTGRES_DB="$2"
      shift 2
      ;;
    --user)
      POSTGRES_USER="$2"
      shift 2
      ;;
    --password)
      POSTGRES_PASSWORD="$2"
      shift 2
      ;;
    --config)
      OPENCLAW_CONFIG="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --host HOST        PostgreSQL host (default: localhost)"
      echo "  --port PORT        PostgreSQL port (default: 5432)"
      echo "  --database DB      Database name (default: openclaw)"
      echo "  --user USER        Database user (default: openclaw)"
      echo "  --password PASS    Database password (will prompt if not provided)"
      echo "  --config PATH      OpenClaw config file path (default: ~/.openclaw/openclaw.json)"
      echo "  --help             Show this help message"
      echo ""
      echo "Example:"
      echo "  $0 --host 192.168.1.160 --database openclaw_router --user openclaw_router"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Run with --help for usage information"
      exit 1
      ;;
  esac
done

# Display configuration
echo -e "${GREEN}Configuration:${NC}"
echo "  Host:     $POSTGRES_HOST"
echo "  Port:     $POSTGRES_PORT"
echo "  Database: $POSTGRES_DB"
echo "  User:     $POSTGRES_USER"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v psql &> /dev/null; then
  echo -e "${RED}❌ PostgreSQL client (psql) not found${NC}"
  echo "   Install with: sudo apt install postgresql-client"
  exit 1
fi
echo -e "${GREEN}✓${NC} PostgreSQL client installed"

if ! command -v jq &> /dev/null; then
  echo -e "${YELLOW}⚠  jq not found (optional, for JSON processing)${NC}"
  echo "   Install with: sudo apt install jq"
fi

echo ""

# Prompt for password if not provided
if [ -z "$POSTGRES_PASSWORD" ]; then
  read -sp "Enter password for user '$POSTGRES_USER': " POSTGRES_PASSWORD
  echo ""
  read -sp "Confirm password: " POSTGRES_PASSWORD_CONFIRM
  echo ""

  if [ "$POSTGRES_PASSWORD" != "$POSTGRES_PASSWORD_CONFIRM" ]; then
    echo -e "${RED}❌ Passwords do not match${NC}"
    exit 1
  fi
fi

# Test superuser connection (for initial setup)
echo -e "${YELLOW}Testing PostgreSQL superuser connection...${NC}"
echo "You may be prompted for the PostgreSQL superuser (postgres) password."
echo ""

export PGPASSWORD="$POSTGRES_PASSWORD"

if sudo -u postgres psql -c "SELECT 1" &>/dev/null; then
  echo -e "${GREEN}✓${NC} Connected as superuser"
  IS_SUPERUSER=true
elif psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U postgres -c "SELECT 1" &>/dev/null; then
  echo -e "${GREEN}✓${NC} Connected as postgres user"
  IS_SUPERUSER=true
else
  echo -e "${YELLOW}⚠  Cannot connect as superuser, will try with provided credentials${NC}"
  IS_SUPERUSER=false
fi

echo ""

# Create database and user (if superuser access available)
if [ "$IS_SUPERUSER" = true ]; then
  echo -e "${YELLOW}Creating database and user...${NC}"

  sudo -u postgres psql << EOF
-- Create database
CREATE DATABASE $POSTGRES_DB;

-- Create user
CREATE USER $POSTGRES_USER WITH PASSWORD '$POSTGRES_PASSWORD';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE $POSTGRES_DB TO $POSTGRES_USER;

-- Connect to database and grant schema creation
\c $POSTGRES_DB

-- Create pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Grant CREATE on database
GRANT CREATE ON DATABASE $POSTGRES_DB TO $POSTGRES_USER;
EOF

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Database and user created successfully"
  else
    echo -e "${RED}❌ Failed to create database and user${NC}"
    echo "   Note: Ignore errors if database/user already exist"
  fi
else
  echo -e "${YELLOW}⚠  Skipping database creation (no superuser access)${NC}"
  echo "   Assuming database already exists"
fi

echo ""

# Test connection with new credentials
echo -e "${YELLOW}Testing connection with OpenClaw user...${NC}"

export PGPASSWORD="$POSTGRES_PASSWORD"

if psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1" &>/dev/null; then
  echo -e "${GREEN}✓${NC} Connection successful"
else
  echo -e "${RED}❌ Cannot connect with OpenClaw user${NC}"
  echo "   Check credentials and try again"
  exit 1
fi

# Check pgvector extension
echo -e "${YELLOW}Checking pgvector extension...${NC}"

if psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT * FROM pg_extension WHERE extname = 'vector'" | grep -q vector; then
  echo -e "${GREEN}✓${NC} pgvector extension installed"
else
  echo -e "${YELLOW}⚠  pgvector extension not found${NC}"
  echo "   Install with: sudo apt install postgresql-15-pgvector"
  echo "   Then run: CREATE EXTENSION vector;"
fi

echo ""

# Generate OpenClaw configuration
echo -e "${YELLOW}Generating OpenClaw configuration...${NC}"

CONNECTION_STRING="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"

CONFIG_JSON=$(cat << EOF
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,
        "provider": "auto",
        "store": {
          "driver": "postgresql",
          "postgresql": {
            "connectionString": "$CONNECTION_STRING",
            "schema": "agent_{agentId}",
            "pool": {
              "max": 10,
              "idleTimeoutMillis": 30000,
              "connectionTimeoutMillis": 5000
            },
            "vector": {
              "extension": "pgvector",
              "dimensions": 1536
            }
          }
        }
      }
    }
  }
}
EOF
)

# Create config directory if needed
mkdir -p "$(dirname "$OPENCLAW_CONFIG")"

# Backup existing config
if [ -f "$OPENCLAW_CONFIG" ]; then
  BACKUP_PATH="${OPENCLAW_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
  cp "$OPENCLAW_CONFIG" "$BACKUP_PATH"
  echo -e "${YELLOW}⚠  Backed up existing config to: $BACKUP_PATH${NC}"
fi

# Write new config
echo "$CONFIG_JSON" > "$OPENCLAW_CONFIG"
echo -e "${GREEN}✓${NC} Configuration written to: $OPENCLAW_CONFIG"

echo ""

# Display connection info (with masked password)
DISPLAY_CONNECTION_STRING="postgresql://$POSTGRES_USER:***@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Database Details:"
echo "  Connection: $DISPLAY_CONNECTION_STRING"
echo "  Configuration: $OPENCLAW_CONFIG"
echo ""
echo "Next Steps:"
echo ""
echo "1. Verify setup:"
echo "   node scripts/check-database-health.cjs --driver postgresql"
echo ""
echo "2. (Optional) Migrate existing SQLite data:"
echo "   export POSTGRES_HOST=$POSTGRES_HOST"
echo "   export POSTGRES_DB=$POSTGRES_DB"
echo "   export POSTGRES_USER=$POSTGRES_USER"
echo "   export POSTGRES_PASSWORD='$POSTGRES_PASSWORD'"
echo "   bash scripts/migrate-openclaw-to-postgres.sh"
echo ""
echo "3. Start OpenClaw:"
echo "   openclaw agent main"
echo ""
echo "4. Verify schemas created:"
echo "   psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c \"\\dn\""
echo ""
echo "📚 Documentation: docs/gateway/database-configuration.md"
echo ""
