# Análise da Perda do Histórico de Chat - ThinkCoffee

## Resumo Executivo

Investigação da perda do histórico de pipelines no chat da extensão ThinkCoffee. A análise identifica a arquitetura atual de armazenamento, possíveis causas da perda e define requisitos para recuperação e melhoria do sistema.

## Análise Técnica

### Arquitetura Atual de Armazenamento

O sistema ThinkCoffee armazena o histórico de chat em arquivos `.jsonl` (JSON Lines) no sistema de arquivos local:

**Localização:**
- Windows: `%USERPROFILE%\.thinkcoffee\chat\`
- Estrutura: `{channel}.jsonl` (ex: `default.jsonl`)
- Formato: JSON Lines (uma mensagem por linha)

**Código Responsável:**
- `packages/core/src/chat.ts` - Classe `ChatService`
- Método `getChatDir()` retorna `~/.thinkcoffee/chat/`
- Método `getChatFile(channel)` gera o caminho do arquivo

### Fluxo de Dados Atual

1. **Escrita:** `ChatService.send()` → `fs.appendFileSync()`
2. **Leitura:** `ChatService.getHistory()` → `fs.readFileSync()` + parse JSON
3. **Watch:** `ChatService.watch()` → `fs.watchFile()` para mudanças

### Possíveis Causas da Perda

1. **Arquivo Corrompido:** Parse JSON falha silenciosamente
2. **Permissões:** Falha na criação/escrita do diretório
3. **Concorrência:** Múltiplas instâncias VS Code escrevendo simultaneamente
4. **Limpeza Manual:** Usuário deletou arquivos `.thinkcoffee`
5. **Path Issues:** Problemas na resolução do diretório home

## Evidências no Código

### Pontos de Falha Identificados

```typescript
// chat.ts:60-66 - Parse error não bloqueia carregamento
lines.forEach((l, i) => {
  if (!l.trim()) return;
  try {
    msgs.push(JSON.parse(l) as ChatMessage);
  } catch (err) {
    console.error(`Parse error: ${err.message} — content: ${l.substring(0, 80)}`);
  }
});
```

### Limitações Atuais

1. **Sem Backup:** Apenas um arquivo por canal
2. **Sem Validação:** Parse errors são logados mas ignorados
3. **Sem Lock:** Concorrência não controlada
4. **Sem Recovery:** Dados corrompidos são perdidos

## Requisitos de Recuperação

### RF01 - Sistema de Backup Automático
**Como** Product Manager  
**Quero** que o histórico tenha backup automático  
**Para** recuperar dados em caso de corrupção

**Critérios de Aceite:**
- [ ] Backup diário dos arquivos `.jsonl`
- [ ] Manter últimos 7 backups
- [ ] Backup em diretório separado `~/.thinkcoffee/chat/backups/`
- [ ] Nomenclatura: `{channel}_{YYYY-MM-DD}.jsonl`

### RF02 - Validação e Recovery
**Como** usuário da extensão  
**Quero** que erros de parse sejam tratados  
**Para** não perder histórico por corrupção parcial

**Critérios de Aceite:**
- [ ] Validar estrutura JSON de cada linha
- [ ] Isolar linhas corrompidas em arquivo separado
- [ ] Notificar usuário sobre recovery automático
- [ ] Continuar funcionamento mesmo com dados corrompidos

### RF03 - Detecção de Perda de Histórico
**Como** usuário da extensão  
**Quero** ser notificado quando histórico for perdido  
**Para** tomar ação de recovery

**Critérios de Aceite:**
- [ ] Detectar quando arquivo histórico está vazio/ausente
- [ ] Verificar se existem backups disponíveis
- [ ] Modal de confirmação para restaurar backup
- [ ] Log detalhado do evento de perda

### RF04 - Migração para Storage Robusto
**Como** Product Manager  
**Quero** avaliar migração para SQLite  
**Para** maior confiabilidade do armazenamento

**Critérios de Aceite:**
- [ ] Análise de viabilidade técnica
- [ ] Script de migração `.jsonl` → SQLite
- [ ] Manter compatibilidade com formato atual
- [ ] Implementação incremental (opt-in)

### RF05 - Sincronização Multi-Window
**Como** usuário avançado  
**Quero** histórico sincronizado entre janelas VS Code  
**Para** evitar conflitos de concorrência

**Critérios de Aceite:**
- [ ] Lock de arquivo durante escrita
- [ ] Detecção de múltiplas instâncias
- [ ] Refresh automático quando arquivo é modificado externamente
- [ ] Merge inteligente de mensagens concorrentes

## Backlog Priorizado

### Epic 1: Recovery Imediato (P0)
**Entrega:** 1 semana

1. **História 1.1** - Implementar sistema de backup
   - Backup automático no `ChatService.send()`
   - Rotação de 7 backups mais recentes
   - **Estimativa:** 3 pontos

2. **História 1.2** - Recovery automático  
   - Detectar arquivo corrompido/vazio
   - Oferecer restauração de backup
   - **Estimativa:** 5 pontos

3. **História 1.3** - Logging e monitoramento
   - Log estruturado de operações de chat
   - Telemetria de falhas de parse
   - **Estimativa:** 2 pontos

### Epic 2: Robustez (P1)
**Entrega:** 2 semanas

4. **História 2.1** - Validação de dados
   - Schema validation das mensagens
   - Quarentena de dados inválidos
   - **Estimativa:** 3 pontos

5. **História 2.2** - Controle de concorrência
   - File locking para escrita
   - Detecção de conflitos
   - **Estimativa:** 5 pontos

### Epic 3: Melhoria Arquitetural (P2)
**Entrega:** 3-4 semanas

6. **História 3.1** - Análise de migração SQLite
   - Estudo de viabilidade técnica
   - Protótipo de performance
   - **Estimativa:** 8 pontos

7. **História 3.2** - Implementação migração opcional
   - SQLite como storage alternativo
   - Flag de configuração
   - **Estimativa:** 13 pontos

## Implementação Técnica

### Estrutura de Backup Proposta

```
~/.thinkcoffee/
├── chat/
│   ├── default.jsonl           # Arquivo principal
│   ├── pipeline_123.jsonl      # Chat de pipeline específico
│   └── backups/
│       ├── default_2024-03-15.jsonl
│       ├── default_2024-03-14.jsonl
│       └── ...
└── logs/
    └── chat-operations.log     # Log de debug
```

### Classes Afetadas

1. **`ChatService`** - Core do sistema
2. **`ChatPanel`** - UI notificações
3. **`ChatViewProvider`** - Manage recovery UI
4. **`AgentService`** - Preservar histórico de pipeline

## Critérios de Aceite Global

### Funcional
- [ ] Histórico nunca é perdido completamente
- [ ] Recovery automático em < 5 segundos
- [ ] Suporte a múltiplas janelas VS Code
- [ ] Notificações não-intrusivas

### Não-Funcional
- [ ] Performance: +50ms máximo para backup
- [ ] Confiabilidade: 99.9% de preservação de dados
- [ ] Usabilidade: Zero intervenção manual necessária
- [ ] Compatibilidade: Backward compatible com dados existentes

## Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Backup performance | Média | Baixo | Async backup, throttling |
| Storage space | Baixa | Médio | Auto-cleanup de backups antigos |
| Complexidade SQLite | Baixa | Alto | Implementação incremental |
| Migration bugs | Média | Alto | Extensive testing, rollback |

## Conclusão

A perda de histórico decorre principalmente da falta de robustez no sistema atual de arquivos `.jsonl`. As melhorias propostas introduzem backup automático, recovery e validação, garantindo que dados nunca sejam perdidos permanentemente.

A implementação será incremental, priorizando recovery imediato seguido de melhorias arquiteturais de longo prazo.