#!/bin/bash
# ==============================================================================
# ThinkCoffee - Health Check Script (V5 - Agent Safety Net)
# ==============================================================================
# Usage: ./scripts/health-check.sh [host] [port]
# Example: ./scripts/health-check.sh localhost 3000
#          ./scripts/health-check.sh production.example.com 3000
# ==============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ------------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------------
HOST="${1:-localhost}"
PORT="${2:-${MCP_PORT:-3000}}"
HEALTH_URL="http://${HOST}:${PORT}/health"
TIMEOUT="${HEALTH_CHECK_TIMEOUT:-10}"
RETRIES="${HEALTH_CHECK_RETRIES:-3}"
CONTAINER_NAME="${CONTAINER_NAME:-thinkcoffee-mcp}"

log_info "=============================================="
log_info "ThinkCoffee Health Check"
log_info "=============================================="
log_info "Host:      $HOST"
log_info "Port:      $PORT"
log_info "URL:       $HEALTH_URL"
log_info "Timeout:   ${TIMEOUT}s"
log_info "Retries:   $RETRIES"
log_info "=============================================="

# ------------------------------------------------------------------------------
# HTTP Health Check
# ------------------------------------------------------------------------------
check_http_health() {
    log_info "Checking HTTP health endpoint..."
    
    for i in $(seq 1 $RETRIES); do
        HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$HEALTH_URL" 2>/dev/null || echo "000")
        
        if [[ "$HTTP_CODE" == "200" ]]; then
            log_success "HTTP health check passed (HTTP $HTTP_CODE)"
            return 0
        fi
        
        log_warn "Attempt $i/$RETRIES failed (HTTP $HTTP_CODE)"
        
        if [[ $i -lt $RETRIES ]]; then
            sleep 2
        fi
    done
    
    log_error "HTTP health check failed after $RETRIES attempts"
    return 1
}

# ------------------------------------------------------------------------------
# Container Health Check
# ------------------------------------------------------------------------------
check_container_health() {
    log_info "Checking container status..."
    
    if ! command -v docker &> /dev/null; then
        log_warn "Docker not found -- skipping container check"
        return 0
    fi
    
    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_error "Container '$CONTAINER_NAME' is not running"
        return 1
    fi
    
    log_success "Container '$CONTAINER_NAME' is running"
    
    # Check container health status
    CONTAINER_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "none")
    
    if [[ "$CONTAINER_HEALTH" == "healthy" ]]; then
        log_success "Container health status: $CONTAINER_HEALTH"
    elif [[ "$CONTAINER_HEALTH" == "none" ]]; then
        log_warn "Container has no health check configured"
    else
        log_warn "Container health status: $CONTAINER_HEALTH"
    fi
    
    return 0
}

# ------------------------------------------------------------------------------
# Safety Net Storage Check
# ------------------------------------------------------------------------------
check_safety_net_storage() {
    log_info "Checking Safety Net storage..."
    
    if ! command -v docker &> /dev/null; then
        log_warn "Docker not found -- skipping storage check"
        return 0
    fi
    
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_warn "Container not running -- skipping storage check"
        return 0
    fi
    
    # Check snapshots directory
    if docker exec "$CONTAINER_NAME" test -d /data/snapshots 2>/dev/null; then
        SNAPSHOT_COUNT=$(docker exec "$CONTAINER_NAME" find /data/snapshots -type f 2>/dev/null | wc -l || echo "0")
        SNAPSHOT_SIZE=$(docker exec "$CONTAINER_NAME" du -sh /data/snapshots 2>/dev/null | cut -f1 || echo "0")
        log_success "Snapshots dir OK ($SNAPSHOT_COUNT files, $SNAPSHOT_SIZE)"
    else
        log_warn "Snapshots directory not found"
    fi
    
    # Check logs directory
    if docker exec "$CONTAINER_NAME" test -d /data/logs 2>/dev/null; then
        LOG_COUNT=$(docker exec "$CONTAINER_NAME" find /data/logs -type f -name "*.jsonl" 2>/dev/null | wc -l || echo "0")
        LOG_SIZE=$(docker exec "$CONTAINER_NAME" du -sh /data/logs 2>/dev/null | cut -f1 || echo "0")
        log_success "Logs dir OK ($LOG_COUNT files, $LOG_SIZE)"
    else
        log_warn "Logs directory not found"
    fi
    
    # Check database
    if docker exec "$CONTAINER_NAME" test -f /data/data.sqlite 2>/dev/null; then
        DB_SIZE=$(docker exec "$CONTAINER_NAME" du -sh /data/data.sqlite 2>/dev/null | cut -f1 || echo "0")
        log_success "Database OK ($DB_SIZE)"
    else
        log_warn "Database file not found"
    fi
    
    return 0
}

# ------------------------------------------------------------------------------
# Environment Variables Check
# ------------------------------------------------------------------------------
check_env_vars() {
    log_info "Checking Safety Net environment variables..."
    
    if ! command -v docker &> /dev/null; then
        log_warn "Docker not found -- skipping env check"
        return 0
    fi
    
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_warn "Container not running -- skipping env check"
        return 0
    fi
    
    REQUIRED_VARS=(
        "THINKCOFFEE_SNAPSHOT_DIR"
        "THINKCOFFEE_LOG_DIR"
        "THINKCOFFEE_SNAPSHOT_RETENTION_DAYS"
        "THINKCOFFEE_DRY_RUN_DEFAULT"
        "THINKCOFFEE_DIFF_PREVIEW_MODE"
        "THINKCOFFEE_COMMAND_CONFIRMATION"
    )
    
    MISSING=0
    for VAR in "${REQUIRED_VARS[@]}"; do
        if docker exec "$CONTAINER_NAME" printenv "$VAR" &>/dev/null; then
            VALUE=$(docker exec "$CONTAINER_NAME" printenv "$VAR" 2>/dev/null)
            log_success "$VAR=$VALUE"
        else
            log_warn "$VAR not set"
            MISSING=$((MISSING + 1))
        fi
    done
    
    if [[ $MISSING -gt 0 ]]; then
        log_warn "$MISSING environment variable(s) not configured"
    fi
    
    return 0
}

# ------------------------------------------------------------------------------
# Memory & Resources Check
# ------------------------------------------------------------------------------
check_resources() {
    log_info "Checking container resources..."
    
    if ! command -v docker &> /dev/null; then
        log_warn "Docker not found -- skipping resource check"
        return 0
    fi
    
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_warn "Container not running -- skipping resource check"
        return 0
    fi
    
    # Get container stats
    STATS=$(docker stats --no-stream --format "{{.MemUsage}}\t{{.CPUPerc}}" "$CONTAINER_NAME" 2>/dev/null || echo "N/A\tN/A")
    MEM_USAGE=$(echo "$STATS" | cut -f1)
    CPU_USAGE=$(echo "$STATS" | cut -f2)
    
    log_info "Memory: $MEM_USAGE"
    log_info "CPU:    $CPU_USAGE"
    
    return 0
}

# ------------------------------------------------------------------------------
# Run All Checks
# ------------------------------------------------------------------------------
FAILED=0

check_http_health || FAILED=$((FAILED + 1))
check_container_health || FAILED=$((FAILED + 1))
check_safety_net_storage || true  # Non-critical
check_env_vars || true            # Non-critical  
check_resources || true           # Non-critical

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
echo ""
if [[ $FAILED -eq 0 ]]; then
    log_success "=============================================="
    log_success "All health checks passed!"
    log_success "=============================================="
    exit 0
else
    log_error "=============================================="
    log_error "$FAILED critical check(s) failed"
    log_error "=============================================="
    exit 1
fi
