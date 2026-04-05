#!/bin/bash
# ==============================================================================
# ThinkCoffee - Backup Script
# ==============================================================================
# Usage: ./scripts/backup.sh [tag]
# Example: ./scripts/backup.sh pre-deploy
#          ./scripts/backup.sh daily
#          ./scripts/backup.sh manual
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
TAG="${1:-manual}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DATA_VOLUME="thinkcoffee_data"
BACKUP_DIR="./backups"
BACKUP_NAME="thinkcoffee_${TAG}_${TIMESTAMP}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
MAX_BACKUPS="${MAX_BACKUP_COUNT:-10}"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

log_info "=============================================="
log_info "ThinkCoffee Backup"
log_info "=============================================="
log_info "Tag:       $TAG"
log_info "Timestamp: $TIMESTAMP"
log_info "Output:    $BACKUP_DIR/$BACKUP_NAME.tar.gz"
log_info "=============================================="

# ------------------------------------------------------------------------------
# Pre-backup Checks
# ------------------------------------------------------------------------------
log_info "Running pre-backup checks..."

if ! docker volume inspect "$DATA_VOLUME" &> /dev/null; then
    log_error "Data volume '$DATA_VOLUME' not found"
    exit 1
fi

log_success "Volume exists"

# ------------------------------------------------------------------------------
# Create Backup
# ------------------------------------------------------------------------------
log_info "Creating backup..."

# Create temporary directory for backup
TEMP_BACKUP_DIR="$BACKUP_DIR/${BACKUP_NAME}"
mkdir -p "$TEMP_BACKUP_DIR"

# Copy data from volume
docker run --rm \
    -v "$DATA_VOLUME":/data:ro \
    -v "$(pwd)/$TEMP_BACKUP_DIR":/backup \
    alpine \
    sh -c "cp -r /data/. /backup/"

# Create metadata file
cat > "$TEMP_BACKUP_DIR/backup_metadata.json" << EOF
{
    "tag": "$TAG",
    "timestamp": "$TIMESTAMP",
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "volume": "$DATA_VOLUME",
    "host": "$(hostname)",
    "files": $(docker run --rm -v "$DATA_VOLUME":/data:ro alpine find /data -type f | wc -l),
    "size_bytes": $(docker run --rm -v "$DATA_VOLUME":/data:ro alpine du -sb /data | cut -f1)
}
EOF

# Compress
tar -czf "$BACKUP_DIR/${BACKUP_NAME}.tar.gz" -C "$BACKUP_DIR" "$BACKUP_NAME"

# Remove temporary directory
rm -rf "$TEMP_BACKUP_DIR"

log_success "Backup created: $BACKUP_DIR/${BACKUP_NAME}.tar.gz"

# ------------------------------------------------------------------------------
# Verify Backup
# ------------------------------------------------------------------------------
log_info "Verifying backup integrity..."

if tar -tzf "$BACKUP_DIR/${BACKUP_NAME}.tar.gz" > /dev/null 2>&1; then
    log_success "Backup integrity verified"
else
    log_error "Backup verification failed"
    exit 1
fi

# Show backup size
BACKUP_SIZE=$(du -h "$BACKUP_DIR/${BACKUP_NAME}.tar.gz" | cut -f1)
log_info "Backup size: $BACKUP_SIZE"

# ------------------------------------------------------------------------------
# Cleanup Old Backups
# ------------------------------------------------------------------------------
log_info "Cleaning up old backups..."

# Remove backups older than retention period
find "$BACKUP_DIR" -name "thinkcoffee_*.tar.gz" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

# Keep only MAX_BACKUPS most recent
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/thinkcoffee_*.tar.gz 2>/dev/null | wc -l)
if [[ $BACKUP_COUNT -gt $MAX_BACKUPS ]]; then
    ls -1t "$BACKUP_DIR"/thinkcoffee_*.tar.gz | tail -n +$((MAX_BACKUPS + 1)) | xargs rm -f
    log_info "Removed $(($BACKUP_COUNT - $MAX_BACKUPS)) old backup(s)"
fi

log_success "Cleanup complete"

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
log_success "=============================================="
log_success "Backup completed successfully!"
log_success "File: $BACKUP_DIR/${BACKUP_NAME}.tar.gz"
log_success "Size: $BACKUP_SIZE"
log_success "=============================================="

# List recent backups
log_info "Recent backups:"
ls -lh "$BACKUP_DIR"/thinkcoffee_*.tar.gz 2>/dev/null | tail -5
