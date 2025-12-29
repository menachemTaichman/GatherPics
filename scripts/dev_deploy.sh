#!/bin/bash
# Development deployment script
# Mimics the production deployment process:
# 1. Drop database logic layer (functions, views, triggers)
# 2. Apply schema migrations (yoyo)
# 3. Recreate database logic layer from SQL files
# USAGE: ./scripts/dev_deploy.sh

set -e

# Load environment variables from .env file if it exists
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Development Database Deployment${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if Python script exists
if [ ! -f "scripts/recreate_db_logic.py" ]; then
    echo -e "${RED}✗ Error: scripts/recreate_db_logic.py not found${NC}"
    exit 1
fi

# Check if migrate.sh exists
if [ ! -f "migrate.sh" ]; then
    echo -e "${RED}✗ Error: migrate.sh not found${NC}"
    exit 1
fi

# Step 1: Drop database logic layer
echo -e "${YELLOW}Step 1: Dropping database logic layer (functions, views, triggers)...${NC}"
python scripts/recreate_db_logic.py --drop-only
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Step 1 complete${NC}"
else
    echo -e "${RED}✗ Step 1 failed${NC}"
    exit 1
fi
echo ""

# Step 2: Apply schema migrations
echo -e "${YELLOW}Step 2: Applying schema migrations (yoyo)...${NC}"
./migrate.sh apply
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Step 2 complete${NC}"
else
    echo -e "${RED}✗ Step 2 failed${NC}"
    exit 1
fi
echo ""

# Step 3: Recreate database logic layer
echo -e "${YELLOW}Step 3: Recreating database logic layer (functions, views, triggers)...${NC}"
python scripts/recreate_db_logic.py
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Step 3 complete${NC}"
else
    echo -e "${RED}✗ Step 3 failed${NC}"
    exit 1
fi
echo ""

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ Development deployment successful!${NC}"
echo -e "${BLUE}========================================${NC}"

