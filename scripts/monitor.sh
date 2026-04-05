#!/bin/bash
# ==============================================================================
# ThinkCoffee - Monitor Script
# ==============================================================================
# Usage: ./scripts/monitor.sh [--watch]
# Monitors health, disk usage, and history persistence
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

WATCH_MODE="${1:-}"
DATA_VOLUME="thinkcoffee_data"
CONTAINER_NAME="thinkcoffee-mcp"
HEALTH_URL="http://localhost:${MCP_PORT:-3000}/health"

# ------------------------------------------------------------------------------
# Functions
# ------------------------------------------------------------------------------
print_header() {
    echo -e "${CYAN}=============================================="
    echo -e "ThinkCoffee Monitor - $(date '+%Y-%m-%d %H:%M:%S')"
    echo -e "==============================================${NC}"
}

check_container_status() {
    echo -e "\n${BLUE}[Container Status]${NC}"
    
    if docker ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
        STATUS=$(docker inspect --format='{{.State.Status}}' $CONTAINER_NAME)
        HEALTH=$(docker inspect --format='{{.State.Health.Status}}' $CONTAINER_NAME 2>/dev/null || echo "N/A")
        UPTIME=$(docker inspect --format='{{.State.StartedAt}}' $CONTAINER_NAME)
        
        echo -e "  Container: ${GREEN}Running${NC}"
        echo -e "  Status:    $STATUS"
        echo -e "  Health:    $( [[ "$HEALTH" == "healthy" ]] && echo -e "${GREEN}$HEALTH${NC}" || echo -e "${YELLOW}$HEALTH${NC}" )"
        echo -e "  Started:   $UPTIME"
    else
        echo -e "  Container: ${RED}Not Running${NC}"
        return 1
    fi
}

check_health_endpoint() {
    echo -e "\n${BLUE}[Health Endpoint]${NC}"
    
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
        echo -e "  Endpoint:  ${GREEN}OK${NC} ($HEALTH_URL)"
        RESPONSE=$(curl -s "$HEALTH_URL" 2>/dev/null || echo "{}")
        echo -e "  Response:  $RESPONSE"
    else
        echo -e "  Endpoint:  ${RED}UNREACHABLE${NC} ($HEALTH_URL)"
    fi
}

check_volume_status() {
    echo -e "\n${BLUE}[Volume Status]${NC}"
    
    if docker volume inspect "$DATA_VOLUME" > /dev/null 2>&1; then
        MOUNTPOINT=$(docker volume inspect --format='{{.Mountpoint}}' $DATA_VOLUME)
        echo -e "  Volume:    ${GREEN}Exists${NC}"
        echo -e "  Mount:     $MOUNTPOINT"
        
        # Get volume size
        SIZE=$(docker run --rm -v $DATA_VOLUME:/data alpine du -sh /data 2>/dev/null | cut -f1)
        echo -e "  Size:      $SIZE"
    else
        echo -e "  Volume:    ${RED}Not Found${NC}"
    fi
}

check_data_integrity() {
    echo -e "\n${BLUE}[Data Integrity]${NC}"
    
    # Check SQLite database
    if docker run --rm -v $DATA_VOLUME:/data alpine test -f /data/data.sqlite; then
        DB_SIZE=$(docker run --rm -v $DATA_VOLUME:/data alpine du -h /data/data.sqlite | cut -f1)
        echo -e "  SQLite DB: ${GREEN}OK${NC} ($DB_SIZE)"
    else
        echo -e "  SQLite DB: ${YELLOW}Not Found${NC}"
    fi
    
    # Check snapshots directory
    SNAPSHOT_COUNT=$(docker run --rm -v $DATA_VOLUME:/data alpine sh -c "ls /data/snapshots 2>/dev/null | wc -l" || echo "0")
    echo -e "  Snapshots: $SNAPSHOT_COUNT files"
    
    # Check logs directory
    LOG_COUNT=$(docker run --rm -v $DATA_VOLUME:/data alpine sh -c "ls /data/logs 2>/dev/null | wc -l" || echo "0")
    echo -e "  Logs:      $LOG_COUNT files"
    
    # Check chat history files
    HISTORY_COUNT=$(docker run --rm -v $DATA_VOLUME:/data alpine sh -c "ls /data/chat_history_*.json 2>/dev/null | wc -l" || echo "0")
    if [[ "$HISTORY_COUNT" -gt 0 ]]; then
        echo -e "  Chat Hist: ${GREEN}$HISTORY_COUNT file(s)${NC}"
        
        # Show recent history files
        docker run --rm -v $DATA_VOLUME:/data alpine sh -c "ls -lh /data/chat_history_*.json 2>/dev/null | tail -3" | while read line; do
            echo "             $line"
        done
    else
        echo -e "  Chat Hist: ${YELLOW}No history files${NC}"
    fi
}

check_disk_space() {
    echo -e "\n${BLUE}[Disk Space]${NC}"
    
    # Host disk space
    DOCKER_ROOT=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo "/var/lib/docker")
    DISK_USAGE=$(df -h "$DOCKER_ROOT" 2>/dev/null | tail -1 | awk '{print $5}')
    DISK_AVAIL=$(df -h "$DOCKER_ROOT" 2>/dev/null | tail -1 | awk '{print $4}')
    
    USAGE_NUM=${DISK_USAGE%\%}
    if [[ $USAGE_NUM -gt 90 ]]; then
        echo -e "  Usage:     ${RED}$DISK_USAGE${NC} (CRITICAL)"
    elif [[ $USAGE_NUM -gt 80 ]]; then
        echo -e "  Usage:     ${YELLOW}$DISK_USAGE${NC} (WARNING)"
    else
        echo -e "  Usage:     ${GREEN}$DISK_USAGE${NC}"
    fi
    echo -e "  Available: $DISK_AVAIL"
}

check_recent_logs() {
    echo -e "\n${BLUE}[Recent Logs (last 10 lines)]${NC}"
    
    docker logs --tail 10 $CONTAINER_NAME 2>&1 | while read line; do
        if echo "$line" | grep -qi "error"; then
            echo -e "  ${RED}$line${NC}"
        elif echo "$line" | grep -qi "warn"; then
            echo -e "  ${YELLOW}$line${NC}"
        else
            echo -e "  $line"
        fi
    done
}

check_backups() {
    echo -e "\n${BLUE}[Backups]${NC}"
    
    BACKUP_DIR="./backups"
    if [[ -d "$BACKUP_DIR" ]]; then
        BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/thinkcoffee_*.tar.gz 2>/dev/null | wc -l)
        echo -e "  Count:     $BACKUP_COUNT backup(s)"
        
        if [[ $BACKUP_COUNT -gt 0 ]]; then
            LATEST=$(ls -1t "$BACKUP_DIR"/thinkcoffee_*.tar.gz 2>/dev/null | head -1)
            LATEST_DATE=$(stat -c %y "$LATEST" 2>/dev/null | cut -d' ' -f1,2 | cut -d'.' -f1)
            LATEST_SIZE=$(du -h "$LATEST" | cut -f1)
            echo -e "  Latest:    $(basename $LATEST)"
            echo -e "  Date:      $LATEST_DATE"
            echo -e "  Size:      $LATEST_SIZE"
        fi
    else
        echo -e "  Status:    ${YELLOW}No backup directory${NC}"
    fi
}

run_checks() {
    print_header
    check_container_status || true
    check_health_endpoint
    check_volume_status
    check_data_integrity
    check_disk_space
    check_backups
    check_recent_logs
    echo ""
}

# ------------------------------------------------------------------------------
# Main
# ------------------------------------------------------------------------------
if [[ "$WATCH_MODE" == "--watch" || "$WATCH_MODE" == "-w" ]]; then
    echo "Starting monitor in watch mode (Ctrl+C to exit)..."
    while true; do
        clear
        run_checks
        sleep 30
    done
else
    run_checks
fi
