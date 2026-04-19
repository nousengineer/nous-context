# Production Deployment Checklist

**Date**: ___________  
**Version**: ___________  
**Deployed By**: ___________  
**Approval**: ___________  

## Pre-Deployment Review (48 hours before)

### Code Quality
- [ ] All tests passing (unit, integration, e2e)
- [ ] No critical security vulnerabilities
- [ ] Code review approved by 2+ team members
- [ ] No outstanding bugs or issues
- [ ] Linting passes without warnings
- [ ] TypeScript strict mode passes
- [ ] Bundle size within acceptable limits
- [ ] Performance benchmarks met

### Documentation
- [ ] CHANGELOG updated with new features
- [ ] API documentation current
- [ ] Deployment runbook reviewed
- [ ] Emergency procedures documented
- [ ] Team trained on changes
- [ ] Release notes prepared
- [ ] Architecture diagrams updated (if applicable)

### Dependencies
- [ ] All dependencies pinned to exact versions
- [ ] No deprecated packages in use
- [ ] Security advisories reviewed
- [ ] License compliance verified

## Infrastructure Preparation (24 hours before)

### Database
- [ ] Database migration script tested on staging
- [ ] Backup created and verified
- [ ] Rollback procedure tested
- [ ] Connection pools sized appropriately
- [ ] Indexes optimized
- [ ] Query performance verified

### Monitoring & Alerting
- [ ] Prometheus scrape targets configured
- [ ] Grafana dashboards ready
- [ ] Alert thresholds set appropriately
- [ ] Log aggregation enabled
- [ ] Error tracking (Sentry) configured
- [ ] APM (Datadog/New Relic) ready

### Security
- [ ] SSL/TLS certificates valid and installed
- [ ] Firewall rules configured
- [ ] Rate limiting enabled
- [ ] Security headers configured
- [ ] CORS settings correct
- [ ] Secrets encrypted and rotated
- [ ] SSH keys updated
- [ ] Admin access restricted

### Capacity
- [ ] Load testing completed
- [ ] Server resources adequate
- [ ] Database connection pool sized
- [ ] Redis memory available
- [ ] Disk space sufficient (20%+ free)
- [ ] Network bandwidth adequate
- [ ] CDN configured (if applicable)

## Deployment Day (Pre-Deployment)

### Final Checks (2 hours before)
- [ ] Production environment stable
- [ ] All services healthy
- [ ] Database responsive
- [ ] No ongoing incidents
- [ ] Team available for monitoring
- [ ] Communication channel open (Slack/Discord)
- [ ] Rollback plan confirmed
- [ ] Maintenance window scheduled (if needed)

### Notification
- [ ] Users notified of deployment
- [ ] Maintenance window communicated
- [ ] Support team briefed
- [ ] On-call schedule verified
- [ ] Incident response team ready

## Deployment Execution

### Docker Build & Push
- [ ] Docker images built successfully
- [ ] Images scanned for vulnerabilities
- [ ] Images pushed to registry
- [ ] Image tags correct and documented

### Deployment
- [ ] Environment variables loaded
- [ ] Configuration validated
- [ ] Database migrations executed successfully
- [ ] Services started in correct order
- [ ] Service health checks passing
- [ ] API responding to requests
- [ ] Database queries working
- [ ] Cache functioning properly

### Verification (30 minutes after start)

#### Health Checks
- [ ] `/health` endpoint returns 200
- [ ] API responding within SLA
- [ ] Database latency normal
- [ ] Cache hit rate > 80%
- [ ] No 500 errors in logs
- [ ] No critical errors in monitoring

#### Functional Tests
- [ ] Authentication working
- [ ] User can create agents
- [ ] User can run tasks
- [ ] WebSocket connections stable
- [ ] File uploads functioning
- [ ] Workflow execution working
- [ ] Security analysis operational

#### Performance Tests
- [ ] API response time < 500ms (P95)
- [ ] Database query time < 100ms (P95)
- [ ] Error rate < 0.1%
- [ ] Memory usage stable
- [ ] CPU usage < 70%
- [ ] Network I/O normal

#### Integration Tests
- [ ] Third-party API connections working
- [ ] Email notifications sending
- [ ] Webhooks triggering
- [ ] External services responding

### Monitoring

#### Immediate (First hour)
- [ ] Monitor error rates
- [ ] Watch for memory leaks
- [ ] Check database connection pool
- [ ] Monitor cache performance
- [ ] Review application logs
- [ ] Monitor user activity
- [ ] Watch for anomalies

#### Short-term (First 24 hours)
- [ ] Error rate stable and low
- [ ] Performance metrics within range
- [ ] No customer complaints
- [ ] Resource usage stable
- [ ] Security logs normal
- [ ] Backup jobs completed

## Post-Deployment

### Immediate Follow-up (Within 1 hour)
- [ ] All health checks passing
- [ ] No critical issues
- [ ] Performance acceptable
- [ ] Team debriefed
- [ ] Incidents documented
- [ ] Success communicated to stakeholders

### Day 1 Review
- [ ] Monitor for unexpected behavior
- [ ] Review metrics and logs
- [ ] User feedback collected
- [ ] Any issues logged as tickets
- [ ] Performance baseline established
- [ ] Lessons learned documented

### Week 1 Review
- [ ] No late-appearing issues
- [ ] Performance stable
- [ ] Security posture maintained
- [ ] User adoption metrics good
- [ ] Feature working as expected
- [ ] Documentation updated based on learnings

## Rollback Procedure

### When to Rollback
- [ ] Critical functionality broken
- [ ] Data corruption detected
- [ ] Security breach confirmed
- [ ] Performance SLA consistently violated
- [ ] Cannot be fixed within 30 minutes

### Rollback Steps
1. [ ] Alert team immediately
2. [ ] Stop accepting new requests
3. [ ] Drain in-flight requests (30s timeout)
4. [ ] Verify backup integrity
5. [ ] Revert to previous version
6. [ ] Verify all services healthy
7. [ ] Resume traffic
8. [ ] Communicate status
9. [ ] Document incident
10. [ ] Conduct post-mortem

### Rollback Verification
- [ ] All services operational
- [ ] Database still consistent
- [ ] No data loss
- [ ] Users can access system
- [ ] Previous functionality restored

## Communication

### Before Deployment
- [ ] Email: All stakeholders
- [ ] Slack: Development channel
- [ ] Update: Status page
- [ ] Docs: Release notes published

### During Deployment
- [ ] Slack: Real-time updates
- [ ] Status Page: Maintenance mode
- [ ] Monitoring: Alerts active

### After Deployment
- [ ] Slack: Deployment complete
- [ ] Status Page: All clear
- [ ] Email: Success notification
- [ ] Docs: Version updated

## Sign-off

### Deployment Lead
**Name**: _________________________ **Time**: _________
**Signature**: _____________________ **Date**: _________

### Technical Review
**Name**: _________________________ **Time**: _________
**Signature**: _____________________ **Date**: _________

### Product Owner
**Name**: _________________________ **Time**: _________
**Signature**: _____________________ **Date**: _________

### Operations Lead
**Name**: _________________________ **Time**: _________
**Signature**: _____________________ **Date**: _________

## Incident Report (if applicable)

**Issue**: ________________________________________________________________
**Severity**: [ ] Critical [ ] High [ ] Medium [ ] Low
**Impact**: ________________________________________________________________
**Resolution**: ____________________________________________________________
**Time to Resolution**: _________________
**Root Cause**: ____________________________________________________________
**Prevention**: ____________________________________________________________

---

**Deployment Status**: [ ] ✅ SUCCESSFUL [ ] ⚠️ PARTIAL [ ] ❌ ROLLED BACK

**Notes**: ________________________________________________________________
________________________________________________________________________
________________________________________________________________________

**Lessons Learned**: _______________________________________________________
________________________________________________________________________
________________________________________________________________________
