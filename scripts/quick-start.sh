#!/bin/bash
# ==============================================================================
# ThinkCoffee - Quick Start Script (V5 - Agent Safety Net)
# ==============================================================================
# Script para setup rapido do ambiente de desenvolvimento/producao.
#
# Usage: ./scripts/quick-start.sh [dev|prod]
# Example: ./scripts/quick-start.sh dev
#          ./scripts/quick-start.sh prod
# ==============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${CYAN}[STEP]${NC} $1"; }

# ------------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------------
ENV="${1:-dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
    log_error "Invalid environment: $ENV"
    log_info "Usage: ./quick-start.sh [dev|prod]"
    exit 1
fi

log_info "=============================================="
log_info "ThinkCoffee Quick Start"
log_info "=============================================="
log_info "Environment: $ENV"
log_info "Project:     $PROJECT_ROOT"
log_info "=============================================="

cd "$PROJECT_ROOT"

# ------------------------------------------------------------------------------
# Pre-requisite Checks
# ------------------------------------------------------------------------------
log_step "Checking prerequisites..."

# Check Docker
if ! command -v docker &> /dev/null; then
    log_error "Docker not found. Please install Docker first."
    log_info "  https://docs.docker.com/get-docker/"
    exit 1
fi
log_success "Docker found"

# Check Docker Compose
if ! docker compose version &> /dev/null; then
    log_error "Docker Compose not found."
    exit 1
fi
log_success "Docker Compose found"

# Check Node.js (for development)
if [[ "$ENV" == "dev" ]]; then
    if ! command -v node &> /dev/null; then
        log_warn "Node.js not found. Install Node.js 20+ for local development."
    else
        NODE_VERSION=$(node --version)
        log_success "Node.js $NODE_VERSION found"
    fi
    
    if ! command -v pnpm &> /dev/null; then
        log_warn "pnpm not found. Installing..."
        npm install -g pnpm || corepack enable
    fi
    log_success "pnpm found"
fi

# ------------------------------------------------------------------------------
# Setup Environment File
# ------------------------------------------------------------------------------
log_step "Setting up environment..."

if [[ ! -f .env ]]; then
    log_info "Creating .env from .env.example..."
    cp .env.example .env
    
    if [[ "$ENV" == "dev" ]]; then
        # Adjust for development
        sed -i.bak 's/NODE_ENV=production/NODE_ENV=development/' .env 2>/dev/null || true
        sed -i.bak 's/LOG_LEVEL=info/LOG_LEVEL=debug/' .env 2>/dev/null || true
        rm -f .env.bak
    fi
    
    log_success ".env file created"
else
    log_info ".env file already exists"
fi

# ------------------------------------------------------------------------------
# Create Required Directories
# ------------------------------------------------------------------------------
log_step "Creating directories..."

mkdir -p backups
log_success "backups/ directory ready"

# ------------------------------------------------------------------------------
# Start Services
# ------------------------------------------------------------------------------
log_step "Starting services..."

if [[ "$ENV" == "dev" ]]; then
    log_info "Starting development environment..."
    
    # Install dependencies
    log_info "Installing dependencies..."
    pnpm install
    
    # Build packages
    log_info "Building packages..."
    pnpm build
    
    # Start with docker-compose.dev.yml
    log_info "Starting Docker containers (dev mode)..."
    docker compose -f docker-compose.dev.yml up -d
    
    COMPOSE_FILE="docker-compose.dev.yml"
else
    log_info "Starting production environment..."
    
    # Build images
    log_info "Building Docker images..."
    docker compose build
    
    # Start services
    log_info "Starting Docker containers..."
    docker compose up -d
    
    COMPOSE_FILE="docker-compose.yml"
fi

# ------------------------------------------------------------------------------
# Wait for Services
# ------------------------------------------------------------------------------
log_step "Waiting for services to be ready..."

MAX_RETRIES=30
RETRY_INTERVAL=2
HEALTH_URL="http://localhost:${MCP_PORT:-3000}/health"

for i in $(seq 1 $MAX_RETRIES); do
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
        log_success "MCP Server is ready!"
        break
    fi
    
    if [[ $i -eq $MAX_RETRIES ]]; then
        log_warn "Service health check timed out (may still be starting)"
        log_info "Check logs with: docker compose -f $COMPOSE_FILE logs -f mcp-server"
    else
        echo -n "."
        sleep $RETRY_INTERVAL
    fi
done

echo ""

# ------------------------------------------------------------------------------
# Run Health Check
# ------------------------------------------------------------------------------
log_step "Running health check..."
"$SCRIPT_DIR/health-check.sh" localhost "${MCP_PORT:-3000}" || true

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
echo ""
log_success "=============================================="
log_success "ThinkCoffee is ready!"
log_success "=============================================="
echo ""
log_info "Services:"
docker compose -f "$COMPOSE_FILE" ps
echo ""
log_info "Useful commands:"
if [[ "$ENV" == "dev" ]]; then
    echo "  - View logs:       docker compose -f docker-compose.dev.yml logs -f"
    echo "  - Stop services:   docker compose -f docker-compose.dev.yml down"
    echo "  - Run tests:       pnpm test"
    echo "  - Dev MCP server:  pnpm dev:mcp"
    echo "  - Build:           pnpm build"
else
    echo "  - View logs:       docker compose logs -f"
    echo "  - Stop services:   docker compose down"
    echo "  - Deploy update:   ./scripts/deploy.sh production <version>"
    echo "  - Create backup:   ./scripts/backup.sh manual"
    echo "  - Health check:    ./scripts/health-check.sh"
fi
echo ""
log_info "Safety Net scripts:"
echo "  - Snapshot cleanup: ./scripts/snapshot-cleanup.sh [--dry-run]"
echo "  - Log cleanup:      ./scripts/log-cleanup.sh [--dry-run]"
echo ""
log_info "MCP Server: http://localhost:${MCP_PORT:-3000}"
log_info "Health:     http://localhost:${MCP_PORT:-3000}/health"
echo ""
