# ThinkCoffee Infrastructure Setup Guide

## Overview

This document describes the infrastructure setup, CI/CD pipeline, Docker configuration, and deployment procedures for the ThinkCoffee project.

## 1. Infrastructure Components

### 1.1 CI/CD Pipeline

The project uses GitHub Actions for continuous integration and deployment:

- **`.github/workflows/ci.yml`** - Main CI pipeline
  - Runs on: `push` to main/develop, `pull_request` to main
  - Steps: install → typecheck → lint → test → build → docker build
  - Caches: pnpm dependencies, Docker layers

- **`.github/workflows/cd.yml`** - Continuous deployment
  - Automatic deployment to staging on main branch
  - Manual approval required for production

- **`.github/workflows/infra.yml`** - Infrastructure setup
  - Validates all infrastructure components
  - Optional Docker image builds
  - Generates infrastructure report

- **`.github/workflows/deploy.yml`** - Manual deployment workflow
  - Allows on-demand deployments
  - Environment selection (staging/production)

### 1.2 Docker Setup

#### Dockerfiles

- **`Dockerfile`** - MCP Server production image
  - Base: `node:20-alpine`
  - Multi-stage build (builder + production)
  - Non-root user (security)
  - Health checks enabled
  - Optimized for size and security

- **`Dockerfile.cli`** - CLI tools production image
  - Same base as main Dockerfile
  - Optimized for CLI execution

#### Docker Compose

- **`docker-compose.yml`** - Development/staging compose
  - MCP Server service
  - CLI service (on-demand)
  - Volume: `thinkcoffee_data`

- **`docker-compose.prod.yml`** - Production compose
  - Production-grade configuration
  - Health checks
  - Resource limits
  - Logging configuration

- **`docker-compose.dev.yml`** - Development compose
  - Development dependencies
  - Volume mounts for code
  - Debug ports exposed

- **`docker-compose.monitoring.yml`** - Monitoring stack
  - Prometheus + Grafana
  - Application metrics
  - Service monitoring

### 1.3 Environment Variables

Three environment configuration files:

- **`.env.example`** - Template with all available variables
- **`.env`** - Development environment (created from example)
- **`.env.staging`** - Staging-specific variables
- **`.env.test`** - Test environment variables

Key variables:
```
NODE_ENV=production
THINKCOFFEE_DB_PATH=/data/data.sqlite
THINKCOFFEE_DATA_DIR=/data
MCP_PORT=3000
LOG_LEVEL=info
THINKCOFFEE_SNAPSHOT_RETENTION_DAYS=7
THINKCOFFEE_SNAPSHOT_MAX_SIZE_MB=50
```

### 1.4 Deployment Scripts

Located in `scripts/`:

- **`deploy.sh`** - Main deployment script
  - Usage: `./scripts/deploy.sh [staging|production]`
  - Features: backup, validation, health check, rollback
  - Options: `--skip-backup`, `--health-check-only`

- **`quick-start.sh`** - Development quick start
  - Sets up local environment
  - Starts all containers
  - Shows access URLs

- **`health-check.sh`** - Health check endpoint
  - Verifies service availability
  - Checks database connectivity

- **`backup.sh`** - Backup data
  - Creates volume snapshots
  - Backs up .env files

- **`rollback.sh`** - Rollback deployment
  - Restores from backup
  - Reverts to previous version

- **`setup-infrastructure.js`** - Infrastructure validation
  - Validates prerequisites (Docker, Node, Git)
  - Verifies configuration files
  - Initializes data directories
  - Optional: builds Docker images

## 2. Quick Start

### Local Development

```bash
# 1. Clone repository
git clone https://github.com/thinkcoffee/thinkcoffee.git
cd thinkcoffee

# 2. Setup infrastructure (validates everything)
node scripts/setup-infrastructure.js

# 3. Or use quick start script (builds + starts containers)
chmod +x scripts/quick-start.sh
./scripts/quick-start.sh

# 4. Access MCP Server
curl http://localhost:3000/health
```

### Docker Commands

```bash
# Build images
docker-compose build

# Start containers
docker-compose up -d

# View logs
docker-compose logs -f mcp-server

# Stop containers
docker-compose down

# Clean up volumes
docker-compose down -v
```

## 3. Deployment

### Staging Deployment

```bash
# Automatic (via GitHub Actions)
# Push to develop or main branch

# Manual deployment
chmod +x scripts/deploy.sh
./scripts/deploy.sh staging
```

### Production Deployment

```bash
# Via GitHub Actions
# 1. Create release
# 2. Manual approval required
# 3. Automatic deployment

# Manual deployment (requires DEPLOY_KEY and DEPLOY_HOST)
./scripts/deploy.sh production
```

## 4. CI/CD Pipeline Details

### Test Job
- Install dependencies
- Type check (TypeScript)
- Lint code (ESLint)
- Run unit tests
- Run integration tests

### Build Job (Main branch only)
- Build Docker images
- Tag with commit SHA
- Push to registry

### Deploy Job (Main branch only)
- Environment: production
- Requires manual approval
- Runs deploy script
- Health checks included

## 5. Environment Configuration

### Setting Environment Variables

```bash
# For local development
cp .env.example .env
# Edit .env with your values

# For staging
export $(cat .env.staging | grep -v '^#')

# For production
export $(cat .env | grep -v '^#')
```

### Required Variables

```env
# App
NODE_ENV=production
PORT=3000
API_BASE_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/thinkcoffee

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=24h

# Docker
THINKCOFFEE_DB_PATH=/data/data.sqlite
THINKCOFFEE_DATA_DIR=/data
MCP_PORT=3000
```

## 6. Troubleshooting

### Containers won't start
```bash
# Check logs
docker-compose logs

# Validate compose file
docker-compose config

# Check Docker daemon
docker ps
```

### Health check fails
```bash
# Check service health
curl http://localhost:3000/health

# View container logs
docker-compose logs mcp-server

# Restart containers
docker-compose restart
```

### Database issues
```bash
# Check database connection
docker-compose exec mcp-server npm run db:migrate

# Backup and reset
./scripts/backup.sh
docker-compose down -v
docker-compose up -d
```

## 7. Monitoring

### View Metrics

```bash
# Start monitoring stack
docker-compose -f docker-compose.monitoring.yml up -d

# Access Grafana
open http://localhost:3001

# Access Prometheus
open http://localhost:9090
```

### Health Checks

```bash
# Run health check
./scripts/health-check.sh

# View Docker health status
docker-compose ps
```

## 8. Best Practices

1. **Always backup before deployment**
   ```bash
   ./scripts/backup.sh
   ```

2. **Validate configuration before deployment**
   ```bash
   docker-compose config
   node scripts/setup-infrastructure.js
   ```

3. **Use `.env.example` as template**
   - Never commit actual `.env` files
   - Keep `.env.example` updated

4. **Monitor after deployment**
   ```bash
   docker-compose logs -f
   ```

5. **Test in staging first**
   - Always deploy to staging before production
   - Verify functionality before production release

## 9. Support

For issues or questions:
1. Check logs: `docker-compose logs`
2. Review this guide
3. Check GitHub Issues
4. Create a new issue with logs and reproduction steps

---

**Last updated**: 2026-04-05
**Version**: 6.0
