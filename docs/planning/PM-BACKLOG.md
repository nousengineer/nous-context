# ThinkCoffee -- Product Backlog V3: Agent Safety Net (Dry-Run, Snapshot & Rollback)

> Gerado pelo agente Product Manager | Pipeline: "continue o PM-BACKLOG.md da pasta docs"
> Data: 2025-01-15
> Versao: 3.0
> Predecessores: PM-BACKLOG.md (V1 -- Guardrails), PM-BACKLOG-V2.md (V2 -- History & Observability)

---

## 1. Analise do Estado Atual

### 1.1 O que foi implementado desde os Backlogs anteriores

| Item | Origem | Status | Evidencia |
|---|---|---|---|
| Command Validator (guardrails de shell) | V1/REQ-04 parcial | Implementado | `packages/core/src/guardrails/command-validator.ts` |
| Suite de testes unitarios | V1/REQ-07 | Implementado | `__tests__/` em pipeline, chat, services, export, validation |
| Pipeline multi-agente com tools e auto-assign | V1 base | Implementado | `AgentService.ts`, `PipelineService` |
| Quality Presets (cafe-soluvel, coado, espresso) | V1 base | Implementado | `agent-config.ts` |
| Model failure tracking | V1 base | Implementado | `recordModelFailure()`, `getModelFailureCounts()` |
| Auto-sync (on-change, scheduled, manual) | V1 base | Implementado | `AutoSyncService`, `SyncConfigService` |
| Path traversal protection (basica) | V1/CODE-REVIEW | Implementado parcial | `AgentService.ts` (inconsistente com MCP) |

### 1.2 Itens PENDENTES acumulados (carry-over V1 + V2)

#### Carry-over V1 -- Prioridade CRITICA

| ID Original | Item | Prioridade | Motivo da pendencia |
|---|---|---|---|
| V1/REQ-01 | Dry-Run Mode para agentes | P0 | Nao implementado. AgentService executa tools diretamente sem flag dry-run |
| V1/REQ-02 | Snapshot antes de execucao | P0 | Nenhum SnapshotService existe |
| V1/REQ-03 | Comando de Rollback | P0 | Depende do snapshot |
| V1/REQ-05 | Diff Preview antes de write_file | P1 | write_file grava direto sem preview |

#### Carry-over V2 -- Prioridade ALTA/MEDIA

| ID Original | Item | Prioridade | Motivo da pendencia |
|---|---|---|---|
| V2/REQ-01 | Pipeline Execution Metrics | P0 | Nenhum tracking de tempo/tokens/tool calls por task |
| V2/REQ-02 | Pipeline History Store | P0 | Nenhum PipelineHistoryService existe |
| V2/REQ-03 | Comando /history no Chat e CLI | P0 | Depende do history store |
| V2/REQ-04 | Pipeline Cost Tracker | P1 | Nao implementado |
| V2/REQ-05 | Cost Budget & Alerts | P1 | Nao implementado |
| V2/REQ-06 | Pipeline History Export | P2 | Nao implementado |
| V2/REQ-07 | Pipeline Comparison View | P2 | Nao implementado |

### 1.3 Lacunas novas identificadas

| Lacuna | Impacto | Prioridade |
|---|---|---|
| Agentes modificam workspace sem possibilidade de reverter | Critico -- dano irrecuperavel em codigo | P0 |
| Nenhuma forma de "testar" o pipeline antes de executar de verdade | Alto -- usuario nao confia no pipeline | P0 |
| write_file sobrescreve sem diff nem confirmacao | Alto -- perda de codigo inadvertida | P1 |
| safePath inconsistente entre MCP e VSCode | Alto -- path traversal parcialmente aberto | P1 |
| Nenhum log estruturado de acoes de agentes | Medio -- impossivel auditar o que aconteceu | P1 |
| Tools duplicadas entre AgentService e MCP server | Medio -- manutencao dobrada, bugs divergentes | P2 |
| Console.error como unico mecanismo de logging | Baixo -- sem rastreabilidade | P2 |

### 1.4 Analise de risco -- Por que esta feature eh a proxima

O code review (CODE-REVIEW-FINAL.md) classificou a seguranca do produto como **5/10** e a cobertura de testes como **4/10**, com veredicto **NAO PRONTO PARA MERGE**. Os tres bloqueantes identificados foram:

1. **SEC-01**: Execucao de comandos sem sanitizacao -- **parcialmente mitigado** pelo command-validator
2. **SEC-02**: Path traversal inconsistente -- **pendente**
3. **TEST-01**: Cobertura insuficiente -- **parcialmente mitigado** com novos testes

O risco restante mais critico eh: **agentes podem modificar/deletar/criar arquivos e executar comandos sem nenhuma rede de seguranca**. O command-validator identifica comandos perigosos, mas nao ha mecanismo de:
- Preview do que sera alterado
- Snapshot para restaurar
- Dry-run para simular
- Rollback para reverter

Estes itens sao P0 desde o Backlog V1 e nunca foram implementados. Este backlog V3 os prioriza definitivamente.

---

## 2. Feature Principal: Agent Safety Net (Dry-Run, Snapshot & Rollback)

### Justificativa

O ThinkCoffee eh um produto que da a agentes de IA acesso direto ao filesystem e ao shell do usuario. Cada `write_file`, `delete_file`, `run_command` eh uma operacao potencialmente destrutiva. O produto ja tem:
- Command validator (identifica comandos perigosos)
- Path traversal protection (basica)

O que FALTA eh o ciclo completo de seguranca:

```
[Antes]           [Durante]           [Depois]
Dry-Run    -->    Snapshot     -->    Rollback
(simular)         (backup)            (reverter)
    |                |                    |
    v                v                    v
 Diff Preview    Action Log         Restore Point
```

Sem isso, o usuario precisa confiar cegamente que o agente fara a coisa certa. Isso eh inaceitavel para um produto que modifica codigo em producao.

---

## 3. Requisitos Estruturados

### REQ-01: Tool Action Log (Fundacao)

**Descricao**: Registrar TODA acao de tool call executada por agentes em um log estruturado. Cada entrada inclui: timestamp, agente, tool name, input parameters, result (sucesso/erro), arquivos afetados, duracao. Persistir em `~/.thinkcoffee/logs/<projectId>/<pipelineId>.jsonl` (JSON Lines para append eficiente).

**Justificativa**: Eh a base para tudo -- snapshot precisa saber quais arquivos foram tocados, rollback precisa saber o que reverter, dry-run precisa saber o que seria executado, metricas precisam de dados.

**Modulos afetados**: `packages/core/src/services/` (novo `ActionLogService`), `packages/vscode/src/agents/AgentService.ts`

| Campo | Detalhe |
|---|---|
| Tipo | Funcional |
| Prioridade | P0 -- Critica |
| Estimativa | S (1-2 dias) |
| Dependencias | Nenhuma |

### REQ-02: Snapshot Service

**Descricao**: Antes de qualquer fase do pipeline executar acoes de escrita (`write_file`, `delete_file`), salvar copia dos arquivos que serao afetados em `~/.thinkcoffee/snapshots/<pipelineId>/<phaseIndex>/`. Cada snapshot contem:
- Copia dos arquivos originais (somente os que serao modificados/deletados)
- Metadado JSON: `{ pipelineId, phaseIndex, phaseName, timestamp, files: [{ relativePath, action, originalHash, originalSize }] }`

O snapshot eh criado ANTES da primeira tool call de escrita da fase (lazy -- nao snapshot tudo no inicio, mas antes de cada write_file individual).

**Modulos afetados**: Novo `packages/core/src/services/SnapshotService.ts`, `packages/vscode/src/agents/AgentService.ts`

| Campo | Detalhe |
|---|---|
| Tipo | Funcional |
| Prioridade | P0 -- Critica |
| Estimativa | M (3-5 dias) |
| Dependencias | REQ-01 |

### REQ-03: Rollback Command

**Descricao**: Comando `/rollback` no chat do VS Code e `think rollback [pipelineId] [phaseIndex]` no CLI que restaura o workspace ao estado pre-execucao de uma fase usando o snapshot. Comportamento:
- Arquivos modificados: restaura ao conteudo original do snapshot
- Arquivos criados pelo agente (nao existiam antes): deleta
- Arquivos deletados pelo agente: restaura a partir do snapshot
- Pipeline volta ao status `in-progress` da fase revertida, com tasks resetadas para `pending`

**Modulos afetados**: Novo `packages/core/src/services/RollbackService.ts`, `packages/cli/src/commands/rollback.ts`, `packages/vscode/src/chat/`

| Campo | Detalhe |
|---|---|
| Tipo | Funcional |
| Prioridade | P0 -- Critica |
| Estimativa | M (3-5 dias) |
| Dependencias | REQ-02 |

### REQ-04: Dry-Run Mode

**Descricao**: Flag `--dry-run` no CLI (`think pipeline run --dry-run`) e opcao `dryRun: boolean` no `AgentService`. Em modo dry-run:
- Agentes recebem o prompt e geram output normalmente
- Tool calls de LEITURA (`read_file`, `list_files`, `search_code`) executam normalmente
- Tool calls de ESCRITA (`write_file`, `run_command`) NAO executam -- em vez disso, registram a acao planejada no Action Log com flag `dryRun: true`
- O output do agente eh coletado e exibido no chat com label `[DRY-RUN]`
- Nenhum arquivo eh criado/modificado/deletado
- Nenhum comando shell eh executado

**Modulos afetados**: `packages/core/src/pipeline.ts` (flag no Pipeline), `packages/vscode/src/agents/AgentService.ts`, `packages/cli/src/commands/`

| Campo | Detalhe |
|---|---|
| Tipo | Funcional |
| Prioridade | P0 -- Critica |
| Estimativa | M (3-5 dias) |
| Dependencias | REQ-01 |

### REQ-05: Diff Preview antes de write_file

**Descricao**: Quando agente chama `write_file` em arquivo existente no VS Code (fora do modo dry-run), mostrar diff inline usando `vscode.diff` API. Fluxo:
1. Agente chama `write_file(path, content)`
2. Sistema salva conteudo proposto em arquivo temporario
3. Abre vscode.diff mostrando original vs proposto
4. Exibe notificacao com botoes "Aceitar" / "Rejeitar"
5. Se aceitar: grava o arquivo, continua pipeline
6. Se rejeitar: retorna erro ao agente ("write_file rejected by user"), agente recebe feedback

Configuravel via `thinkcoffee.diffPreview`: `always`, `existing-only`, `never`
- `always`: diff para toda escrita (inclusive novos arquivos vs vazio)
- `existing-only` (default): diff apenas para arquivos que ja existem
- `never`: grava direto (comportamento atual)

**Modulos afetados**: `packages/vscode/src/agents/AgentService.ts`, novo `packages/vscode/src/utils/DiffPreviewHandler.ts`

| Campo | Detalhe |
|---|---|
| Tipo | Funcional |
| Prioridade | P1 -- Alta |
| Estimativa | M (3-5 dias) |
| Dependencias | Nenhuma |

### REQ-06: Confirmacao interativa para run_command

**Descricao**: Integrar o `command-validator.ts` existente ao fluxo de execucao do AgentService. Quando um agente chama `run_command`:
1. `validateCommand()` classifica o risco (safe, moderate, destructive, blocked)
2. `blocked`: rejeita imediatamente, retorna erro ao agente
3. `destructive`: exibe popup no VS Code com o comando e opcoes "Executar" / "Rejeitar"
4. `moderate`: loga no action log, executa (sem popup)
5. `safe`: executa normalmente

Configuravel via `thinkcoffee.commandConfirmation`: `always`, `destructive-only` (default), `never`

**Modulos afetados**: `packages/vscode/src/agents/AgentService.ts`, `packages/core/src/guardrails/command-validator.ts`

| Campo | Detalhe |
|---|---|
| Tipo | Funcional |
| Prioridade | P1 -- Alta |
| Estimativa | S (1-2 dias) |
| Dependencias | Nenhuma (command-validator ja existe) |

### REQ-07: safePath centralizado e corrigido

**Descricao**: Centralizar a funcao `safePath` em `packages/core/src/utils/safe-path.ts` e corrigir inconsistencias entre AgentService (verificacao simples) e MCP server (funcao dedicada). A implementacao deve:
- Usar `path.normalize` antes de comparar
- Tratar corretamente Windows (separadores, drives diferentes)
- Ser reutilizada em AMBOS os contextos (AgentService e MCP)
- Incluir testes especificos para edge cases de path traversal

**Modulos afetados**: Novo `packages/core/src/utils/safe-path.ts`, `packages/vscode/src/agents/AgentService.ts`, `packages/mcp-server/src/index.ts`

| Campo | Detalhe |
|---|---|
| Tipo | Nao-funcional (Seguranca) |
| Prioridade | P1 -- Alta |
| Estimativa | S (1-2 dias) |
| Dependencias | Nenhuma |

### REQ-08: Tools extraidas para o Core

**Descricao**: Extrair a logica de tools (`read_file`, `write_file`, `list_files`, `search_code`, `run_command`) para `packages/core/src/tools/`, eliminando duplicacao entre AgentService e MCP server. Cada tool recebe workspace root e retorna resultado. O AgentService e o MCP importam do core.

**Modulos afetados**: Novo `packages/core/src/tools/`, `packages/vscode/src/agents/AgentService.ts`, `packages/mcp-server/src/index.ts`

| Campo | Detalhe |
|---|---|
| Tipo | Refatoracao (Arquitetura) |
| Prioridade | P2 -- Media |
| Estimativa | M (3-5 dias) |
| Dependencias | REQ-07 (safePath deve existir no core antes) |

### REQ-09: Snapshot Garbage Collector

**Descricao**: Rotina que limpa snapshots antigos automaticamente. Regras:
- Snapshots com mais de 7 dias sao removidos (configuravel)
- Limite de 50MB por pipeline (configuravel)
- Executa ao iniciar o VS Code extension e a cada 24h
- Configuravel via `~/.thinkcoffee/snapshot-config.json`: `{ "retentionDays": 7, "maxSizeMB": 50 }`

**Modulos afetados**: `packages/core/src/services/SnapshotService.ts` (metodo adicional)

| Campo | Detalhe |
|---|---|
| Tipo | Nao-funcional (Manutencao) |
| Prioridade | P2 -- Media |
| Estimativa | S (1-2 dias) |
| Dependencias | REQ-02 |

### REQ-10: Testes para todos os novos modulos

**Descricao**: Cobertura minima de 80% para: `ActionLogService`, `SnapshotService`, `RollbackService`, `safe-path.ts`, dry-run logic. Testes devem usar mocks de filesystem (sem I/O real). Incluir testes de integracao para fluxos completos: dry-run pipeline, snapshot -> rollback, diff preview accept/reject.

**Modulos afetados**: `packages/core/src/services/__tests__/`, `packages/core/src/utils/__tests__/`, `packages/core/src/tools/__tests__/`

| Campo | Detalhe |
|---|---|
| Tipo | Nao-funcional (Qualidade) |
| Prioridade | P1 -- Alta |
| Estimativa | L (5-8 dias) |
| Dependencias | REQ-01, REQ-02, REQ-03, REQ-04, REQ-07 |

---

## 4. Criterios de Aceite

### REQ-01: Tool Action Log

- [ ] Cada tool call executado por agente gera entrada no log
- [ ] Formato JSONL (uma linha JSON por entrada) em `~/.thinkcoffee/logs/<projectId>/<pipelineId>.jsonl`
- [ ] Cada entrada contem: `{ timestamp, pipelineId, phaseIndex, taskId, agent, tool, input, result, success, durationMs, dryRun }`
- [ ] Para `write_file` e `delete_file`: campo `filesAffected: string[]`
- [ ] Para `run_command`: campo `command: string` e `exitCode: number`
- [ ] `ActionLogService` tem metodos: `log(entry)`, `getByPipeline(pipelineId)`, `getByPhase(pipelineId, phaseIndex)`, `getFileActions(pipelineId, phaseIndex)`
- [ ] Log eh append-only (nunca edita entradas existentes)
- [ ] Teste unitario: entradas sao registradas e consultaveis corretamente

### REQ-02: Snapshot Service

- [ ] Antes de `write_file` em arquivo existente: copia original para `~/.thinkcoffee/snapshots/<pipelineId>/<phaseIndex>/<relativePath>`
- [ ] Antes de `delete_file`: copia arquivo para snapshot
- [ ] Snapshot de cada arquivo ocorre apenas UMA vez por fase (primeira modificacao)
- [ ] Metadado salvo em `~/.thinkcoffee/snapshots/<pipelineId>/<phaseIndex>/snapshot.json`
- [ ] Metadado inclui: `{ pipelineId, phaseIndex, phaseName, timestamp, files: [{ path, action, hash, size }] }`
- [ ] Hash calculado via SHA-256 do conteudo original
- [ ] Arquivos criados pelo agente (novos) NAO sao copiados, mas registrados no metadado com `action: "created"`
- [ ] Se arquivo exceder 10MB: warning no chat, snapshot mesmo assim
- [ ] `SnapshotService` tem metodos: `snapshotFile(pipelineId, phaseIndex, phaseName, workspace, relativePath)`, `getSnapshot(pipelineId, phaseIndex)`, `listSnapshots(pipelineId)`, `deleteSnapshot(pipelineId, phaseIndex)`
- [ ] Teste unitario: snapshot salva e recupera corretamente

### REQ-03: Rollback Command

- [ ] `/rollback` no chat restaura fase atual ao estado do snapshot
- [ ] `/rollback <phaseIndex>` restaura fase especifica
- [ ] `think rollback <pipelineId>` no CLI restaura fase atual
- [ ] `think rollback <pipelineId> --phase <index>` restaura fase especifica
- [ ] Arquivos modificados: restaurados ao conteudo do snapshot
- [ ] Arquivos criados pelo agente: deletados
- [ ] Arquivos deletados pelo agente: restaurados a partir do snapshot
- [ ] Pipeline atualizado: fase volta a `in-progress`, tasks voltam a `pending`
- [ ] Antes de executar: exibe resumo das acoes e pede confirmacao
- [ ] Apos rollback: mensagem no chat com resumo -- "Rollback fase X: N arquivos restaurados, M arquivos deletados"
- [ ] Se snapshot nao existe: erro claro -- "Nenhum snapshot encontrado para esta fase"
- [ ] Teste unitario: rollback restaura estado exato
- [ ] Teste unitario: rollback de arquivos criados deleta corretamente

### REQ-04: Dry-Run Mode

- [ ] Flag `--dry-run` disponivel em `think pipeline run`
- [ ] Propriedade `dryRun: boolean` no objeto `Pipeline` (default: false)
- [ ] Em dry-run, `read_file`, `list_files`, `search_code` executam normalmente
- [ ] Em dry-run, `write_file` NAO grava -- registra no action log com `dryRun: true` e retorna ao agente: "DRY-RUN: Would write to <path> (<size> bytes)"
- [ ] Em dry-run, `run_command` NAO executa -- registra no action log e retorna: "DRY-RUN: Would execute: <command>"
- [ ] Em dry-run, `delete_file` NAO deleta -- registra e retorna: "DRY-RUN: Would delete: <path>"
- [ ] Chat exibe label `[DRY-RUN]` em todas as mensagens de agentes
- [ ] Ao fim do dry-run: chat exibe resumo de acoes planejadas -- "Dry-run completo: N arquivos seriam escritos, M comandos seriam executados"
- [ ] Botao no VS Code: "Executar de verdade" que re-roda a mesma pipeline sem dry-run
- [ ] Teste unitario: pipeline em dry-run nao altera filesystem

### REQ-05: Diff Preview

- [ ] Usa `vscode.commands.executeCommand('vscode.diff', ...)` para diff inline
- [ ] Notificacao com botoes "Aceitar" (grava) e "Rejeitar" (cancela)
- [ ] Se rejeitado: agente recebe feedback "write_file rejected by user for <path>"
- [ ] Novos arquivos: opcao `always` mostra diff contra arquivo vazio; opcao `existing-only` grava direto
- [ ] Configuracao `thinkcoffee.diffPreview` com valores: `always`, `existing-only`, `never`
- [ ] Default: `existing-only`
- [ ] Timeout de 120s -- se usuario nao responder, cancela a escrita (nao grava)
- [ ] Arquivo temporario para diff criado em `os.tmpdir()` e removido apos decisao
- [ ] Teste unitario: handler aceita/rejeita corretamente (mock de vscode.diff)

### REQ-06: Confirmacao interativa para run_command

- [ ] `validateCommand()` chamado ANTES de `execSync` no `handleToolCall`
- [ ] Resultado `blocked`: rejeita imediatamente, retorna erro ao agente, loga no action log
- [ ] Resultado `destructive`: popup com comando completo, opcoes "Executar" / "Bloquear"
- [ ] Resultado `moderate` e `safe`: executa conforme configuracao
- [ ] Configuracao `thinkcoffee.commandConfirmation`: `always`, `destructive-only`, `never`
- [ ] Default: `destructive-only`
- [ ] Timeout de 60s no popup -- se nao responder, bloqueia
- [ ] Action log registra: comando, resultado da validacao, decisao do usuario (accept/reject/timeout)
- [ ] Teste unitario: validacao + confirmacao funciona nos 3 modos

### REQ-07: safePath centralizado

- [ ] Funcao `safePath(root: string, relativePath: string): string` em `packages/core/src/utils/safe-path.ts`
- [ ] Usa `path.normalize` e `path.resolve` antes de comparar
- [ ] Retorna path absoluto seguro ou lanca `Error("Path traversal denied")`
- [ ] Trata corretamente separadores Windows (`\`) e Unix (`/`)
- [ ] Trata corretamente `..`, `.`, caminhos absolutos, e drives diferentes no Windows
- [ ] Exportada via `packages/core/src/index.ts`
- [ ] AgentService importa e usa no lugar da verificacao inline
- [ ] MCP server importa e usa no lugar da funcao local
- [ ] Testes: `../../../etc/passwd`, `C:\Windows\System32`, `//server/share`, paths com unicode, paths com spaces

### REQ-08: Tools extraidas para o Core

- [ ] Diretorio `packages/core/src/tools/` com: `read-file.ts`, `write-file.ts`, `list-files.ts`, `search-code.ts`, `run-command.ts`, `index.ts`
- [ ] Cada tool eh uma funcao pura: `(workspace: string, input: ToolInput) => Promise<ToolResult>`
- [ ] `ToolResult`: `{ success: boolean, output: string, filesAffected?: string[], error?: string }`
- [ ] Todas usam `safePath` do core
- [ ] AgentService e MCP importam e delegam ao core
- [ ] Comportamento identico entre AgentService e MCP (testes de paridade)
- [ ] Teste unitario para cada tool individualmente

### REQ-09: Snapshot Garbage Collector

- [ ] `SnapshotService.cleanup()` remove snapshots com mais de N dias
- [ ] Configuracao em `~/.thinkcoffee/snapshot-config.json`: `{ "retentionDays": 7, "maxSizeMB": 50 }`
- [ ] Se configuracao nao existe: usa defaults (7 dias, 50MB)
- [ ] Executa na ativacao do VS Code extension
- [ ] Executa a cada 24h via `setInterval`
- [ ] Log no console: "Snapshot cleanup: removed N snapshots (X MB freed)"
- [ ] Nunca remove snapshot de pipeline ativo (`status: "active"`)
- [ ] Teste unitario: cleanup remove corretamente e preserva os ativos

### REQ-10: Testes

- [ ] `ActionLogService.test.ts` com >= 80% cobertura
- [ ] `SnapshotService.test.ts` com >= 80% cobertura
- [ ] `RollbackService.test.ts` com >= 80% cobertura
- [ ] `safe-path.test.ts` com >= 80% cobertura
- [ ] `dry-run.test.ts` (integracao) com fluxo completo
- [ ] Todos os testes usam `vi.mock('fs')` e `vi.mock('os')` (sem I/O real)
- [ ] Teste de integracao: pipeline dry-run -> acoes coletadas -> resumo correto
- [ ] Teste de integracao: pipeline real -> snapshot -> rollback -> estado restaurado
- [ ] `pnpm test` passa sem erros
- [ ] Nenhum teste depende de rede ou filesystem real

---

## 5. User Stories

### US-01: Log de acoes de agentes

**Como** desenvolvedor,
**quero** que todas as acoes executadas por agentes sejam registradas em um log estruturado,
**para que** eu possa auditar o que cada agente fez, quando, e em quais arquivos.

**Criterios**: REQ-01
**Prioridade**: P0

---

### US-02: Snapshot automatico antes de modificacoes

**Como** desenvolvedor,
**quero** que o sistema salve automaticamente uma copia dos meus arquivos antes de qualquer agente modifica-los,
**para que** eu tenha garantia de poder recuperar meu codigo original se algo der errado.

**Criterios**: REQ-02
**Prioridade**: P0

---

### US-03: Rollback de fase do pipeline

**Como** desenvolvedor,
**quero** reverter todas as mudancas feitas por uma fase do pipeline com um unico comando,
**para que** quando um agente cometer um erro, eu possa voltar ao estado anterior em segundos.

**Criterios**: REQ-03
**Prioridade**: P0

---

### US-04: Dry-Run para simular pipeline

**Como** desenvolvedor,
**quero** rodar o pipeline em modo simulacao (dry-run),
**para que** eu possa revisar o que os agentes fariam antes de autorizar modificacoes no meu codigo.

**Criterios**: REQ-04
**Prioridade**: P0

---

### US-05: Preview de diff antes de gravar arquivo

**Como** desenvolvedor,
**quero** ver uma comparacao visual (diff) do que o agente quer mudar antes que o arquivo seja gravado,
**para que** eu mantenha controle total sobre cada alteracao no meu codigo e possa aceitar ou rejeitar individualmente.

**Criterios**: REQ-05
**Prioridade**: P1

---

### US-06: Confirmacao antes de comandos perigosos

**Como** desenvolvedor,
**quero** que o sistema me pergunte antes de executar comandos shell classificados como destrutivos,
**para que** eu nao perca dados ou quebre meu ambiente por uma acao automatica de um agente.

**Criterios**: REQ-06
**Prioridade**: P1

---

### US-07: Protecao contra path traversal

**Como** desenvolvedor,
**quero** que agentes sejam impedidos de acessar arquivos fora do meu workspace,
**para que** meus dados pessoais e do sistema estejam protegidos mesmo que o agente tente acessar caminhos maliciosos.

**Criterios**: REQ-07
**Prioridade**: P1

---

### US-08: Tools unificadas entre VSCode e MCP

**Como** contribuidor do ThinkCoffee,
**quero** que a logica das tools (read_file, write_file, etc.) esteja centralizada no core,
**para que** bugs corrigidos em um lugar se propaguem automaticamente para VSCode e MCP, reduzindo duplicacao.

**Criterios**: REQ-08
**Prioridade**: P2

---

### US-09: Limpeza automatica de snapshots antigos

**Como** desenvolvedor,
**quero** que snapshots antigos sejam removidos automaticamente,
**para que** o disco nao encha com backups obsoletos.

**Criterios**: REQ-09
**Prioridade**: P2

---

### US-10: Testes robustos para a safety net

**Como** contribuidor do ThinkCoffee,
**quero** que todos os novos modulos de seguranca (log, snapshot, rollback, dry-run, safePath) tenham cobertura de testes >= 80%,
**para que** eu tenha confianca de que o sistema de protecao funciona corretamente.

**Criterios**: REQ-10
**Prioridade**: P1

---

## 6. Backlog Priorizado

| # | Sprint | ID | User Story | Prioridade | Estimativa | Agentes |
|---|---|---|---|---|---|---|
| 1 | S1 | REQ-07 | US-07 -- safePath centralizado | P1 | S (1-2d) | @backend |
| 2 | S1 | REQ-01 | US-01 -- Tool Action Log | P0 | S (1-2d) | @backend |
| 3 | S1 | REQ-02 | US-02 -- Snapshot Service | P0 | M (3-5d) | @backend |
| 4 | S1 | REQ-03 | US-03 -- Rollback Command | P0 | M (3-5d) | @backend |
| 5 | S2 | REQ-04 | US-04 -- Dry-Run Mode | P0 | M (3-5d) | @backend, @frontend |
| 6 | S2 | REQ-06 | US-06 -- Confirmacao de run_command | P1 | S (1-2d) | @frontend |
| 7 | S2 | REQ-05 | US-05 -- Diff Preview | P1 | M (3-5d) | @frontend |
| 8 | S2 | REQ-10 | US-10 -- Testes (parcial: S1) | P1 | L (5-8d) | @qa |
| 9 | S3 | REQ-08 | US-08 -- Tools no Core | P2 | M (3-5d) | @backend |
| 10 | S3 | REQ-09 | US-09 -- Snapshot GC | P2 | S (1-2d) | @backend |
| 11 | S3 | REQ-10 | US-10 -- Testes (parcial: S2+S3) | P1 | M (3-5d) | @qa |

### Estimativa total: 26-40 dias (3 sprints)

---

### Justificativa da ordenacao

**Sprint 1 -- Fundacao de seguranca (7-12 dias)**

1. **safePath (REQ-07)** vem primeiro porque eh uma dependencia de seguranca que todos os outros modulos usam. Corrige o SEC-02 do code review. Estimativa pequena, impacto grande.

2. **Action Log (REQ-01)** eh a fundacao de observabilidade que snapshot, rollback e dry-run precisam. Sem log, nao sabemos quais arquivos foram tocados. Tambem resolve parcialmente o V2/REQ-01 (metrics) pois registra tool calls.

3. **Snapshot (REQ-02)** depende do action log para saber quais arquivos backupear. Eh a segunda metade da rede de seguranca.

4. **Rollback (REQ-03)** depende do snapshot. Completa o ciclo de seguranca basico: agente muda -> snapshot salva -> rollback reverte.

**Sprint 2 -- UX de seguranca e dry-run (8-13 dias)**

5. **Dry-Run (REQ-04)** com a fundacao no lugar, dry-run reaproveita o action log para registrar acoes simuladas. Afeta AgentService e CLI.

6. **Confirmacao run_command (REQ-06)** conecta o command-validator (que ja existe) ao fluxo real. Estimativa pequena porque a logica de validacao ja esta pronta.

7. **Diff Preview (REQ-05)** eh a UX mais impactante para o usuario. Vem apos dry-run porque ambos afetam o `handleToolCall` -- melhor implementar juntos.

8. **Testes parciais (REQ-10)** o QA comeca a testar os modulos da Sprint 1 em paralelo com a Sprint 2.

**Sprint 3 -- Refatoracao e limpeza (5-8 dias)**

9. **Tools no Core (REQ-08)** refatoracao beneficiada pela existencia do safePath e do action log. Nao eh urgente, mas reduz divida tecnica.

10. **Snapshot GC (REQ-09)** limpeza automatica. Pode esperar porque snapshots de 7 dias sao gerenciaveis manualmente.

11. **Testes finais (REQ-10)** completar cobertura dos modulos da Sprint 2 e 3.

---

## 7. Decisoes Tecnicas

### DEC-01: Action Log em JSONL (nao SQLite)

**Decisao**: Usar formato JSON Lines (`.jsonl`) para o action log.

**Justificativa**: O log eh append-only e pode ser grande. JSONL permite:
- Append sem ler o arquivo inteiro (performance)
- Stream de leitura linha por linha
- Grep e ferramentas de linha de comando funcionam nativamente
- Sem schema migration necessaria

**Alternativas descartadas**: SQLite (overhead de conexao para append), JSON (precisa ler/parsear tudo para append), texto puro (sem estrutura).

### DEC-02: Snapshot via copia de arquivos (nao Git)

**Decisao**: Copiar arquivos afetados para `~/.thinkcoffee/snapshots/` antes de modificacao.

**Justificativa**: Mesmo que o V1 ja tenha decidido isso. Nem todo workspace tem Git. Copia simples eh previsivel, nao polui historico Git, funciona em qualquer cenario. O snapshot eh LAZY (copia antes da primeira modificacao de cada arquivo, nao tudo no inicio).

**Alternativas descartadas**: Git stash/commit temporario, symbolic links, SQLite blob.

### DEC-03: Dry-Run como flag no Pipeline (nao modo separado)

**Decisao**: `dryRun` eh uma propriedade booleana no objeto `Pipeline`, nao um modo separado.

**Justificativa**: Permite reutilizar toda a infraestrutura de pipeline existente. O agente recebe o mesmo prompt, gera o mesmo output, mas as tool calls de escrita sao interceptadas. Apos dry-run, o usuario pode "confirmar" e o pipeline roda de novo sem a flag.

### DEC-04: Diff Preview via vscode.diff API nativa

**Decisao**: Usar `vscode.commands.executeCommand('vscode.diff', ...)` para mostrar diff.

**Justificativa**: API nativa, sem dependencias adicionais. UX consistente com o que o usuario ja conhece. Funciona com qualquer tema e extensao de diff instalada.

### DEC-05: safePath no Core com export via index

**Decisao**: `packages/core/src/utils/safe-path.ts` exportando via `packages/core/src/index.ts`.

**Justificativa**: Permite que tanto o AgentService (VSCode) quanto o MCP server importem de `@thinkcoffee/core`. Single source of truth para seguranca de paths.

---

## 8. Mapa de arquivos a criar/modificar

### Novos arquivos

| Arquivo | Responsavel | Sprint |
|---|---|---|
| `packages/core/src/utils/safe-path.ts` | @backend | S1 |
| `packages/core/src/services/ActionLogService.ts` | @backend | S1 |
| `packages/core/src/services/SnapshotService.ts` | @backend | S1 |
| `packages/core/src/services/RollbackService.ts` | @backend | S1 |
| `packages/core/src/utils/__tests__/safe-path.test.ts` | @qa | S2 |
| `packages/core/src/services/__tests__/ActionLogService.test.ts` | @qa | S2 |
| `packages/core/src/services/__tests__/SnapshotService.test.ts` | @qa | S2 |
| `packages/core/src/services/__tests__/RollbackService.test.ts` | @qa | S2 |
| `packages/core/src/services/__tests__/dry-run.integration.test.ts` | @qa | S2 |
| `packages/vscode/src/utils/DiffPreviewHandler.ts` | @frontend | S2 |
| `packages/cli/src/commands/rollback.ts` | @backend | S1 |
| `packages/core/src/tools/index.ts` | @backend | S3 |
| `packages/core/src/tools/read-file.ts` | @backend | S3 |
| `packages/core/src/tools/write-file.ts` | @backend | S3 |
| `packages/core/src/tools/list-files.ts` | @backend | S3 |
| `packages/core/src/tools/search-code.ts` | @backend | S3 |
| `packages/core/src/tools/run-command.ts` | @backend | S3 |
| `packages/core/src/tools/__tests__/tools.test.ts` | @qa | S3 |

### Arquivos a modificar

| Arquivo | Mudanca | Sprint |
|---|---|---|
| `packages/core/src/pipeline.ts` | Adicionar `dryRun: boolean` ao tipo `Pipeline` | S2 |
| `packages/core/src/index.ts` | Exportar novos servicos e utils | S1 |
| `packages/vscode/src/agents/AgentService.ts` | Integrar action log, snapshot, dry-run, diff preview, confirmacao de commands, safePath | S1-S2 |
| `packages/mcp-server/src/index.ts` | Usar safePath do core em vez de funcao local | S1 |
| `packages/cli/src/index.ts` | Registrar comando `rollback` | S1 |

---

## 9. Riscos e Mitigacoes

| Risco | Probabilidade | Impacto | Mitigacao |
|---|---|---|---|
| Snapshot de arquivos grandes (>50MB) consome muito disco | Media | Medio | Limite configuravel, warning no chat, exclusao de `node_modules` e binarios |
| Diff preview interrompe fluxo do agente (esperando usuario) | Alta | Medio | Timeout de 120s, modo `never` disponivel, modo `existing-only` como default |
| Dry-run altera comportamento do agente (agente age diferente sem feedback real de tools) | Media | Alto | Documentar limitacao, tool calls de leitura funcionam normalmente |
| Rollback pode faltar no caso de crash (snapshot incompleto) | Baixa | Alto | Log de acao registra antes do snapshot, snapshot eh atomico por arquivo |
| Performance de action log em JSONL para pipelines longos | Baixa | Baixo | JSONL eh eficiente para append, leitura filtrada por phaseIndex |

---

## 10. Metricas de sucesso

| Metrica | Meta | Como medir |
|---|---|---|
| Snapshot criado para 100% das fases com write_file | 100% | Action log registra snapshot criado antes de cada escrita |
| Rollback restaura estado exato (diff zero apos rollback) | 100% | Teste de integracao compara hash antes/depois |
| Dry-run nao modifica nenhum arquivo | 100% | Teste verifica que filesystem mock nao teve writes |
| Action log registra todas as tool calls | 100% | Comparar count de tool calls no log vs total real |
| Testes novos passam no CI | 100% | `pnpm test` exit code 0 |
| Cobertura dos novos modulos | >= 80% | `vitest --coverage` |

---

## 11. Relacao com backlogs anteriores

### Itens do V2 que este backlog endereca parcialmente

| V2 Item | Como este backlog contribui |
|---|---|
| V2/REQ-01 (Pipeline Execution Metrics) | REQ-01 (Action Log) registra timing e tool calls por task -- base de dados para metricas |
| V2/REQ-02 (Pipeline History Store) | Action Log + Snapshot fornecem dados estruturados para o history store futuro |

### Itens do V2 que PERMANECEM pendentes para V4

| V2 Item | Prioridade sugerida para V4 |
|---|---|
| V2/REQ-02 -- Pipeline History Store | P0 |
| V2/REQ-03 -- Comando /history | P0 |
| V2/REQ-04 -- Pipeline Cost Tracker | P1 |
| V2/REQ-05 -- Cost Budget & Alerts | P1 |
| V2/REQ-06 -- Pipeline History Export | P2 |
| V2/REQ-07 -- Pipeline Comparison View | P2 |

### Itens do V1 que este backlog RESOLVE

| V1 Item | Status neste backlog |
|---|---|
| V1/REQ-01 -- Dry-Run Mode | REQ-04 (implementacao completa) |
| V1/REQ-02 -- Snapshot | REQ-02 (implementacao completa) |
| V1/REQ-03 -- Rollback | REQ-03 (implementacao completa) |
| V1/REQ-04 -- Confirmacao interativa | REQ-06 (implementacao completa, integra command-validator) |
| V1/REQ-05 -- Diff Preview | REQ-05 (implementacao completa) |

---

## 12. Proximos passos

1. **@architect**: Detalhar a arquitetura tecnica do ActionLogService, SnapshotService e RollbackService. Definir interfaces exatas, fluxo de dados, e integracao com o AgentService.
2. **@backend**: Implementar `safe-path.ts` no core como primeira tarefa (desbloqueia tudo).
3. **@backend**: Implementar `ActionLogService` e `SnapshotService`.
4. **@backend**: Implementar `RollbackService` e comando CLI `think rollback`.
5. **@frontend**: Implementar `DiffPreviewHandler` e integracao com confirmacao de commands no VS Code.
6. **@qa**: Iniciar testes dos modulos da Sprint 1 assim que forem entregues.
7. **@devops**: Verificar se CI roda os novos testes corretamente.
