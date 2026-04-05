# ThinkCoffee -- Sprint Plan V3: Agent Safety Net

> Feature: Agent Safety Net (Dry-Run, Snapshot & Rollback)
> Versao: 3.0
> Referencia: PM-BACKLOG-V3.md, PM-USER-STORIES-V3.md

---

## Sprint 1: Fundacao de Seguranca

**Duracao estimada**: 7-12 dias
**Objetivo**: Construir o alicerce da rede de seguranca -- safePath corrigido, action log, snapshot, e rollback.

### Tasks

| Task | Responsavel | Estimativa | Dependencia | Entregavel |
|---|---|---|---|---|
| S1-01: Criar `safePath()` em `packages/core/src/utils/safe-path.ts` | @backend | 1d | -- | Funcao centralizada com normalize+resolve, testes para Win/Unix |
| S1-02: Substituir verificacao inline no AgentService pelo safePath do core | @backend | 0.5d | S1-01 | AgentService importa de `@thinkcoffee/core` |
| S1-03: Substituir `safePath` local no MCP server pelo core | @backend | 0.5d | S1-01 | MCP importa de `@thinkcoffee/core` |
| S1-04: Exportar safePath via `packages/core/src/index.ts` | @backend | 0.25d | S1-01 | Disponivel para todos os pacotes |
| S1-05: Criar `ActionLogService` em `packages/core/src/services/` | @backend | 1.5d | -- | Servico com log/getByPipeline/getByPhase/getFileActions |
| S1-06: Instrumentar `handleToolCall()` no AgentService para registrar no action log | @backend | 1d | S1-05 | Cada tool call gera entrada no log |
| S1-07: Criar `SnapshotService` em `packages/core/src/services/` | @backend | 3d | S1-05 | Servico com snapshotFile/getSnapshot/listSnapshots/deleteSnapshot |
| S1-08: Integrar SnapshotService no `handleToolCall` (write_file, delete_file) | @backend | 1d | S1-07 | Snapshot automatico antes de escrita |
| S1-09: Criar `RollbackService` em `packages/core/src/services/` | @backend | 2d | S1-07 | Servico com rollback/getStatus |
| S1-10: Criar comando `think rollback` no CLI | @backend | 1d | S1-09 | Subcomando CLI funcional |
| S1-11: Integrar `/rollback` no chat do VS Code | @frontend | 1d | S1-09 | Comando reconhecido e funcional no chat |

### Definition of Done Sprint 1

- [ ] `safePath` centralizado no core, usado por AgentService e MCP
- [ ] Testes de path traversal passam (Win/Unix)
- [ ] Action log registra todos os tool calls em JSONL
- [ ] Snapshot criado automaticamente antes de write_file/delete_file
- [ ] Rollback funciona via `/rollback` (chat) e `think rollback` (CLI)
- [ ] Rollback restaura arquivos modificados, deleta criados, restaura deletados
- [ ] Pipeline atualizado apos rollback (fase volta a in-progress)

---

## Sprint 2: Dry-Run e UX de Seguranca

**Duracao estimada**: 8-13 dias
**Objetivo**: Dry-run mode, diff preview, confirmacao de comandos, e testes dos modulos Sprint 1.

### Tasks

| Task | Responsavel | Estimativa | Dependencia | Entregavel |
|---|---|---|---|---|
| S2-01: Adicionar `dryRun: boolean` ao tipo Pipeline e PipelineService | @backend | 0.5d | -- | Campo no tipo, persistido no JSON |
| S2-02: Implementar logica de dry-run no `handleToolCall` | @backend | 2d | S2-01, S1-05 | Tools de escrita simuladas, leitura normal |
| S2-03: Flag `--dry-run` no CLI (`think pipeline run`) | @backend | 0.5d | S2-01 | Flag aceita e propagada |
| S2-04: Label `[DRY-RUN]` no chat e resumo ao final | @frontend | 1d | S2-02 | Mensagens marcadas, resumo de acoes planejadas |
| S2-05: Botao "Executar de verdade" apos dry-run no VS Code | @frontend | 0.5d | S2-04 | Link/botao funcional |
| S2-06: Criar `DiffPreviewHandler` em `packages/vscode/src/utils/` | @frontend | 2d | -- | Handler com accept/reject/timeout |
| S2-07: Integrar DiffPreviewHandler no `handleToolCall` (write_file) | @frontend | 1d | S2-06 | Diff automatico para arquivos existentes |
| S2-08: Configuracao `thinkcoffee.diffPreview` (always/existing-only/never) | @frontend | 0.5d | S2-06 | Setting registrado e funcional |
| S2-09: Integrar `validateCommand()` no `handleToolCall` (run_command) | @backend | 1d | S1-05 | Bloqueio/confirmacao antes de execSync |
| S2-10: Popup de confirmacao para comandos destrutivos no VS Code | @frontend | 1d | S2-09 | Popup com Executar/Bloquear e timeout |
| S2-11: Configuracao `thinkcoffee.commandConfirmation` (always/destructive-only/never) | @frontend | 0.5d | S2-09 | Setting registrado e funcional |
| S2-12: Testes unitarios -- `safe-path.test.ts` | @qa | 1d | S1-01 | >= 80% cobertura |
| S2-13: Testes unitarios -- `ActionLogService.test.ts` | @qa | 1.5d | S1-05 | >= 80% cobertura |
| S2-14: Testes unitarios -- `SnapshotService.test.ts` | @qa | 2d | S1-07 | >= 80% cobertura |
| S2-15: Testes unitarios -- `RollbackService.test.ts` | @qa | 1.5d | S1-09 | >= 80% cobertura |

### Definition of Done Sprint 2

- [ ] Dry-run mode funciona via CLI (`--dry-run`) e programaticamente
- [ ] Tools de leitura funcionam em dry-run, escrita eh simulada
- [ ] Chat mostra `[DRY-RUN]` e resumo de acoes planejadas
- [ ] Diff preview funciona para write_file em arquivos existentes
- [ ] Usuario pode aceitar/rejeitar cada escrita via diff
- [ ] Comandos destrutivos exigem confirmacao do usuario
- [ ] Comandos bloqueados sao rejeitados automaticamente
- [ ] Testes de safePath, ActionLog, Snapshot, Rollback com >= 80% cobertura
- [ ] `pnpm test` passa sem erros

---

## Sprint 3: Refatoracao e Completude

**Duracao estimada**: 5-8 dias
**Objetivo**: Extrair tools para o core, snapshot garbage collector, testes de integracao finais.

### Tasks

| Task | Responsavel | Estimativa | Dependencia | Entregavel |
|---|---|---|---|---|
| S3-01: Criar `packages/core/src/tools/read-file.ts` | @backend | 0.5d | S1-01 | Tool centralizada |
| S3-02: Criar `packages/core/src/tools/write-file.ts` | @backend | 0.5d | S1-01 | Tool com hooks para snapshot/log |
| S3-03: Criar `packages/core/src/tools/list-files.ts` | @backend | 0.5d | S1-01 | Tool centralizada |
| S3-04: Criar `packages/core/src/tools/search-code.ts` | @backend | 0.5d | S1-01 | Tool centralizada |
| S3-05: Criar `packages/core/src/tools/run-command.ts` | @backend | 0.5d | S1-01 | Tool com hook para command-validator |
| S3-06: Criar `packages/core/src/tools/index.ts` com barrel export | @backend | 0.25d | S3-01 a S3-05 | Exporta todas as tools |
| S3-07: Refatorar AgentService para usar tools do core | @backend | 1d | S3-06 | Delegacao completa, remover logica inline |
| S3-08: Refatorar MCP server para usar tools do core | @backend | 1d | S3-06 | Delegacao completa, remover logica duplicada |
| S3-09: Implementar `SnapshotService.cleanup()` (garbage collector) | @backend | 1d | S1-07 | Limpeza por idade e tamanho |
| S3-10: Hook de cleanup na ativacao do VS Code e setInterval 24h | @frontend | 0.5d | S3-09 | Executa ao ativar e periodicamente |
| S3-11: Testes de integracao -- dry-run pipeline completo | @qa | 1.5d | Sprint 2 | Fluxo completo simulado |
| S3-12: Testes de integracao -- snapshot + rollback | @qa | 1.5d | Sprint 1, Sprint 2 | Hash antes/depois identico |
| S3-13: Testes de paridade -- tools AgentService vs MCP | @qa | 1d | S3-07, S3-08 | Mesmo input -> mesmo output |
| S3-14: Testes unitarios -- tools individuais | @qa | 1d | S3-06 | >= 80% cobertura |

### Definition of Done Sprint 3

- [ ] Todas as tools centralizadas em `packages/core/src/tools/`
- [ ] AgentService e MCP usam tools do core (sem duplicacao)
- [ ] Snapshot garbage collector funciona (por idade e tamanho)
- [ ] Cleanup roda ao ativar VS Code e a cada 24h
- [ ] Testes de integracao passam (dry-run, snapshot+rollback)
- [ ] Testes de paridade confirmam comportamento identico entre AgentService e MCP
- [ ] `pnpm test` passa sem erros
- [ ] Feature completa entregue

---

## Resumo de Estimativas

| Sprint | Estimativa | Backend | Frontend | QA |
|---|---|---|---|---|
| Sprint 1 | 7-12 dias | 10.75d | 1d | -- |
| Sprint 2 | 8-13 dias | 4d | 5.5d | 6d |
| Sprint 3 | 5-8 dias | 5.75d | 0.5d | 5d |
| **Total** | **20-33 dias** | **20.5d** | **7d** | **11d** |

**Nota**: Backend concentra Sprint 1 (fundacao). Frontend concentra Sprint 2 (UX). QA concentra Sprint 2-3 (testes). As estimativas de backend e QA sao concorrentes em Sprint 2-3.

---

## Dependencias entre Tasks (Grafo Critico)

```
safePath (S1-01)
  |
  +-> AgentService update (S1-02)
  +-> MCP update (S1-03)
  +-> ActionLog (S1-05)
  |     |
  |     +-> handleToolCall instrumentado (S1-06)
  |     +-> Snapshot (S1-07)
  |     |     |
  |     |     +-> Snapshot no handleToolCall (S1-08)
  |     |     +-> Rollback (S1-09)
  |     |     |     |
  |     |     |     +-> CLI rollback (S1-10)
  |     |     |     +-> Chat rollback (S1-11)
  |     |     |
  |     |     +-> Snapshot GC (S3-09)
  |     |
  |     +-> Dry-Run (S2-01 -> S2-02 -> S2-03 -> S2-04 -> S2-05)
  |     +-> Command confirm (S2-09 -> S2-10 -> S2-11)
  |
  +-> Tools centralizadas (S3-01..S3-08)

DiffPreview (S2-06 -> S2-07 -> S2-08) -- independente do caminho critico
Testes (S2-12..S2-15, S3-11..S3-14) -- dependem das implementacoes
```

---

## Metricas de Sucesso

| Metrica | Meta | Como Medir |
|---|---|---|
| Snapshot criado para 100% dos write_file em arquivos existentes | 100% | Action log registra snapshot antes de cada escrita |
| Rollback restaura estado exato (hash identico) | 100% | Teste de integracao compara SHA-256 |
| Dry-run nao modifica nenhum arquivo | 100% | Mock verifica zero writes |
| Action log registra 100% dos tool calls | 100% | Comparar count com total real |
| Comandos blocked rejeitados automaticamente | 100% | Teste contra lista de blocked patterns |
| safePath bloqueia 100% dos path traversals testados | 100% | Suite de testes com edge cases |
| Cobertura testes novos modulos | >= 80% | `vitest --coverage` |
| `pnpm test` green | 100% | Exit code 0 no CI |

---

## Definicao de Pronto (Feature-level)

A feature "Agent Safety Net" sera considerada COMPLETA quando:

1. Todas as tool calls de agentes sao registradas no action log
2. Arquivos sao automaticamente backupeados antes de modificacao
3. Rollback restaura o workspace ao estado pre-fase com um comando
4. Dry-run permite simular o pipeline sem efeitos colaterais
5. Diff preview mostra mudancas antes de gravar (configuravel)
6. Comandos destrutivos exigem confirmacao (configuravel)
7. Path traversal eh bloqueado consistentemente em VSCode e MCP
8. Tools estao centralizadas no core (sem duplicacao)
9. Snapshots antigos sao limpos automaticamente
10. Cobertura de testes >= 80% em todos os novos modulos
11. `pnpm test` passa sem erros
12. Code Review (SEC-01, SEC-02) resolvidos
