# Setup Infrastructure - Guia Completo de Configuração

## Objetivo
Configurar o pipeline CI/CD, containerização Docker, variáveis de ambiente e scripts de deployment para o projeto ThinkCoffee.

---

## 1. CI/CD Pipeline (.github/workflows/ci.yml)

### Overview
Pipeline automatizado que valida qualidade, testa, constrói Docker images e faz deploy.

### Jobs Configurados

#### 1.1 Quality (Code Quality)
- **Trigger**: Em todo push e PR
- **Ações**:
  - ESLint para validação de código
  - TypeScript type-checking
  - Continua mesmo em caso de erro (warning, não fail)
- **Duração**: ~2-3 minutos

#### 1.2 Build & Test
- **Trigger**: Após sucesso do job `quality`
- **Matrix**: Testa em Node 18.x e 20.x
- **Serviços** (containers):
  - PostgreSQL 15 Alpine com health check
  - Redis 7 Alpine com health check
- **Ações**:
  1. Checkout do code
  2. Setup Node.js com cache npm
  3. Install dependências
  4. Build da aplicação
  5. Run testes unitários com coverage
  6. Run testes de integração
  7. Upload coverage para Codecov
- **Duração**: ~5-8 minutos por versão de Node
- **Env vars**:
  - `DATABASE_URL`: postgres://thinkcoffee_user:testpass123@localhost:5432/thinkcoffee_test
  - `NODE_ENV`: test

#### 1.3 Docker Build & Push
- **Trigger**: Apenas em `push` na branch `main` após build-and-test
- **Actions**:
  1. Login no Docker Hub (se credenciais configuradas)
  2. Login no GitHub Container Registry (ghcr.io)
  3. Build e push multi-stage da imagem Docker
  4. Tag com `latest` e `{github.sha}`
  5. Cache de build layer (buildcache)
- **Output**: Imagem disponível em:
  - `ghcr.io/[org]/[repo]:latest`
  - `ghcr.io/[org]/[repo]:[commit-sha]`
- **Duração**: ~3-5 minutos
- **GitHub Secrets necessários**:
  - `DOCKER_USERNAME` (opcional, para Docker Hub)
  - `DOCKER_PASSWORD` (opcional, para Docker Hub)

#### 1.4 Security Scan
- **Trigger**: Em paralelo com build-and-test
- **Ações**:
  1. `npm audit` - vulnerabilidades npm
  2. Trivy - scan de filesystem
  3. Upload para GitHub Security tab
- **Duração**: ~2-4 minutos
- **Nota**: Erros não bloqueiam pipeline

#### 1.5 Deploy
- **Trigger**: Apenas em `push` na branch `main` após docker-build
- **Environment**: production (com aprovação manual no GitHub)
- **Ações**:
  1. Setup SSH keys
  2. Execute pre-deploy checks
  3. Deploy via script `scripts/deploy.sh`
  4. Verify health checks
  5. Slack notification (optional)
- **Duração**: ~5-15 minutos
- **GitHub Secrets necessários**:
  - `DEPLOY_KEY` (SSH private key)
  - `DEPLOY_HOST` (production.thinkcoffee.com)
  - `DEPLOY_USER` (deploy user)
  - `SLACK_WEBHOOK` (optional)

---

## 2. Docker Setup

### 2.1 Dockerfile (Multi-stage Build)

```
Stage 1 (Builder)          Stage 2 (Runtime)
├─ Node 20 Alpine          ├─ Node 20 Alpine
├─ npm ci                  ├─ curl para health checks
├─ npm run build           ├─ Non-root user (nodejs:1001)
└─ Cleanup cache           ├─ EXPOSE 3000
                           ├─ HEALTHCHECK
                           └─ CMD node dist/main.js
```

**Features**:
- Multi-stage para otimizar tamanho final (Alpine ~150MB vs Node Debian ~900MB)
- Non-root user para security
- Health check integrado
- Cache optimization via layers

### 2.2 docker-compose.yml

Serviços orquestrados:

| Serviço | Image | Port | Volumes | Health Check |
|---------|-------|------|---------|--------------|
| app | Node 20 Alpine | 3000 | src/, public/ | GET /health:3000 |
| postgres | postgres:15-alpine | 5432 | postgres_data/ | pg_isready |
| redis | redis:7-alpine | 6379 | redis_data/ | redis-cli ping |
| pgadmin | pgadmin4 | 5050 | none | (dev only) |

**Redes**: `thinkcoffee-network` (bridge)

**Volumes Persistentes**:
- `postgres_data/`: dados do banco
- `redis_data/`: dados do cache

### 2.3 Variáveis de Ambiente

Ver seção 3 abaixo.

---

## 3. Environment Variables (.env.example)

Todas as variáveis necessárias:

### Application Core
```env
NODE_ENV=development|staging|production
APP_NAME=thinkcoffee
APP_PORT=3000
APP_URL=http://localhost:3000
LOG_LEVEL=debug|info|warn|error
DEBUG=thinkcoffee:*
```

### Database (PostgreSQL)
```env
DB_HOST=postgres
DB_PORT=5432
DB_NAME=thinkcoffee
DB_USER=thinkcoffee_user
DB_PASSWORD=secure_password_here
DATABASE_URL=postgres://user:pass@host:5432/db
DB_POOL_MIN=2
DB_POOL_MAX=10
```

### Cache (Redis)
```env
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=redis_password
REDIS_DB=0
REDIS_URL=redis://:password@redis:6379/0
```

### Authentication
```env
JWT_SECRET=long_random_string_min_32_chars
JWT_EXPIRES_IN=7d
REFRESH_TOKEN_SECRET=long_random_string
REFRESH_TOKEN_EXPIRES_IN=30d
SESSION_SECRET=another_random_string
```

### Email (SMTP)
```env
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=email@gmail.com
MAIL_PASSWORD=app_password
MAIL_FROM=noreply@company.com
```

### OAuth Providers (Optional)
```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

### Payment (Stripe - Optional)
```env
STRIPE_PUBLIC_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Cloud Storage (AWS S3 - Optional)
```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=bucket-name
```

### Monitoring (Optional)
```env
SENTRY_DSN=https://...
SENTRY_ENVIRONMENT=development
MIXPANEL_TOKEN=...
```

### Deployment
```env
DOCKER_REGISTRY=ghcr.io
DOCKER_USERNAME=...
DEPLOY_HOST=production.com
DEPLOY_USER=deploy
DEPLOY_KEY_PATH=~/.ssh/deploy_key
```

---

## 4. Deployment Scripts

### 4.1 scripts/deploy.sh

**Propósito**: Automated production deployment

**Pré-requisitos**:
- SSH key configurada em ~/.ssh/deploy_key
- acesso SSH ao servidor production
- Docker e docker-compose instalados no servidor

**Fluxo** (7 passos):
1. **Validate Prerequisites**: Verifica SSH, Docker, paths
2. **Pull Docker Image**: Baixa imagem do registry
3. **Backup Configuration**: Salva .env e docker-compose.yml
4. **Stop Containers**: Para containers atuais com timeout
5. **Start Deployment**: Inicia novos containers
6. **Verify Health**: Checa HTTP 200 em /health endpoint
7. **Cleanup**: Remove backups antigos (>30 dias)

**Features**:
- Retry automático em health checks (30 tentativas, 2s intervalo)
- Rollback automático se health check falhar
- Backup automático pre-deploy
- Colored output para legibilidade
- Tratamento robusto de erros

**Uso**:
```bash
export DEPLOY_USER=deploy
export DEPLOY_HOST=production.thinkcoffee.com
export DOCKER_IMAGE=ghcr.io/org/thinkcoffee:v1.0.0
bash scripts/deploy.sh
```

### 4.2 scripts/health-check.sh

**Propósito**: Validar health da aplicação após deploy

**Checks**:
- HTTP GET /health -> 200 OK
- Database connectivity
- Redis connectivity

### 4.3 scripts/pre-deploy-checklist.sh

**Propósito**: Validações pré-deployment

**Checks**:
- Disk space
- Memory available
- Backup directory writable
- .env file present
- Docker resources

---

## 5. GitHub Secrets Setup

Para fazer deploy funcionar, configure os seguintes secrets no GitHub:

### Via GitHub UI:
1. Go to repo Settings → Secrets and variables → Actions
2. Click "New repository secret"

### Secrets necessários:

| Secret | Value | Example |
|--------|-------|---------|
| DEPLOY_KEY | SSH private key (RSA) | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| DEPLOY_HOST | Hostname do servidor | `production.thinkcoffee.com` |
| DEPLOY_USER | SSH user | `deploy` |
| DOCKER_USERNAME | (opcional) Docker Hub user | `your_username` |
| DOCKER_PASSWORD | (opcional) Docker Hub token | `dckr_pat_...` |
| SLACK_WEBHOOK | (opcional) Slack webhook URL | `https://hooks.slack.com/...` |

### Como gerar SSH key:
```bash
ssh-keygen -t rsa -b 4096 -f deploy_key -N ""
# Adicionar deploy_key.pub ao ~/.ssh/authorized_keys do servidor
# Adicionar conteúdo de deploy_key como DEPLOY_KEY secret
```

---

## 6. Local Development Setup

### 6.1 Install & Run
```bash
# Install dependencies
npm ci

# Start dev environment
docker-compose up -d

# Run app
npm run dev

# View logs
docker-compose logs -f app
```

### 6.2 Database Setup
```bash
# Run migrations
npm run migrate

# Seed data (optional)
npm run seed
```

### 6.3 Enviroment File
```bash
# Copy example
cp .env.example .env

# Edit with local values
nano .env
```

### 6.4 Access Services
- App: http://localhost:3000
- PostgreSQL: localhost:5432
- Redis: localhost:6379
- pgAdmin: http://localhost:5050

---

## 7. Troubleshooting

### Pipeline Issues

#### Build fails
- Verificar `npm ci` output
- Verificar se package.json é válido
- Verificar dependências com `npm audit`

#### Docker build fails
- Verificar Dockerfile syntax
- Verificar se todos COPY paths existem
- Verificar espaço em disco no runner

#### Deploy fails
- Verificar SSH key configuration
- Verificar DEPLOY_HOST/DEPLOY_USER
- Verificar disk space no servidor: `ssh user@host df -h`
- Verificar Docker no servidor: `ssh user@host docker ps`

#### Health check fails
- Verificar se app está rodando: `docker ps`
- Verificar logs: `docker logs container_id`
- Verificar /health endpoint: `curl http://localhost:3000/health`
- Aumentar RETRY_ATTEMPTS em deploy.sh

### Docker Issues

#### Container won't start
```bash
docker logs thinkcoffee-app
docker inspect thinkcoffee-app
```

#### Port already in use
```bash
# Find process
lsof -i :3000

# Stop containers
docker-compose down
```

#### Permission denied
```bash
# Fix volumes
sudo chown -R $USER:$USER postgres_data redis_data
sudo chmod 755 postgres_data redis_data
```

---

## 8. Monitoring & Maintenance

### Pre-deployment Health
```bash
# Test health endpoint
curl -v http://localhost:3000/health

# Check database
psql -U user -h localhost -d db -c "SELECT 1"

# Check Redis
redis-cli -h localhost ping
```

### Post-deployment Verification
```bash
# Verify on production
ssh deploy@host "curl http://localhost:3000/health"

# Check container logs
ssh deploy@host "docker logs thinkcoffee-app | tail -50"

# Monitor performance
ssh deploy@host "docker stats"
```

### Backup Management
```bash
# List backups
ls -la /opt/thinkcoffee/backups/

# Manual backup
cd /opt/thinkcoffee && cp -r . backups/manual_$(date +%s)/

# Restore from backup
cp backups/backup_time/.env .env
docker-compose up -d
```

---

## 9. Best Practices

### Security
- ✅ Use non-root user in Docker
- ✅ Store secrets in GitHub Secrets, not in .env.example
- ✅ Rotate JWT secrets regularly
- ✅ Use strong passwords (min 16 chars)
- ✅ Enable SSH key-only auth (no password)
- ✅ Use HTTPS in production
- ✅ Run security scans (npm audit, Trivy)

### CI/CD
- ✅ Test on multiple Node versions
- ✅ Run linting and type checks
- ✅ Upload test coverage
- ✅ Tag Docker images with commit SHA
- ✅ Use environment-specific configs
- ✅ Implement health checks
- ✅ Auto-rollback on failure

### Deployment
- ✅ Backup before deploy
- ✅ Use blue-green or canary deployments
- ✅ Implement gradual rollouts
- ✅ Monitor error rates post-deploy
- ✅ Have runbook for incidents
- ✅ Test rollback procedure

### Docker
- ✅ Use Alpine images (smaller, faster)
- ✅ Multi-stage builds (smaller final image)
- ✅ Health checks
- ✅ Non-root users
- ✅ Limit resources
- ✅ Use .dockerignore

---

## 10. Referências

- GitHub Actions: https://docs.github.com/actions
- Docker: https://docs.docker.com
- docker-compose: https://docs.docker.com/compose
- Node.js best practices: https://nodejs.org/docs

---

## Checklist de Conclusão

- [ ] .github/workflows/ci.yml criado e funcionando
- [ ] scripts/deploy.sh criado com todos os passos
- [ ] .env.example com todas as variáveis
- [ ] GitHub Secrets configurados (DEPLOY_KEY, DEPLOY_HOST, etc)
- [ ] Docker images buildando com sucesso
- [ ] Health checks funcionando
- [ ] Deploy funcionando em staging
- [ ] Deploy funcionando em production
- [ ] Rollback testado
- [ ] Team treinado no processo
