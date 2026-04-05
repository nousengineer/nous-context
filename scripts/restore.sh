#!/bin/bash
# ==============================================================================
# ThinkCoffee - Restore Script
# ==============================================================================
# Usage: ./scripts/restore.sh <backup_file>
# Example: ./scripts/restore.sh backups/thinkcoffee_daily_20240115_120000.tar.gz
#          ./scripts/restore.sh latest
# ==============================================================================

set -euo pipefail

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
BACKUP_INPUT="${1:-}"
DATA_VOLUME="thinkcoffee_data"
BACKUP_DIR="./backups"
COMPOSE_FILE="docker-compose.yml"

# Resolve "latest" to most recent backup
if [[ "$BACKUP_INPUT" == "latest" ]]; then
    BACKUP_FILE=$(ls -1t "$BACKUP_DIR"/thinkcoffee_*.tar.gz 2>/dev/null | head -1)
    if [[ -z "$BACKUP_FILE" ]]; then
        log_error "No backups found in $BACKUP_DIR"
        exit 1
    fi
else
    BACKUP_FILE="$BACKUP_INPUT"
fi

if [[ -z "$BACKUP_FILE" ]]; then
    log_error "Usage: ./restore.sh <backup_file|latest>"
    log_info ""
    log_info "Available backups:"
    ls -lh "$BACKUP_DIR"/thinkcoffee_*.tar.gz 2>/dev/null || echo "  No backups found"
    exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
    log_error "Backup file not found: $BACKUP_FILE"
    exit 1
fi

log_info "=============================================="
log_info "ThinkCoffee Restore"
log_info "=============================================="
log_info "Backup: $BACKUP_FILE"
log_info "Volume: $DATA_VOLUME"
log_info "=============================================="

# ------------------------------------------------------------------------------
# Confirmation
# ------------------------------------------------------------------------------
log_warn "WARNING: This will REPLACE all current data in the volume!"
log_warn "A pre-restore backup will be created automatically."
echo ""
read -p "Are you sure you want to continue? (type 'yes' to confirm): " CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
    log_info "Restore cancelled"
    exit 0
fi

# ------------------------------------------------------------------------------
# Pre-restore Backup
# ------------------------------------------------------------------------------
log_info "Creating pre-restore backup..."

if docker volume inspect "$DATA_VOLUME" &> /dev/null; then
    ./scripts/backup.sh pre-restore 2>/dev/null || log_warn "Pre-restore backup failed, continuing..."
else
    log_info "Volume does not exist, creating..."
    docker volume create "$DATA_VOLUME"
fi

# ------------------------------------------------------------------------------
# Stop Services
# ------------------------------------------------------------------------------
log_info "Stopping services..."
docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true

# ------------------------------------------------------------------------------
# Verify Backup
# ------------------------------------------------------------------------------
log_info "Verifying backup integrity..."

if ! tar -tzf "$BACKUP_FILE" > /dev/null 2>&1; then
    log_error "Backup file is corrupted"
    exit 1
fi

log_success "Backup integrity verified"

# Show metadata if available
BACKUP_NAME=$(basename "$BACKUP_FILE" .tar.gz)
if tar -tzf "$BACKUP_FILE" | grep -q "backup_metadata.json"; then
    log_info "Backup metadata:"
    tar -xzf "$BACKUP_FILE" -O "${BACKUP_NAME}/backup_metadata.json" 2>/dev/null | cat
fi

# ------------------------------------------------------------------------------
# Restore Data
# ------------------------------------------------------------------------------
log_info "Restoring data..."

# Clear volume and restore
docker run --rm \
    -v "$DATA_VOLUME":/data \
    -v "$(pwd)":/workspace \
    alpine \
    sh -c "rm -rf /data/* && tar -xzf /workspace/$BACKUP_FILE -C /tmp && cp -r /tmp/${BACKUP_NAME}/. /data/ 2>/dev/null || cp -r /tmp/*/. /data/"

log_success "Data restored"

# ------------------------------------------------------------------------------
# Verify Restored Data
# ------------------------------------------------------------------------------
log_info "Verifying restored data..."

# Check critical files exist
CRITICAL_FILES=("data.sqlite")
for file in "${CRITICAL_FILES[@]}"; do
    if docker run --rm -v "$DATA_VOLUME":/data alpine test -f "/data/$file"; then
        log_success "Found: $file"
    else
        log_warn "Missing: $file (may be expected for fresh installations)"
    fi
done

# ------------------------------------------------------------------------------
# Restart Services
# ------------------------------------------------------------------------------
log_info "Starting services..."
docker compose -f "$COMPOSE_FILE" up -d

# Wait for health check
log_info "Waiting for services to be healthy..."
sleep 10

MAX_RETRIES=30
for i in $(seq 1 $MAX_RETRIES); do
    if docker compose -f "$COMPOSE_FILE" ps | grep -q "healthy"; then
        log_success "Services are healthy"
        break
    fi
    
    if [[ $i -eq $MAX_RETRIES ]]; then
        log_warn "Services may not be fully healthy yet"
    fi
    
    sleep 2
done

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
log_success "=============================================="
log_success "Restore completed successfully!"
log_success "Backup used: $BACKUP_FILE"
log_success "=============================================="

docker compose -f "$COMPOSE_FILE" ps
