# Processo de Backup e Recuperacao - ThinkCoffee

## Sumario
- [Contexto](#contexto)
- [Localizacao dos Dados](#localizacao-dos-dados)
- [Estrategia de Backup](#estrategia-de-backup)
- [Processo de Recuperacao](#processo-de-recuperacao)
- [Automacao de Backup](#automacao-de-backup)
- [Verificacao e Validacao](#verificacao-e-validacao)
- [Troubleshooting](#troubleshooting)

---

## Contexto

O historico do chat e as pipelines do ThinkCoffee sao persistidos em volumes Docker para evitar perda de dados entre reinicializacoes e atualizacoes de containers.

Este documento descreve os procedimentos de backup, restore e monitoramento para garantir a integridade dos dados.

---

## Localizacao dos Dados

### Volume Docker
- **Nome do volume:** `thinkcoffee_data`
- **Mount point no container:** `/data`

### Estrutura de Diretorios
```
/data/
├── data.sqlite              # Banco de dados SQLite principal
├── snapshots/               # Snapshots automaticos (V3 Safety Net)
├── logs/                    # Logs de acoes em formato JSONL
└── chat_history_*.json      # Arquivos de historico de chat por pipeline
```

### Arquivos Criticos
| Arquivo | Descricao | Backup Obrigatorio |
|---------|-----------|-------------------|
| `data.sqlite` | Banco principal com contextos e metadados | Sim |
| `chat_history_*.json` | Historico de chat por pipeline | Sim |
| `snapshots/*` | Snapshots para rollback | Recomendado |
| `logs/*` | Logs de auditoria | Opcional |

---

## Estrategia de Backup

### 1. Backup Manual (Sob Demanda)

Execute o script de backup:

```bash
# Backup com tag customizado
./scripts/backup.sh manual

# Backup antes de deploy
./scripts/backup.sh pre-deploy

# Backup diario
./scripts/backup.sh daily
```

O backup sera salvo em `./backups/thinkcoffee_<tag>_<timestamp>.tar.gz`.

### 2. Backup Rapido via Docker

Para backup rapido sem usar o script:

```bash
# Backup completo do volume
docker run --rm \
    -v thinkcoffee_data:/data:ro \
    -v $(pwd)/backups:/backup \
    alpine \
    tar -czf /backup/thinkcoffee_$(date +%Y%m%d_%H%M%S).tar.gz -C /data .
```

### 3. Backup Apenas do Banco de Dados

```bash
# Copiar apenas o SQLite
docker run --rm \
    -v thinkcoffee_data:/data:ro \
    -v $(pwd)/backups:/backup \
    alpine \
    cp /data/data.sqlite /backup/data_$(date +%Y%m%d_%H%M%S).sqlite
```

---

## Processo de Recuperacao

### 1. Restore Completo (Script Automatizado)

```bash
# Restore do backup mais recente
./scripts/restore.sh latest

# Restore de backup especifico
./scripts/restore.sh backups/thinkcoffee_daily_20240115_120000.tar.gz
```

O script automaticamente:
- Cria backup pre-restore
- Para os servicos
- Restaura os dados
- Reinicia os servicos
- Verifica a saude

### 2. Restore Manual

```bash
# Parar servicos
docker compose down

# Limpar e recriar volume
docker volume rm thinkcoffee_data
docker volume create thinkcoffee_data

# Restaurar dados
docker run --rm \
    -v thinkcoffee_data:/data \
    -v $(pwd)/backups:/backup \
    alpine \
    sh -c "tar -xzf /backup/NOME_DO_BACKUP.tar.gz -C /data"

# Reiniciar servicos
docker compose up -d
```

### 3. Restore Parcial (Apenas Historico de Chat)

```bash
# Extrair apenas arquivos de chat do backup
tar -xzf backups/BACKUP.tar.gz --wildcards '*/chat_history_*.json'

# Copiar para o volume
docker run --rm \
    -v thinkcoffee_data:/data \
    -v $(pwd):/workspace \
    alpine \
    cp /workspace/*/chat_history_*.json /data/
```

---

## Automacao de Backup

### Cron Job (Linux/Mac)

Adicione ao crontab (`crontab -e`):

```cron
# Backup diario as 2:00 AM
0 2 * * * cd /opt/thinkcoffee && ./scripts/backup.sh daily >> /var/log/thinkcoffee-backup.log 2>&1

# Backup semanal aos domingos as 3:00 AM
0 3 * * 0 cd /opt/thinkcoffee && ./scripts/backup.sh weekly >> /var/log/thinkcoffee-backup.log 2>&1
```

### Task Scheduler (Windows)

Crie uma tarefa agendada para executar:

```powershell
# PowerShell script para backup
cd C:\Users\luann\Documents\GitHub\thinkcoffee
bash scripts/backup.sh daily
```

### GitHub Actions (Backup Automatico)

O workflow `.github/workflows/backup.yml` pode ser criado para backups periodicos:

```yaml
name: Scheduled Backup
on:
  schedule:
    - cron: '0 2 * * *'  # Diario as 2:00 UTC
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run backup
        run: ./scripts/backup.sh scheduled
      - name: Upload backup
        uses: actions/upload-artifact@v4
        with:
          name: backup-${{ github.run_id }}
          path: backups/*.tar.gz
          retention-days: 30
```

---

## Verificacao e Validacao

### Verificar Integridade do Backup

```bash
# Verificar se o arquivo tar eh valido
tar -tzf backups/BACKUP.tar.gz > /dev/null && echo "OK" || echo "CORRUPTED"

# Listar conteudo do backup
tar -tvf backups/BACKUP.tar.gz
```

### Verificar Metadata do Backup

```bash
# Extrair e visualizar metadata
tar -xzf backups/BACKUP.tar.gz -O "*/backup_metadata.json" | jq .
```

### Teste de Restore (Staging)

Sempre teste o restore em ambiente de staging antes de aplicar em producao:

```bash
# Criar volume temporario
docker volume create thinkcoffee_test

# Restaurar para volume de teste
docker run --rm \
    -v thinkcoffee_test:/data \
    -v $(pwd)/backups:/backup \
    alpine \
    sh -c "tar -xzf /backup/BACKUP.tar.gz -C /data"

# Verificar dados
docker run --rm -v thinkcoffee_test:/data alpine ls -la /data

# Limpar
docker volume rm thinkcoffee_test
```

---

## Troubleshooting

### Backup Falha com "No space left on device"

```bash
# Verificar espaco em disco
df -h

# Limpar backups antigos
find ./backups -name "*.tar.gz" -mtime +30 -delete

# Limpar imagens Docker nao utilizadas
docker system prune -f
```

### Restore Falha com "Permission denied"

```bash
# Verificar permissoes do volume
docker run --rm -v thinkcoffee_data:/data alpine ls -la /data

# Corrigir permissoes (se necessario)
docker run --rm -v thinkcoffee_data:/data alpine chown -R 1000:1000 /data
```

### Banco de Dados Corrompido

```bash
# Verificar integridade do SQLite
docker run --rm -v thinkcoffee_data:/data alpine \
    sqlite3 /data/data.sqlite "PRAGMA integrity_check;"

# Tentar recuperar
docker run --rm -v thinkcoffee_data:/data alpine \
    sqlite3 /data/data.sqlite ".recover" > recovered.sql
```

### Historico de Chat Perdido

1. Verificar se existem arquivos no volume:
   ```bash
   docker run --rm -v thinkcoffee_data:/data alpine ls -la /data/chat_history_*.json
   ```

2. Se nao existirem, restaurar do backup mais recente:
   ```bash
   ./scripts/restore.sh latest
   ```

3. Se nao houver backup, os dados foram perdidos permanentemente.

---

## Politica de Retencao

| Tipo de Backup | Retencao | Quantidade Maxima |
|----------------|----------|-------------------|
| Pre-deploy | 7 dias | 5 |
| Daily | 30 dias | 30 |
| Weekly | 90 dias | 12 |
| Manual | 90 dias | Ilimitado |

Configuravel via variaveis de ambiente:
- `BACKUP_RETENTION_DAYS=30`
- `MAX_BACKUP_COUNT=10`

---

## Contatos de Emergencia

Em caso de perda de dados em producao:
1. NAO tente recuperar sozinho em producao
2. Informe o time imediatamente
3. Documente o que aconteceu
4. Execute o restore apenas apos aprovacao

---

*Documento atualizado em: 2024*
*Versao: 2.0*
