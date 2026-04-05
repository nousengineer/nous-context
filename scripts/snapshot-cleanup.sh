#!/bin/bash
# ==============================================================================
# ThinkCoffee - Snapshot Cleanup Script (V5 - Agent Safety Net)
# ==============================================================================
# Executa limpeza de snapshots antigos baseado em:
#   - Retencao em dias (THINKCOFFEE_SNAPSHOT_RETENTION_DAYS)
#   - Tamanho maximo por pipeline (THINKCOFFEE_SNAPSHOT_MAX_SIZE_MB)
#
# Usage: ./scripts/snapshot-cleanup.sh [--dry-run]
# Example: ./scripts/snapshot-cleanup.sh
#          ./scripts/snapshot-cleanup.sh --dry-run
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
DRY_RUN="${1:-}"
RETENTION_DAYS="${THINKCOFFEE_SNAPSHOT_RETENTION_DAYS:-7}"
MAX_SIZE_MB="${THINKCOFFEE_SNAPSHOT_MAX_SIZE_MB:-50}"
SNAPSHOT_DIR="${THINKCOFFEE_SNAPSHOT_DIR:-/data/snapshots}"
CONTAINER_NAME="${CONTAINER_NAME:-thinkcoffee-mcp}"

if [[ "$DRY_RUN" == "--dry-run" ]]; then
    DRY_RUN="true"
    log_warn "DRY-RUN MODE: No files will be deleted"
else
    DRY_RUN="false"
fi

log_info "=============================================="
log_info "ThinkCoffee Snapshot Cleanup"
log_info "=============================================="
log_info "Retention:    $RETENTION_DAYS days"
log_info "Max Size:     $MAX_SIZE_MB MB per pipeline"
log_info "Snapshot Dir: $SNAPSHOT_DIR"
log_info "Dry Run:      $DRY_RUN"
log_info "=============================================="

# ------------------------------------------------------------------------------
# Check if running in container or host
# ------------------------------------------------------------------------------
run_cleanup() {
    local CMD="$1"
    
    if [[ -d "$SNAPSHOT_DIR" ]]; then
        # Running on host with direct access
        eval "$CMD"
    elif command -v docker &> /dev/null && docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        # Running on host, execute in container
        docker exec "$CONTAINER_NAME" sh -c "$CMD"
    else
        log_error "Cannot access snapshot directory and container not running"
        exit 1
    fi
}

# ------------------------------------------------------------------------------
# Cleanup by Age
# ------------------------------------------------------------------------------
cleanup_by_age() {
    log_info "Cleaning up snapshots older than $RETENTION_DAYS days..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        # Just list what would be deleted
        OLD_SNAPSHOTS=$(run_cleanup "find $SNAPSHOT_DIR -type d -mtime +$RETENTION_DAYS -mindepth 1 -maxdepth 2 2>/dev/null" || true)
        
        if [[ -n "$OLD_SNAPSHOTS" ]]; then
            log_info "Would delete the following snapshots:"
            echo "$OLD_SNAPSHOTS" | while read -r dir; do
                if [[ -n "$dir" ]]; then
                    SIZE=$(run_cleanup "du -sh '$dir' 2>/dev/null | cut -f1" || echo "?")
                    log_warn "  $dir ($SIZE)"
                fi
            done
        else
            log_success "No snapshots older than $RETENTION_DAYS days found"
        fi
    else
        # Actually delete
        DELETED=$(run_cleanup "find $SNAPSHOT_DIR -type d -mtime +$RETENTION_DAYS -mindepth 1 -maxdepth 2 -exec rm -rf {} + -print 2>/dev/null | wc -l" || echo "0")
        log_success "Deleted $DELETED old snapshot directories"
    fi
}

# ------------------------------------------------------------------------------
# Cleanup by Size
# ------------------------------------------------------------------------------
cleanup_by_size() {
    log_info "Checking snapshot sizes (max ${MAX_SIZE_MB}MB per pipeline)..."
    
    MAX_SIZE_KB=$((MAX_SIZE_MB * 1024))
    
    # Get list of pipeline directories
    PIPELINES=$(run_cleanup "find $SNAPSHOT_DIR -mindepth 1 -maxdepth 1 -type d 2>/dev/null" || true)
    
    if [[ -z "$PIPELINES" ]]; then
        log_success "No pipeline snapshots found"
        return
    fi
    
    echo "$PIPELINES" | while read -r pipeline_dir; do
        if [[ -z "$pipeline_dir" ]]; then
            continue
        fi
        
        PIPELINE_ID=$(basename "$pipeline_dir")
        SIZE_KB=$(run_cleanup "du -sk '$pipeline_dir' 2>/dev/null | cut -f1" || echo "0")
        SIZE_MB=$((SIZE_KB / 1024))
        
        if [[ $SIZE_KB -gt $MAX_SIZE_KB ]]; then
            log_warn "Pipeline $PIPELINE_ID exceeds limit (${SIZE_MB}MB > ${MAX_SIZE_MB}MB)"
            
            if [[ "$DRY_RUN" == "true" ]]; then
                # List oldest snapshots that would be deleted
                log_info "Would delete oldest snapshots from $PIPELINE_ID"
                run_cleanup "ls -1t '$pipeline_dir' 2>/dev/null | tail -n +3" || true
            else
                # Delete oldest snapshots until under limit
                while [[ $SIZE_KB -gt $MAX_SIZE_KB ]]; do
                    OLDEST=$(run_cleanup "ls -1t '$pipeline_dir' 2>/dev/null | tail -1" || true)
                    if [[ -z "$OLDEST" ]]; then
                        break
                    fi
                    
                    log_info "Deleting oldest snapshot: $pipeline_dir/$OLDEST"
                    run_cleanup "rm -rf '$pipeline_dir/$OLDEST'"
                    
                    SIZE_KB=$(run_cleanup "du -sk '$pipeline_dir' 2>/dev/null | cut -f1" || echo "0")
                done
                
                NEW_SIZE_MB=$((SIZE_KB / 1024))
                log_success "Pipeline $PIPELINE_ID reduced to ${NEW_SIZE_MB}MB"
            fi
        else
            log_success "Pipeline $PIPELINE_ID OK (${SIZE_MB}MB)"
        fi
    done
}

# ------------------------------------------------------------------------------
# Cleanup Empty Directories
# ------------------------------------------------------------------------------
cleanup_empty_dirs() {
    log_info "Cleaning up empty directories..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        EMPTY=$(run_cleanup "find $SNAPSHOT_DIR -type d -empty 2>/dev/null" || true)
        if [[ -n "$EMPTY" ]]; then
            log_info "Would delete empty directories:"
            echo "$EMPTY"
        else
            log_success "No empty directories found"
        fi
    else
        DELETED=$(run_cleanup "find $SNAPSHOT_DIR -type d -empty -delete -print 2>/dev/null | wc -l" || echo "0")
        log_success "Deleted $DELETED empty directories"
    fi
}

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
get_storage_summary() {
    log_info "Storage Summary:"
    
    TOTAL_SIZE=$(run_cleanup "du -sh $SNAPSHOT_DIR 2>/dev/null | cut -f1" || echo "N/A")
    TOTAL_PIPELINES=$(run_cleanup "find $SNAPSHOT_DIR -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l" || echo "0")
    TOTAL_SNAPSHOTS=$(run_cleanup "find $SNAPSHOT_DIR -mindepth 2 -maxdepth 2 -type d 2>/dev/null | wc -l" || echo "0")
    
    log_info "  Total Size:      $TOTAL_SIZE"
    log_info "  Total Pipelines: $TOTAL_PIPELINES"
    log_info "  Total Snapshots: $TOTAL_SNAPSHOTS"
}

# ------------------------------------------------------------------------------
# Run Cleanup
# ------------------------------------------------------------------------------
get_storage_summary
echo ""

cleanup_by_age
echo ""

cleanup_by_size
echo ""

cleanup_empty_dirs
echo ""

log_success "=============================================="
log_success "Snapshot cleanup completed!"
log_success "=============================================="

get_storage_summary
