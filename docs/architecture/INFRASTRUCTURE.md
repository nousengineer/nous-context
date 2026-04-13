# ThinkCoffee - Setup de Infraestrutura

## Visão Geral

Configuração completa de CI/CD, containerização e deployment para o projeto ThinkCoffee.

---

## 1. CI/CD Pipeline (.github/workflows/ci.yml)

### Jobs Configurados

#### Build & Test
- **Trigger**: Push/PR nas branches `main` e `develop`
- **Node.js**: Testes em versões 18.x e 20.x
- **Serviços**: PostgreSQL 15 com health checks
- **Steps**:
  1. Checkout do código
  2. Setup Node.js com cache npm
  3. Instalação de dependências
  4. Linting (continua mesmo em caso de erro)
  5. Build da aplicação
  6. Testes unitários e de integração
  7. Upload de cobertura para Codecov

#### Docker Build
- **Trigger**: Apenas após sucesso do build-and-test, em push na `main`
- **Ações**:
  1. Build multi-stage do Docker
  2. Push para Docker Hub com tags `latest` e `${GITHUB_SHA}`
- **Requisitos**: GitHub Secrets configurados
  - `DOCKER_USERNAME`
  - `DOCKER_PASSWORD`

#### Deploy
- **Trigger**: Após sucesso do docker-build, em push na `main`
- **Ações**:
  1. Deploy via SSH para servidor de produção
  2. Health checks pós-deploy
- **Requisitos**: GitHub Secrets configurados
  - `DEPLOY_KEY` (chave SSH privada)
  - `DEPLOY_HOST`
  - `DEPLOY_USER`

---

## 2. Dockerfile - Multi-stage Build

### Características

- **Stage 1 (Builder)**: Compilação da aplicação
  - Base: Node 20 Alpine (leve)
  - Instala apenas dependências de produção
  - Compila código TypeScript/JavaScript
  - Limpa cache npm

- **Stage 2 (Runtime)**: Imagem final otimizada
  - Base: Node 20 Alpine
  - Cópia de dependências compiladas
  - Usuário não-root (segurança)
  - Health checks integrados
  - Expose porta 3000

### Build Local

```bash
docker build -t thinkcoffee:latest .
```

### Run Local

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@host:5432/db \
  -e NODE_ENV=production \
  thinkcoffee:latest
```

---

## 3. Docker Compose - Ambiente Completo

### Serviços

#### App (Aplicação Principal)
- **Port**: 3000
- **Dependencies**: PostgreSQL e Redis
- **Health Check**: GET /health
- **Hot Reload**: Volume mapping de src/

#### PostgreSQL 15
- **Port**: 5432
- **Dados Persistentes**: `postgres_data/`
- **Health Check**: `pg_isready`

#### Redis 7
- **Port**: 6379
- **Dados Persistentes**: `redis_data/`
- **Auth**: Senha configurável via ENV

#### pgAdmin (Dev Only)
- **Port**: 5050
- **Profile**: `dev`
- Acesso via `docker-compose --profile dev up`

### Uso

#### Desenvolvimento
```bash
# Com services de administração
docker-compose --profile dev up

# Sem services de administração
docker-compose up
```

#### Parar
```bash
docker-compose down
```

#### Logs
```bash
docker-compose logs -f app
```

---

## 4. Variáveis de Ambiente (.env.example)

### Seções Configuradas

#### Application
- `NODE_ENV`: Ambiente (development/production)
- `APP_PORT`: Porta da aplicação
- `APP_URL`: URL base
- `LOG_LEVEL`: Nível de log

#### Database
- `DB_HOST`, `DB_PORT`, `DB_NAME`
- `DB_USER`, `DB_PASSWORD`
- `DATABASE_URL`: String de conexão completa

#### Redis
- `REDIS_HOST`, `REDIS_PORT`
- `REDIS_PASSWORD`

#### Authentication
- `JWT_SECRET`: Chave para assinatura de tokens
- `REFRESH_TOKEN_SECRET`
- Expirações configuráveis

#### Email (SMTP)
- `MAIL_HOST`, `MAIL_PORT`
- `MAIL_USER`, `MAIL_PASSWORD`
- `MAIL_FROM`

#### AWS S3 (Opcional)
- Credenciais AWS
- Bucket e endpoint

#### Stripe (Opcional)
- Chaves pública e secreta
- Webhook secret

#### OAuth (Opcional)
- Google, GitHub client IDs e secrets

#### Deployment
- `DOCKER_USERNAME`, `DEPLOY_HOST`, `DEPLOY_USER`

### Configuração Local

```bash
# Copiar arquivo de exemplo
cp .env.example .env

# Editar com valores específicos do ambiente
nano .env
```

---

## 5. Script de Deploy (scripts/deploy.sh)

### Funções

1. **Pull da imagem Docker**: Baixa a imagem do Docker Hub
2. **Stop do container antigo**: Para o serviço em execução
3. **Backup de config**: Preserva arquivo `.env` anterior
4. **Start do novo container**: Via docker-compose
5. **Verificação de saúde**: Testa endpoint `/health` com retry

### Variáveis Esperadas

```bash
DEPLOY_USER=deploy              # Usuário SSH
DEPLOY_HOST=prod.example.com    # Host de produção
GITHUB_SHA=commit_hash          # Hash do commit (GitHub Actions)
DOCKER_USERNAME=username        # Usuário Docker Hub
```

### Health Check

- Retries: 30 tentativas
- Intervalo: 2 segundos entre tentativas
- Timeout total: até 60 segundos

---

## 6. Configuração de GitHub Secrets

Para que o pipeline funcione, configure os seguintes secrets no repositório:

```
DOCKER_USERNAME      → Usuário Docker Hub
DOCKER_PASSWORD      → Token de acesso Docker Hub
DEPLOY_KEY          → Chave SSH privada (sem passphrase)
DEPLOY_HOST         → IP/DNS do servidor de produção
DEPLOY_USER         → Usuário SSH do servidor
```

### Como Adicionar

1. Ir a `Settings` → `Secrets and variables` → `Actions`
2. Clicar em `New repository secret`
3. Preencherfato nome e valor

---

## 7. Checklist de Setup

- [ ] Copiar `.env.example` para `.env` e configurar
- [ ] Instalador Docker e Docker Compose localmente
- [ ] Executar `docker-compose up` para validar setup
- [ ] Criar conta Docker Hub e gerar token de acesso
- [ ] Gerar chave SSH para deploy sem passphrase
- [ ] Adicionar todos os GitHub Secrets
- [ ] Fazer push para `main` e validar workflow
- [ ] Testar deploy em staging antes de produção

---

## 8. Troubleshooting

### Build falha no Docker

```bash
# Limpar cache Docker
docker-compose down -v
docker system prune -a
docker-compose up --build
```

### Erro de conexão com banco

```bash
# Verificar se PostgreSQL está rodando
docker-compose ps

# Acessar logs do banco
docker-compose logs postgres
```

### Deploy falha com erro SSH

- Validar permissões da chave privada: `chmod 600 deploy_key`
- Testar conexão: `ssh -i deploy_key user@host`
- Validar que `scripts/deploy.sh` tem permissão de execução

### Health check timeout

- Validar que a aplicação expõe endpoint `/health`
- Aumentar `start_period` no Dockerfile se necessário
- Checar logs: `docker-compose logs app`

---

## 9. Arquivos Criados/Modificados

| Arquivo | Descrição |
|---------|-----------|
| `.github/workflows/ci.yml` | Pipeline CI/CD completo |
| `Dockerfile` | Multi-stage build otimizado |
| `docker-compose.yml` | Orquestração de serviços |
| `.env.example` | Template de variáveis |
| `scripts/deploy.sh` | Script de deploy automático |

---

## 10. Recursos Adicionais

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Official Images](https://hub.docker.com/_/node)
- [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
- [PostgreSQL Docker](https://hub.docker.com/_/postgres)
- [Redis Docker](https://hub.docker.com/_/redis)
