# Monitoramento e Alertas - ThinkCoffee

## Sumario
- [Visao Geral](#visao-geral)
- [Stack de Monitoramento](#stack-de-monitoramento)
- [Health Checks](#health-checks)
- [Metricas](#metricas)
- [Alertas](#alertas)
- [Dashboards](#dashboards)
- [Prevencao de Perda de Dados](#prevencao-de-perda-de-dados)
- [Runbook de Incidentes](#runbook-de-incidentes)

---

## Visao Geral

O sistema de monitoramento do ThinkCoffee foi projetado para:
1. Detectar problemas antes que causem perda de dados
2. Alertar sobre falhas de persistencia do historico
3. Monitorar uso de recursos (memoria, disco)
4. Facilitar troubleshooting rapido

---

## Stack de Monitoramento

### Componentes

| Componente | Funcao | Porta |
|------------|--------|-------|
| MCP Server | Expoe metricas | 3000 |
| Prometheus | Coleta e armazena metricas | 9090 |
| Grafana | Visualizacao e dashboards | 3001 |
| Alertmanager | Gerencia alertas | 9093 |

### Iniciar Stack Completa

```bash
# Iniciar com profile de monitoramento
docker compose -f docker-compose.monitoring.yml --profile monitoring up -d

# Verificar status
docker compose -f docker-compose.monitoring.yml ps
```

### Arquivos de Configuracao

```
monitoring/
├── prometheus.yml              # Config do Prometheus
├── alerts.yml                  # Regras de alerta
├── alertmanager.yml            # Config do Alertmanager
└── grafana/
    ├── provisioning/
    │   ├── datasources/        # Datasources automaticos
    │   └── dashboards/         # Dashboards automaticos
    └── dashboards/
        └── thinkcoffee-overview.json
```

---

## Health Checks

### Endpoint de Health

O MCP Server expoe um endpoint de saude:

```bash
curl http://localhost:3000/health
```

Resposta esperada:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T12:00:00Z",
  "checks": {
    "database": "ok",
    "volume": "ok"
  }
}
```

### Health Check do Docker

O container inclui health check automatico que verifica:
- Acesso de escrita no `/data`
- Acesso aos diretorios `/data/snapshots` e `/data/logs`

Verificar status:
```bash
docker inspect --format='{{.State.Health.Status}}' thinkcoffee-mcp
```

### Script de Monitoramento Local

```bash
# Verificacao completa
./scripts/monitor.sh

# Modo watch (atualiza a cada 30s)
./scripts/monitor.sh --watch
```

O script verifica:
- Status do container
- Endpoint de health
- Volume Docker
- Integridade dos dados
- Espaco em disco
- Backups recentes
- Logs recentes

---

## Metricas

### Metricas do Historico de Chat

| Metrica | Tipo | Descricao |
|---------|------|-----------|
| `thinkcoffee_history_save_total` | Counter | Total de saves de historico |
| `thinkcoffee_history_save_errors_total` | Counter | Total de erros ao salvar |
| `thinkcoffee_history_load_total` | Counter | Total de loads de historico |
| `thinkcoffee_history_size_bytes` | Gauge | Tamanho do historico em bytes |

### Metricas do Banco de Dados

| Metrica | Tipo | Descricao |
|---------|------|-----------|
| `thinkcoffee_db_size_bytes` | Gauge | Tamanho do SQLite |
| `thinkcoffee_db_queries_total` | Counter | Total de queries |
| `thinkcoffee_db_query_duration_seconds` | Histogram | Duracao das queries |

### Metricas do Sistema

| Metrica | Tipo | Descricao |
|---------|------|-----------|
| `process_resident_memory_bytes` | Gauge | Memoria RSS |
| `process_cpu_seconds_total` | Counter | CPU usada |
| `nodejs_eventloop_lag_seconds` | Gauge | Lag do event loop |

### Consultar Metricas

Via Prometheus:
```
http://localhost:9090/graph
```

Query de exemplo:
```promql
# Taxa de erros de save por minuto
rate(thinkcoffee_history_save_errors_total[5m]) * 60
```

---

## Alertas

### Alertas Criticos

| Alerta | Condicao | Acao |
|--------|----------|------|
| **ThinkCoffeeServiceDown** | Servico fora por >1min | Verificar container, reiniciar |
| **VolumeWriteError** | Erro de escrita no volume | Verificar disco, permissoes |
| **DiskSpaceCritical** | Disco <10% livre | Limpar espaco, expandir disco |

### Alertas de Warning

| Alerta | Condicao | Acao |
|--------|----------|------|
| **HistorySaveFailure** | Falhas ao salvar historico | Verificar logs, volume |
| **HighMemoryUsage** | Memoria >500MB por 10min | Investigar leak, reiniciar |
| **DiskSpaceWarning** | Disco <20% livre | Planejar limpeza |
| **NoRecentBackup** | Sem backup em 48h | Executar backup manual |

### Configurar Notificacoes

Edite `monitoring/alertmanager.yml`:

```yaml
receivers:
  - name: 'critical'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/YOUR/WEBHOOK'
        channel: '#alerts'
    # Ou email:
    # email_configs:
    #   - to: 'team@example.com'
```

---

## Dashboards

### Grafana - ThinkCoffee Overview

Acesso: http://localhost:3001
Login: admin / thinkcoffee

Paineis:
1. **Service Status** - UP/DOWN
2. **Memory Usage** - Uso de memoria em MB
3. **History Saves** - Total de saves
4. **History Errors** - Erros de save
5. **Save Rate** - Taxa de saves/erros por segundo
6. **Database Size** - Crescimento do banco

### Criar Dashboard Customizado

1. Acesse Grafana
2. Clique em + > New Dashboard
3. Add visualization
4. Selecione Prometheus como datasource
5. Use queries PromQL

---

## Prevencao de Perda de Dados

### Indicadores de Risco

1. **Taxa de erro de save > 0**
   - Indica problemas de IO
   - Acao: Verificar volume imediatamente

2. **Uso de disco > 80%**
   - SQLite pode falhar com disco cheio
   - Acao: Limpar espaco ou expandir

3. **Container reiniciando**
   - Pode indicar crash loop
   - Acao: Verificar logs

4. **Memoria crescendo constantemente**
   - Memory leak
   - Acao: Reiniciar container, reportar bug

### Verificacao Pro-ativa

Execute diariamente:

```bash
# Verificar integridade
./scripts/monitor.sh

# Verificar se historico esta sendo salvo
docker exec thinkcoffee-mcp ls -la /data/chat_history_*.json

# Verificar integridade do SQLite
docker exec thinkcoffee-mcp sqlite3 /data/data.sqlite "PRAGMA integrity_check;"
```

### Automacao de Verificacao

Adicione ao cron:

```cron
# Verificacao a cada hora
0 * * * * /opt/thinkcoffee/scripts/monitor.sh >> /var/log/thinkcoffee-monitor.log 2>&1

# Backup diario
0 2 * * * /opt/thinkcoffee/scripts/backup.sh daily >> /var/log/thinkcoffee-backup.log 2>&1
```

---

## Runbook de Incidentes

### Incidente: Servico Fora do Ar

1. Verificar status do container:
   ```bash
   docker compose ps
   docker compose logs --tail 50 mcp-server
   ```

2. Tentar reiniciar:
   ```bash
   docker compose restart mcp-server
   ```

3. Se persistir, verificar recursos:
   ```bash
   docker stats
   df -h
   ```

4. Ultimo recurso - recreate:
   ```bash
   docker compose down
   docker compose up -d
   ```

### Incidente: Historico de Chat Perdido

1. **NAO REINICIE O CONTAINER** - pode perder mais dados

2. Verificar se arquivos existem:
   ```bash
   docker exec thinkcoffee-mcp ls -la /data/chat_history_*.json
   ```

3. Se existem, verificar permissoes:
   ```bash
   docker exec thinkcoffee-mcp ls -la /data/
   ```

4. Se nao existem, restaurar backup:
   ```bash
   ./scripts/restore.sh latest
   ```

5. Documentar e investigar causa raiz

### Incidente: Disco Cheio

1. Identificar maiores consumidores:
   ```bash
   docker system df
   du -sh /var/lib/docker/*
   ```

2. Limpar recursos Docker:
   ```bash
   docker system prune -f
   docker image prune -a
   ```

3. Limpar backups antigos:
   ```bash
   find ./backups -name "*.tar.gz" -mtime +7 -delete
   ```

4. Se necessario, expandir disco

### Incidente: Falha de Backup

1. Verificar espaco em disco
2. Verificar permissoes do diretorio
3. Executar backup manual:
   ```bash
   ./scripts/backup.sh manual
   ```
4. Verificar integridade:
   ```bash
   tar -tzf backups/BACKUP.tar.gz > /dev/null
   ```

---

## Contatos

Em caso de incidente critico:
1. Notificar o time via Slack/Teams
2. Criar issue no GitHub
3. Documentar timeline do incidente

---

*Documento atualizado em: 2024*
*Versao: 2.0*
