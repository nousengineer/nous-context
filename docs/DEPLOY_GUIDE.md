# Guia de Deploy - ThinkCoffee

## Sumario
- [Pre-requisitos](#pre-requisitos)
- [Deploy Local](#deploy-local)
- [Deploy em Producao](#deploy-em-producao)
- [CI/CD Pipeline](#cicd-pipeline)
- [Monitoramento](#monitoramento)
- [Rollback](#rollback)
- [Checklist de Deploy](#checklist-de-deploy)

---

## Pre-requisitos

### Software Necessario
- Docker >= 24.0
- Docker Compose >= 2.20
- Node.js >= 20 (para desenvolvimento)
- pnpm >= 9 (para desenvolvimento)
- Git

### Verificar Instalacao

```bash
docker --version
docker compose version
node --version
pnpm --version
```

### Configurar Ambiente

```bash
# Copiar arquivo de exemplo
cp .env.example .env

# Editar conforme necessario
nano .env
```

---

## Deploy Local

### 1. Build das Imagens

```bash
# Build MCP Server
docker build -t thinkcoffee/mcp-server:local .

# Build CLI
docker build -f Dockerfile.cli -t thinkcoffee/cli:local .
```

### 2. Iniciar Servicos

```bash
# Iniciar apenas MCP Server
docker compose up -d mcp-server

# Verificar status
docker compose ps
docker compose logs -f mcp-server
```

### 3. Verificar Health

```bash
# Health check
curl http://localhost:3000/health

# Ou usar script de monitoramento
./scripts/monitor.sh
```

---

## Deploy em Producao

### 1. Preparacao

```bash
# Fazer backup antes do deploy
./scripts/backup.sh pre-deploy

# Verificar backup criado
ls -la backups/
```

### 2. Deploy Automatizado

```bash
# Deploy para staging
./scripts/deploy.sh staging latest

# Deploy para producao (com tag de versao)
./scripts/deploy.sh production v1.2.0
```

### 3. Deploy Manual

```bash
# Pull da imagem mais recente
docker pull ghcr.io/thinkcoffee/thinkcoffee:latest

# Exportar versao
export THINKCOFFEE_VERSION=latest

# Atualizar servicos
docker compose pull
docker compose up -d --remove-orphans

# Verificar health
curl -f http://localhost:3000/health
```

### 4. Deploy com Monitoramento

Para deploy com stack de monitoramento completa:

```bash
# Iniciar com Prometheus e Grafana
docker compose -f docker-compose.monitoring.yml --profile monitoring up -d

# Acessar:
# - MCP Server: http://localhost:3000
# - Prometheus: http://localhost:9090
# - Grafana: http://localhost:3001 (admin/thinkcoffee)
```

---

## CI/CD Pipeline

### Estrutura dos Workflows

```
.github/workflows/
├── ci.yml    # Lint, test, build em PRs e pushes
└── cd.yml    # Deploy automatizado em tags e branches
```

### CI Pipeline (ci.yml)

Executado em:
- Push para `main` e `develop`
- Pull requests para `main` e `develop`

Jobs:
1. **install** - Instala dependencias
2. **typecheck** - Verifica tipos TypeScript
3. **test** - Executa testes unitarios
4. **build** - Build de todos os pacotes
5. **docker-build** - Build das imagens Docker
6. **security** - Scan de vulnerabilidades

### CD Pipeline (cd.yml)

Triggers:
- Push de tag `v*.*.*` -> Deploy para producao
- Push para `develop` -> Deploy para staging
- Dispatch manual -> Escolher ambiente

Jobs:
1. **setup** - Determina ambiente e versao
2. **build-push** - Build e push para registry
3. **deploy** - Deploy via SSH
4. **verify** - Verificacao pos-deploy
5. **rollback** - Rollback automatico se falhar

### Secrets Necessarios

Configure no GitHub:
- `DEPLOY_HOST` - Hostname do servidor
- `DEPLOY_USER` - Usuario SSH
- `DEPLOY_SSH_KEY` - Chave SSH privada
- `DEPLOY_URL` - URL para health check

---

## Monitoramento

### Script de Monitoramento

```bash
# Verificacao unica
./scripts/monitor.sh

# Modo watch (atualiza a cada 30s)
./scripts/monitor.sh --watch
```

### Metricas Monitoradas

| Metrica | Descricao | Alerta |
|---------|-----------|--------|
| `up` | Servico disponivel | Critico se 0 |
| `thinkcoffee_history_save_total` | Saves de historico | - |
| `thinkcoffee_history_save_errors_total` | Erros ao salvar | Warning se > 0 |
| `thinkcoffee_db_size_bytes` | Tamanho do DB | Warning se > 100MB |
| `process_resident_memory_bytes` | Uso de memoria | Warning se > 500MB |

### Alertas Configurados

Ver `monitoring/alerts.yml`:
- **ThinkCoffeeServiceDown** - Servico fora do ar
- **HighErrorRate** - Taxa de erros alta
- **HistorySaveFailure** - Falha ao salvar historico
- **DiskSpaceCritical** - Disco cheio
- **NoRecentBackup** - Sem backup recente

### Acesso ao Grafana

1. URL: http://localhost:3001
2. Login: admin / thinkcoffee
3. Dashboard: ThinkCoffee - Overview

---

## Rollback

### Rollback Automatico (CI/CD)

Se o deploy falhar, o rollback e executado automaticamente no CD pipeline.

### Rollback Manual

```bash
# Listar backups disponiveis
ls -la backups/

# Rollback para backup especifico
./scripts/rollback.sh backups/20240115_120000

# Ou usar restore.sh para mais controle
./scripts/restore.sh backups/thinkcoffee_pre-deploy_20240115_120000.tar.gz
```

### Rollback de Imagem

```bash
# Voltar para versao anterior da imagem
export THINKCOFFEE_VERSION=v1.1.0
docker compose up -d

# Ou especificar diretamente
docker compose up -d --no-deps mcp-server
```

---

## Checklist de Deploy

### Pre-Deploy
- [ ] Backup criado e verificado
- [ ] Testes passando no CI
- [ ] Code review aprovado
- [ ] Changelog atualizado
- [ ] Versao incrementada

### Deploy
- [ ] Imagem buildada com sucesso
- [ ] Push para registry OK
- [ ] Deploy executado
- [ ] Health check passando

### Pos-Deploy
- [ ] Verificar logs (`docker compose logs -f`)
- [ ] Testar funcionalidades principais
- [ ] Verificar metricas no Grafana
- [ ] Confirmar que historico de chat esta persistindo

### Em Caso de Problema
- [ ] Notificar o time
- [ ] Coletar logs para analise
- [ ] Executar rollback se necessario
- [ ] Documentar o incidente

---

## Comandos Uteis

```bash
# Ver logs em tempo real
docker compose logs -f mcp-server

# Entrar no container
docker compose exec mcp-server sh

# Ver uso de recursos
docker stats thinkcoffee-mcp

# Verificar volume
docker volume inspect thinkcoffee_data

# Limpar sistema Docker
docker system prune -f

# Rebuild forcado (sem cache)
docker compose build --no-cache
```

---

## Variaveis de Ambiente

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `NODE_ENV` | production | Ambiente de execucao |
| `THINKCOFFEE_VERSION` | latest | Versao da imagem |
| `MCP_PORT` | 3000 | Porta do servidor |
| `LOG_LEVEL` | info | Nivel de log |
| `THINKCOFFEE_SNAPSHOT_RETENTION_DAYS` | 7 | Retencao de snapshots |
| `BACKUP_RETENTION_DAYS` | 30 | Retencao de backups |

Ver `.env.example` para lista completa.

---

*Documento atualizado em: 2024*
*Versao: 1.0*
