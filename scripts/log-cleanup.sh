#!/bin/bash
# ==============================================================================
# ThinkCoffee - Log Cleanup Script (V5 - Agent Safety Net)
# ==============================================================================
# Executa limpeza de logs de acao de agentes
#
# Usage: ./scripts/log-cleanup.sh [--dry-run]
# Example: ./scripts/log-cleanup.sh
#          ./scripts/log-cleanup.sh --dry-run
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
RETENTION_DAYS="${THINKCOFFEE_LOG_RETENTION_DAYS:-30}"
MAX_LOG_SIZE_MB="${THINKCOFFEE_LOG_MAX_SIZE_MB:-100}"
LOG_DIR="${THINKCOFFEE_LOG_DIR:-/data/logs}"
CONTAINER_NAME="${CONTAINER_NAME:-thinkcoffee-mcp}"

if [[ "$DRY_RUN" == "--dry-run" ]]; then
    DRY_RUN="true"
    log_warn "DRY-RUN MODE: No files will be deleted"
else
    DRY_RUN="false"
fi

log_info "=============================================="
log_info "ThinkCoffee Log Cleanup"
log_info "=============================================="
log_info "Retention:  $RETENTION_DAYS days"
log_info "Max Size:   $MAX_LOG_SIZE_MB MB"
log_info "Log Dir:    $LOG_DIR"
log_info "Dry Run:    $DRY_RUN"
log_info "=============================================="

# ------------------------------------------------------------------------------
# Check if running in container or host
# ------------------------------------------------------------------------------
run_cmd() {
    local CMD="$1"
    
    if [[ -d "$LOG_DIR" ]]; then
        eval "$CMD"
    elif command -v docker &> /dev/null && docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker exec "$CONTAINER_NAME" sh -c "$CMD"
    else
        log_error "Cannot access log directory and container not running"
        exit 1
    fi
}

# ------------------------------------------------------------------------------
# Cleanup by Age
# ------------------------------------------------------------------------------
cleanup_by_age() {
    log_info "Cleaning up logs older than $RETENTION_DAYS days..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        OLD_LOGS=$(run_cmd "find $LOG_DIR -type f -name '*.jsonl' -mtime +$RETENTION_DAYS 2>/dev/null" || true)
        
        if [[ -n "$OLD_LOGS" ]]; then
            log_info "Would delete the following log files:"
            echo "$OLD_LOGS" | while read -r file; do
                if [[ -n "$file" ]]; then
                    SIZE=$(run_cmd "du -h '$file' 2>/dev/null | cut -f1" || echo "?")
                    log_warn "  $file ($SIZE)"
                fi
            done
        else
            log_success "No logs older than $RETENTION_DAYS days found"
        fi
    else
        DELETED=$(run_cmd "find $LOG_DIR -type f -name '*.jsonl' -mtime +$RETENTION_DAYS -delete -print 2>/dev/null | wc -l" || echo "0")
        log_success "Deleted $DELETED old log files"
    fi
}

# ------------------------------------------------------------------------------
# Compress Old Logs
# ------------------------------------------------------------------------------
compress_old_logs() {
    log_info "Compressing logs older than 7 days..."
    
    OLD_LOGS=$(run_cmd "find $LOG_DIR -type f -name '*.jsonl' ! -name '*.gz' -mtime +7 2>/dev/null" || true)
    
    if [[ -z "$OLD_LOGS" ]]; then
        log_success "No logs to compress"
        return
    fi
    
    COMPRESSED=0
    echo "$OLD_LOGS" | while read -r file; do
        if [[ -n "$file" ]]; then
            if [[ "$DRY_RUN" == "true" ]]; then
                SIZE=$(run_cmd "du -h '$file' 2>/dev/null | cut -f1" || echo "?")
                log_info "Would compress: $file ($SIZE)"
            else
                run_cmd "gzip '$file'" && COMPRESSED=$((COMPRESSED + 1))
            fi
        fi
    done
    
    if [[ "$DRY_RUN" != "true" ]]; then
        log_success "Compressed $COMPRESSED log files"
    fi
}

# ------------------------------------------------------------------------------
# Cleanup by Size
# ------------------------------------------------------------------------------
cleanup_by_size() {
    log_info "Checking total log size (max ${MAX_LOG_SIZE_MB}MB)..."
    
    MAX_SIZE_KB=$((MAX_LOG_SIZE_MB * 1024))
    TOTAL_SIZE_KB=$(run_cmd "du -sk $LOG_DIR 2>/dev/null | cut -f1" || echo "0")
    TOTAL_SIZE_MB=$((TOTAL_SIZE_KB / 1024))
    
    if [[ $TOTAL_SIZE_KB -gt $MAX_SIZE_KB ]]; then
        log_warn "Log directory exceeds limit (${TOTAL_SIZE_MB}MB > ${MAX_LOG_SIZE_MB}MB)"
        
        if [[ "$DRY_RUN" == "true" ]]; then
            log_info "Would delete oldest log files to reduce size"
            run_cmd "ls -1t $LOG_DIR/**/*.jsonl $LOG_DIR/**/*.jsonl.gz 2>/dev/null | tail -5" || true
        else
            while [[ $TOTAL_SIZE_KB -gt $MAX_SIZE_KB ]]; do
                OLDEST=$(run_cmd "find $LOG_DIR -type f \\( -name '*.jsonl' -o -name '*.jsonl.gz' \\) -printf '%T@ %p\\n' 2>/dev/null | sort -n | head -1 | cut -d' ' -f2" || true)
                
                if [[ -z "$OLDEST" ]]; then
                    break
                fi
                
                log_info "Deleting oldest log: $OLDEST"
                run_cmd "rm -f '$OLDEST'"
                
                TOTAL_SIZE_KB=$(run_cmd "du -sk $LOG_DIR 2>/dev/null | cut -f1" || echo "0")
            done
            
            NEW_SIZE_MB=$((TOTAL_SIZE_KB / 1024))
            log_success "Log directory reduced to ${NEW_SIZE_MB}MB"
        fi
    else
        log_success "Log directory size OK (${TOTAL_SIZE_MB}MB)"
    fi
}

# ------------------------------------------------------------------------------
# Cleanup Empty Directories
# ------------------------------------------------------------------------------
cleanup_empty_dirs() {
    log_info "Cleaning up empty directories..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        EMPTY=$(run_cmd "find $LOG_DIR -type d -empty 2>/dev/null" || true)
        if [[ -n "$EMPTY" ]]; then
            log_info "Would delete empty directories:"
            echo "$EMPTY"
        else
            log_success "No empty directories found"
        fi
    else
        DELETED=$(run_cmd "find $LOG_DIR -type d -empty -delete -print 2>/dev/null | wc -l" || echo "0")
        log_success "Deleted $DELETED empty directories"
    fi
}

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
get_storage_summary() {
    log_info "Storage Summary:"
    
    TOTAL_SIZE=$(run_cmd "du -sh $LOG_DIR 2>/dev/null | cut -f1" || echo "N/A")
    TOTAL_PROJECTS=$(run_cmd "find $LOG_DIR -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l" || echo "0")
    TOTAL_LOGS=$(run_cmd "find $LOG_DIR -type f -name '*.jsonl' 2>/dev/null | wc -l" || echo "0")
    TOTAL_COMPRESSED=$(run_cmd "find $LOG_DIR -type f -name '*.jsonl.gz' 2>/dev/null | wc -l" || echo "0")
    
    log_info "  Total Size:       $TOTAL_SIZE"
    log_info "  Total Projects:   $TOTAL_PROJECTS"
    log_info "  Active Logs:      $TOTAL_LOGS"
    log_info "  Compressed Logs:  $TOTAL_COMPRESSED"
}

# ------------------------------------------------------------------------------
# Run Cleanup
# ------------------------------------------------------------------------------
get_storage_summary
echo ""

cleanup_by_age
echo ""

compress_old_logs
echo ""

cleanup_by_size
echo ""

cleanup_empty_dirs
echo ""

log_success "=============================================="
log_success "Log cleanup completed!"
log_success "=============================================="

get_storage_summary
