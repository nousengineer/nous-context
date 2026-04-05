# ThinkCoffee -- Product Backlog & Requirements

> Gerado pelo agente Product Manager | Pipeline: "definir proxima feature"

---

## 1. Analise do Estado Atual

### O que ja existe

| Capacidade | Status | Onde |
|---|---|---|
| CRUD de projetos, contexto e decisoes | Completo | `core`, `cli`, `mcp-server` |
| Export para Copilot, Claude, Cursor, JSON, Markdown, Plain | Completo | `core/export` |
| MCP Server com tools + resources + prompts | Completo | `mcp-server` |
| CLI (`think`) com todos os comandos | Completo | `cli` |
| Extensao VS Code com sidebar chat | Completo | `vscode` |
| Pipeline multi-agente (PM, Architect, Backend, Frontend, DevOps, QA, Code Review) | Completo | `core/pipeline`, `vscode/agents` |
| Quality Presets (cafe-soluvel, coado-com-carinho, espresso-duplo) | Completo | `core/agent-config` |
| Auto-assign de modelos via PM Opus | Completo | `vscode/agents/AgentService` |
| Templates de projeto (flutter, backend-api, artigo-academico, electron, visual-novel) | Completo | `mcp-server` |
| Chat com @mentions de agentes e ferramentas (@gh, @terminal, @files) | Completo | `vscode/chat` |
| API Key management | Completo | `core/services/ApiKeyService` |
| Workspace auto-bind | Completo | `vscode/extension` |
| File tools no MCP (read, write, list, search, tree, diff, patch, move, delete, bulk) | Completo | `mcp-server` |

### Lacunas identificadas

| Lacuna | Impacto | Prioridade |
|---|---|---|
| Sem testes unitarios (apenas 1 script de integracao) | Alto -- regressoes silenciosas | Alta |
| Pipeline nao persiste historico entre sessoes de forma consultavel | Medio -- perde aprendizados | Media |
| Sem mecanismo de rollback/undo para acoes de agentes (write_file, run_command) | Alto -- risco em producao | Alta |
| Sem dashboard/overview de multiplos projetos no VS Code | Medio -- UX fragmentada | Media |
| Sem notificacoes push quando MCP/Claude Desktop posta no chat | Baixo -- usuario precisa olhar | Baixa |
| Sem metricas de uso dos agentes (tokens consumidos, tempo, sucesso/falha) | Medio -- sem visibilidade de custo | Media |
| Sem suporte a branches/versionamento de contexto | Medio -- contexto muda com o tempo | Media |
| Sem onboarding guiado na extensao VS Code | Medio -- barreira de entrada | Media |

---

## 2. Requisitos Estruturados -- Proxima Feature

### Feature Principal: **Agent Guardrails & Undo System**

**Justificativa**: Os agentes podem executar `write_file`, `run_command`, `delete_file` no workspace. Hoje nao existe nenhum mecanismo de seguranca, preview ou rollback. Isso eh o maior risco operacional do produto.

---

### REQ-01: Dry-Run Mode para Agentes

**Descricao**: Permitir que o pipeline rode em modo "dry-run", onde agentes geram suas saidas e listam as acoes que fariam (arquivos que criariam/modificariam, comandos que rodariam) sem executar nada.

**Categorias afetadas**: `core/pipeline`, `vscode/agents/AgentService`

| Campo | Detalhe |
|---|---|
| Tipo | Funcional |
| Prioridade | P0 -- Critica |
| Estimativa | M (media -- 3-5 dias) |
| Dependencias | Nenhuma |

### REQ-02: Snapshot antes de execucao

**Descricao**: Antes de qualquer fase do pipeline executar acoes destrutivas (write_file, delete_file, run_command), salvar um snapshot dos arquivos afetados em `~/.thinkcoffee/snapshots/<pipelineId>/<phaseId>/`.

| Campo | Detalhe |
|---|---|
| Tipo | Funcional |
| Prioridade | P0 -- Critica |
| Estimativa | M (media -- 3-5 dias) |
| Dependencias | Nenhuma |

### REQ-03: Comando de Rollback

**Descricao**: Comando `/rollback` no chat e `think rollback <pipelineId>` no CLI que restaura o workspace ao estado pre-execucao da fase atual usando o snapshot.

| Campo | Detalhe |
|---|---|
| Tipo | Funcional |
| Prioridade | P0 -- Critica |
| Estimativa | S (small -- 1-2 dias) |
| Dependencias | REQ-02 |

### REQ-04: Confirmacao interativa para operacoes destrutivas

**Descricao**: Quando o agente invoca `run_command` com comandos potencialmente destrutivos (delete, rm, drop, format, etc.) ou `delete_file`, exibir popup de confirmacao no VS Code antes de executar. Configuravel: `always`, `destructive-only`, `never`.

| Campo | Detalhe |
|---|---|
| Tipo | Funcional |
| Prioridade | P1 -- Alta |
| Estimativa | S (small -- 1-2 dias) |
| Dependencias | Nenhuma |

### REQ-05: Diff Preview antes de write_file

**Descricao**: Quando um agente chama `write_file` em um arquivo existente, mostrar diff inline no VS Code (similar ao Git diff) e aguardar aprovacao do usuario antes de gravar. Novo arquivo: gravar direto com marcacao visual.

| Campo | Detalhe |
|---|---|
| Tipo | Funcional |
| Prioridade | P1 -- Alta |
| Estimativa | M (media -- 3-5 dias) |
| Dependencias | Nenhuma |

### REQ-06: Metricas de execucao de agentes

**Descricao**: Registrar para cada task de pipeline: tempo total, quantidade de tool calls, arquivos criados/modificados, erros. Persistir em `~/.thinkcoffee/metrics/`. Exibir resumo no chat ao fim de cada fase.

| Campo | Detalhe |
|---|---|
| Tipo | Funcional |
| Prioridade | P2 -- Media |
| Estimativa | M (media -- 3-5 dias) |
| Dependencias | Nenhuma |

### REQ-07: Suite de testes unitarios com Vitest

**Descricao**: Cobertura minima de 80% para `packages/core` (services, entities, export, pipeline, validation). Inclui testes de: CRUD de todas as entidades, exportacao em todos os formatos, criacao/avanco/rejeicao de pipeline, validacao de schemas.

| Campo | Detalhe |
|---|---|
| Tipo | Nao-funcional (Qualidade) |
| Prioridade | P1 -- Alta |
| Estimativa | L (large -- 5-8 dias) |
| Dependencias | Vitest ja esta no stack |

---

## 3. Criterios de Aceite

### REQ-01: Dry-Run Mode

- [ ] Flag `--dry-run` disponivel no CLI para `think pipeline run`
- [ ] Flag `dryRun: boolean` no `PipelineService.runPhase()`
- [ ] Em modo dry-run, nenhum arquivo eh criado/modificado/deletado no workspace
- [ ] Em modo dry-run, nenhum comando shell eh executado
- [ ] Output do agente lista todas as acoes planejadas com path e descricao
- [ ] Chat exibe label "[DRY-RUN]" em todas as mensagens do agente
- [ ] Teste unitario: pipeline em dry-run nao altera filesystem (mock FS)

### REQ-02: Snapshot

- [ ] Antes de `write_file` em arquivo existente, copia original para `~/.thinkcoffee/snapshots/<pipelineId>/<phaseId>/<relativePath>`
- [ ] Antes de `delete_file`, copia arquivo para snapshot
- [ ] Snapshot inclui metadado JSON: `{ timestamp, files: [{ path, action, originalHash }] }`
- [ ] Tamanho maximo de snapshot: 50MB por fase (configurable). Acima disso, warning no chat
- [ ] Snapshot eh limpo apos 7 dias (configurable) por garbage collector
- [ ] Teste unitario: snapshot salva e restaura corretamente

### REQ-03: Rollback

- [ ] Comando `/rollback` no chat restaura todos os arquivos da fase atual ao estado do snapshot
- [ ] Comando `think rollback <pipelineId>` no CLI faz o mesmo
- [ ] Arquivos criados pelo agente (que nao existiam antes) sao deletados no rollback
- [ ] Pipeline volta ao status `in-progress` da fase revertida
- [ ] Confirmacao exigida antes de executar rollback
- [ ] Teste unitario: rollback restaura estado exato

### REQ-04: Confirmacao interativa

- [ ] Configuracao `thinkcoffee.confirmMode` com opcoes: `always`, `destructive-only`, `never`
- [ ] Default: `destructive-only`
- [ ] Popup mostra: agente, comando/acao, path afetado
- [ ] Timeout de 60s -- se usuario nao responder, cancela a acao
- [ ] Teste unitario: mock de confirmacao funciona nos 3 modos

### REQ-05: Diff Preview

- [ ] Usa `vscode.diff` API para mostrar original vs proposto
- [ ] Botoes "Aceitar" e "Rejeitar" na notificacao
- [ ] Se rejeitado, agente recebe feedback "write_file rejected by user"
- [ ] Novos arquivos: mostrados como "new file" sem diff
- [ ] Teste unitario: diff handler aceita/rejeita corretamente

### REQ-06: Metricas

- [ ] Arquivo `~/.thinkcoffee/metrics/<pipelineId>.json` com array de entries por task
- [ ] Cada entry: `{ taskId, agent, startedAt, completedAt, durationMs, toolCalls, filesModified, errors }`
- [ ] Chat exibe resumo ao fim da fase: "Backend: 45s, 12 tool calls, 3 arquivos. QA: 30s, 8 tool calls, 0 erros."
- [ ] Comando `/metrics` no chat para ver metricas do pipeline ativo
- [ ] Teste unitario: metricas persistem e agregam corretamente

### REQ-07: Testes unitarios

- [ ] Vitest configurado no root e em `packages/core`
- [ ] `pnpm test` roda unit + integration
- [ ] Cobertura >= 80% para `packages/core/src/services/*`
- [ ] Cobertura >= 80% para `packages/core/src/export/*`
- [ ] Cobertura >= 80% para `packages/core/src/pipeline.ts`
- [ ] Cobertura >= 80% para `packages/core/src/validation/*`
- [ ] CI-ready: testes rodam sem banco externo (SQLite in-memory)
- [ ] Nenhum teste depende de rede ou filesystem real (mocks)

---

## 4. User Stories

### US-01: Dry-Run de Pipeline
**Como** desenvolvedor,
**quero** rodar o pipeline em modo dry-run,
**para que** eu possa revisar o que os agentes fariam antes de qualquer modificacao ao meu codigo.

### US-02: Snapshot automatico
**Como** desenvolvedor,
**quero** que o sistema salve automaticamente o estado dos meus arquivos antes dos agentes modificarem,
**para que** eu tenha garantia de poder voltar atras.

### US-03: Rollback de fase
**Como** desenvolvedor,
**quero** reverter todas as mudancas feitas por uma fase do pipeline com um unico comando,
**para que** eu possa corrigir rapidamente quando o agente erra.

### US-04: Confirmacao de operacoes perigosas
**Como** desenvolvedor,
**quero** ser perguntado antes de o agente executar comandos destrutivos,
**para que** eu nao perca dados por uma acao automatica.

### US-05: Preview de diff antes de gravar
**Como** desenvolvedor,
**quero** ver uma comparacao do que o agente quer mudar antes que o arquivo seja gravado,
**para que** eu mantenha controle sobre cada alteracao no meu codigo.

### US-06: Metricas de execucao
**Como** tech lead,
**quero** ver quanto tempo cada agente levou, quantos tool calls fez e quantos arquivos alterou,
**para que** eu possa avaliar eficiencia e custo do pipeline.

### US-07: Testes unitarios robustos
**Como** contribuidor do projeto,
**quero** uma suite de testes com cobertura >= 80% no core,
**para que** eu possa fazer refactoring com confianca.

---

## 5. Backlog Priorizado

| # | ID | User Story | Prioridade | Estimativa | Sprint sugerida | Agentes envolvidos |
|---|---|---|---|---|---|---|
| 1 | REQ-07 | US-07 -- Suite de testes unitarios | P1 | L (5-8d) | Sprint 1 | @qa |
| 2 | REQ-02 | US-02 -- Snapshot automatico | P0 | M (3-5d) | Sprint 1 | @backend |
| 3 | REQ-03 | US-03 -- Rollback de fase | P0 | S (1-2d) | Sprint 1 | @backend |
| 4 | REQ-01 | US-01 -- Dry-Run mode | P0 | M (3-5d) | Sprint 2 | @backend, @frontend |
| 5 | REQ-04 | US-04 -- Confirmacao interativa | P1 | S (1-2d) | Sprint 2 | @frontend |
| 6 | REQ-05 | US-05 -- Diff Preview | P1 | M (3-5d) | Sprint 2 | @frontend |
| 7 | REQ-06 | US-06 -- Metricas de execucao | P2 | M (3-5d) | Sprint 3 | @backend, @frontend |

### Justificativa da ordenacao

1. **Testes primeiro** (REQ-07): Precisamos de testes antes de implementar features novas. Qualquer mudanca no `core` sem testes eh risco de regressao. O projeto ja usa Vitest no stack mas nao tem nenhum teste unitario.

2. **Snapshot + Rollback** (REQ-02 + REQ-03): Sao a fundacao do sistema de seguranca. Sem isso, nao podemos implementar dry-run nem diff preview com confianca. O rollback depende do snapshot, mas ambos sao pequenos e podem ir na mesma sprint.

3. **Dry-Run** (REQ-01): Com snapshot e testes no lugar, dry-run eh seguro de implementar. Afeta `PipelineService` e `AgentService`.

4. **Confirmacao + Diff Preview** (REQ-04 + REQ-05): UX features que dependem do framework de seguranca ja existir. Sao independentes entre si e podem ser paralelizadas.

5. **Metricas** (REQ-06): Nice-to-have comparado com seguranca. Vai na Sprint 3.

---

## 6. Decisoes Tecnicas Propostas

### DEC-01: Snapshot via copia simples (nao Git)

**Decisao**: Usar copia de arquivos para `~/.thinkcoffee/snapshots/` em vez de criar commits Git temporarios.

**Justificativa**: Nem todo workspace tem Git inicializado. Copia simples eh mais previsivel, nao polui historico Git do usuario, e funciona em qualquer cenario.

**Alternativas descartadas**: Git stash (depende de Git), symbolic links (complexidade), SQLite blob storage (performance ruim para arquivos grandes).

### DEC-02: Diff via VS Code API nativa

**Decisao**: Usar `vscode.commands.executeCommand('vscode.diff', ...)` para mostrar diff ao usuario.

**Justificativa**: API nativa, sem dependencias adicionais, UX consistente com o que o usuario ja conhece no VS Code.

### DEC-03: Metricas em JSON local (nao banco)

**Decisao**: Persistir metricas em `~/.thinkcoffee/metrics/<pipelineId>.json` em vez de adicionar tabela no SQLite.

**Justificativa**: Metricas sao append-only e podem ficar grandes. JSON local eh simples de implementar, facil de limpar, e nao afeta performance do banco principal.

---

## 7. Proximos Passos

1. Validar este backlog com o time
2. @architect deve detalhar a estrutura tecnica do sistema de snapshots e dry-run
3. @qa deve iniciar a configuracao do Vitest e primeiros testes do `packages/core`
4. @backend deve implementar o `SnapshotService` no `packages/core`
5. @frontend deve projetar a UX de confirmacao e diff preview na extensao VS Code
