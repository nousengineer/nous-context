# Production Deployment Guide

## Overview

This guide covers deploying ThinkCoffee to production using Docker, Kubernetes, and CI/CD automation.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Users / API Clients                         │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│         Nginx (Reverse Proxy + Load Balancer)           │
│    - SSL/TLS termination                                │
│    - Rate limiting                                       │
│    - Request routing                                     │
└─────────────────────────────────────────────────────────┘
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
    ┌────────┐    ┌────────┐    ┌────────┐
    │  API 1 │    │  API 2 │    │  API N │
    │(Node)  │    │(Node)  │    │(Node)  │
    └────────┘    └────────┘    └────────┘
         │              │              │
         └──────────────┼──────────────┘
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
    ┌──────────┐  ┌──────────┐  ┌────────────┐
    │PostgreSQL│  │  Redis   │  │ S3 Storage │
    └──────────┘  └──────────┘  └────────────┘
```

## Prerequisites

- Docker and Docker Compose
- Kubernetes cluster (optional, for K8s deployment)
- GitHub Actions configured
- SSL/TLS certificates
- Environment variables configured

## Option 1: Docker Compose Deployment

### 1. Prepare Environment

```bash
# Copy and configure environment file
cp .env.example .env.production

# Edit with production values
nano .env.production
```

Set these variables:
```bash
DB_PASSWORD=your-strong-password
REDIS_PASSWORD=your-redis-password
JWT_SECRET=your-jwt-secret-key
ANTHROPIC_API_KEY=your-api-key
```

### 2. Deploy

```bash
# Build images
docker-compose -f docker-compose.prod.yml build

# Start services
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f api

# Run migrations
docker-compose -f docker-compose.prod.yml exec api \
  npm run migrate:prod
```

### 3. Verify Deployment

```bash
# Health check
curl https://api.thinkcoffee.dev/health

# API test
curl -X GET https://api.thinkcoffee.dev/api/agents \
  -H "Authorization: Bearer YOUR_TOKEN"

# Database check
docker-compose -f docker-compose.prod.yml exec postgres \
  psql -U thinkcoffee -d thinkcoffee -c "SELECT version();"
```

### 4. Monitor

```bash
# View real-time logs
docker-compose -f docker-compose.prod.yml logs -f

# Monitor resource usage
docker stats

# Access monitoring dashboards
# Prometheus: http://localhost:9090
# Grafana: http://localhost:3100 (admin/admin)
```

## Option 2: Kubernetes Deployment

### 1. Create Kubernetes Resources

```bash
# Create namespace
kubectl create namespace thinkcoffee

# Create ConfigMaps
kubectl create configmap thinkcoffee-config \
  --from-file=.env.production \
  -n thinkcoffee

# Create secrets
kubectl create secret generic thinkcoffee-secrets \
  --from-literal=db-password=your-password \
  --from-literal=jwt-secret=your-secret \
  -n thinkcoffee
```

### 2. Deploy Services

```bash
# Apply manifests
kubectl apply -f k8s/namespace.yml
kubectl apply -f k8s/postgres.yml
kubectl apply -f k8s/redis.yml
kubectl apply -f k8s/api.yml
kubectl apply -f k8s/nginx.yml

# Verify deployment
kubectl get pods -n thinkcoffee
kubectl get services -n thinkcoffee
```

### 3. Scale Services

```bash
# Scale API replicas
kubectl scale deployment api --replicas=3 -n thinkcoffee

# Check scaling status
kubectl get deployment api -n thinkcoffee
kubectl get pods -n thinkcoffee -l app=api
```

### 4. Monitor Kubernetes

```bash
# Get cluster info
kubectl cluster-info

# View resource usage
kubectl top nodes
kubectl top pods -n thinkcoffee

# View logs
kubectl logs -f deployment/api -n thinkcoffee

# Describe pod (troubleshooting)
kubectl describe pod <pod-name> -n thinkcoffee
```

## CI/CD Pipeline

### GitHub Actions Workflow

The pipeline runs automatically on push/PR:

1. **Test Phase**: Lint, type-check, test all packages
2. **Security Phase**: Vulnerability scanning, secret detection
3. **Build Phase**: Docker image build and push
4. **Deploy Staging**: Deploy to staging environment
5. **Deploy Production**: Deploy to production (main branch only)

### Manual Deployment

```bash
# Trigger deployment via GitHub CLI
gh workflow run ci-cd.yml --ref main

# Check workflow status
gh run list --workflow ci-cd.yml

# View workflow logs
gh run view <run-id> --log
```

## Backup & Recovery

### Database Backup

```bash
# Backup PostgreSQL
docker-compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U thinkcoffee thinkcoffee > backup.sql

# Restore from backup
docker-compose -f docker-compose.prod.yml exec postgres \
  psql -U thinkcoffee thinkcoffee < backup.sql

# Schedule automated backups (cron)
0 2 * * * docker-compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U thinkcoffee thinkcoffee > backups/db-$(date +\%Y\%m\%d).sql
```

### Redis Backup

```bash
# Create snapshot
docker-compose -f docker-compose.prod.yml exec redis \
  redis-cli BGSAVE

# Extract dump
docker cp thinkcoffee-cache:/data/dump.rdb ./redis-backup.rdb
```

### Rollback Procedure

```bash
# Stop current deployment
docker-compose -f docker-compose.prod.yml down

# Revert to previous image tag
docker tag thinkcoffee:v1.1.0 thinkcoffee:latest

# Restart with previous version
docker-compose -f docker-compose.prod.yml up -d
```

## Security Hardening

### Enable SSL/TLS

```bash
# Generate self-signed certificate (testing only)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/key.pem -out certs/cert.pem

# Use Let's Encrypt (production)
docker run -it --rm -v $(pwd)/certs:/etc/letsencrypt \
  certbot/certbot certonly --standalone \
  -d api.thinkcoffee.dev --email admin@thinkcoffee.dev
```

### Configure Firewall

```bash
# Allow only necessary ports
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw enable
```

### Environment Security

```bash
# Use strong passwords (minimum 32 characters)
openssl rand -base64 32

# Rotate secrets regularly
# Store secrets in AWS Secrets Manager / Azure Key Vault

# Enable audit logging
export LOG_LEVEL=debug

# Monitor access logs
tail -f logs/access.log
```

## Performance Optimization

### Database Optimization

```bash
# Create indexes
docker-compose -f docker-compose.prod.yml exec postgres \
  psql -U thinkcoffee -d thinkcoffee -f scripts/indexes.sql

# Analyze query performance
EXPLAIN ANALYZE SELECT * FROM agents WHERE id = 1;
```

### Caching Strategy

```bash
# Clear cache
docker-compose -f docker-compose.prod.yml exec redis \
  redis-cli FLUSHALL

# Monitor cache hits
docker-compose -f docker-compose.prod.yml exec redis \
  redis-cli INFO stats
```

### Load Testing

```bash
# Install load testing tool
npm install -g autocannon

# Run load test
autocannon -c 100 -d 30 https://api.thinkcoffee.dev/health
```

## Monitoring & Alerting

### Health Checks

```bash
# API health
curl -i https://api.thinkcoffee.dev/health

# Database health
docker-compose -f docker-compose.prod.yml exec postgres \
  pg_isready -U thinkcoffee

# Cache health
docker-compose -f docker-compose.prod.yml exec redis \
  redis-cli ping
```

### Log Aggregation

```bash
# Forward logs to centralized service
# Configure log drivers in docker-compose.prod.yml
# Example: awslogs, splunk, datadog
```

### Metrics Collection

```bash
# Prometheus scrapes metrics from /metrics endpoint
# Access at http://prometheus:9090
# Grafana visualizes at http://grafana:3100
```

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| 502 Bad Gateway | Check API service health, check logs |
| Database connection failed | Verify credentials, check PostgreSQL status |
| Redis connection failed | Check Redis password, verify network |
| SSL certificate error | Verify certificate path, check expiration |
| High memory usage | Check for memory leaks, scale pods |
| Slow API responses | Check database indices, analyze queries |

### Debug Commands

```bash
# Check container status
docker-compose -f docker-compose.prod.yml ps

# View container logs
docker-compose -f docker-compose.prod.yml logs <service>

# Execute command in container
docker-compose -f docker-compose.prod.yml exec api npm run migrate

# Check network connectivity
docker-compose -f docker-compose.prod.yml exec api \
  curl http://postgres:5432

# Review environment variables
docker-compose -f docker-compose.prod.yml config
```

## Maintenance

### Regular Tasks

- **Daily**: Monitor logs, check health endpoints
- **Weekly**: Review metrics, test backups
- **Monthly**: Update dependencies, review security logs
- **Quarterly**: Full disaster recovery test, performance audit

### Updates & Patches

```bash
# Update base images
docker-compose -f docker-compose.prod.yml pull

# Rebuild with new images
docker-compose -f docker-compose.prod.yml build --no-cache

# Restart services
docker-compose -f docker-compose.prod.yml up -d
```

## Checklist

- [ ] Environment variables configured
- [ ] SSL/TLS certificates installed
- [ ] Database backups enabled
- [ ] Monitoring dashboards configured
- [ ] Log aggregation enabled
- [ ] Firewall rules configured
- [ ] Rate limiting enabled
- [ ] Security headers enabled
- [ ] Health checks passing
- [ ] Performance benchmarks met
- [ ] Documentation updated
- [ ] Team trained on runbooks

## Support

For deployment issues:
1. Check logs: `docker-compose logs -f`
2. Verify health: `curl /health`
3. Review monitoring dashboards
4. Consult troubleshooting section
5. Contact DevOps team

---

**Last Updated**: April 19, 2026  
**Version**: 1.0.0  
**Status**: Production Ready ✅
