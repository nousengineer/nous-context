# ThinkCoffee -- User Stories V3: Agent Safety Net

> Feature: Agent Safety Net (Dry-Run, Snapshot & Rollback)
> Versao: 3.0
> Referencia: PM-BACKLOG-V3.md

---

## US-01: Log de acoes de agentes

**Como** desenvolvedor,
**quero** que todas as acoes executadas por agentes sejam registradas em um log estruturado,
**para que** eu possa auditar o que cada agente fez, quando, e em quais arquivos.

### Cenarios de aceite

**Cenario 1: Tool call de leitura registrado**
- Dado que o agente backend esta executando uma task
- Quando chama `read_file("src/index.ts")`
- Entao uma entrada eh registrada no log com: timestamp, agent=backend, tool=read_file, input={path: "src/index.ts"}, success=true, durationMs
- E o arquivo de log esta em `~/.thinkcoffee/logs/<projectId>/<pipelineId>.jsonl`

**Cenario 2: Tool call de escrita registrado com arquivos afetados**
- Dado que o agente backend chama `write_file("src/new-service.ts", "...")`
- Entao a entrada no log inclui `filesAffected: ["src/new-service.ts"]`
- E inclui `result: "File written: src/new-service.ts"`

**Cenario 3: Tool call com erro registrado**
- Dado que o agente tenta ler arquivo inexistente
- Quando `read_file("src/nao-existe.ts")` falha
- Entao a entrada tem `success: false` e `result: "Error reading file: ENOENT"`

**Cenario 4: Comando shell registrado**
- Dado que o agente chama `run_command("pnpm build")`
- Entao a entrada inclui `command: "pnpm build"` e `exitCode: 0`

**Cenario 5: Consulta por pipeline**
- Dado que existem 50 entradas no log do pipeline "abc-123"
- Quando `ActionLogService.getByPipeline("abc-123")` eh chamado
- Entao retorna todas as 50 entradas ordenadas por timestamp

**Cenario 6: Consulta por fase**
- Dado que a fase 2 do pipeline teve 15 tool calls
- Quando `ActionLogService.getByPhase("abc-123", 2)` eh chamado
- Entao retorna apenas as 15 entradas da fase 2

**Cenario 7: Dry-run registrado separadamente**
- Dado que o pipeline esta em modo dry-run
- Quando agente chama `write_file` (simulado)
- Entao a entrada tem campo `dryRun: true`

### Notas tecnicas
- Formato JSONL (JSON Lines) -- uma entrada JSON por linha
- Append-only: nunca editar entradas existentes
- Instrumentar `handleToolCall()` em `AgentService.ts`
- `ActionLogService` expoe: `log()`, `getByPipeline()`, `getByPhase()`, `getFileActions()`

---

## US-02: Snapshot automatico antes de modificacoes

**Como** desenvolvedor,
**quero** que o sistema salve automaticamente uma copia dos meus arquivos antes de qualquer agente modifica-los,
**para que** eu tenha garantia de poder recuperar meu codigo original se algo der errado.

### Cenarios de aceite

**Cenario 1: Snapshot de arquivo existente antes de write_file**
- Dado que `src/service.ts` existe com conteudo "original"
- Quando o agente chama `write_file("src/service.ts", "novo conteudo")`
- Entao antes de gravar, o conteudo original eh copiado para `~/.thinkcoffee/snapshots/<pipelineId>/<phaseIndex>/src/service.ts`
- E o metadado registra `{ path: "src/service.ts", action: "modified", hash: "<sha256>", size: <bytes> }`

**Cenario 2: Snapshot de arquivo antes de delete_file**
- Dado que `src/old.ts` existe
- Quando o agente deleta o arquivo
- Entao a copia eh salva no snapshot antes da delecao
- E o metadado registra `action: "deleted"`

**Cenario 3: Arquivo novo NAO gera copia, mas registra**
- Dado que `src/new-file.ts` NAO existe
- Quando o agente chama `write_file("src/new-file.ts", "conteudo")`
- Entao nenhuma copia eh feita (nao havia arquivo original)
- Mas o metadado registra `{ path: "src/new-file.ts", action: "created" }`

**Cenario 4: Snapshot ocorre apenas uma vez por arquivo por fase**
- Dado que o agente modifica `src/index.ts` 3 vezes na mesma fase
- Entao apenas a PRIMEIRA versao original eh salva no snapshot
- E as modificacoes subsequentes NAO sobrescrevem o snapshot

**Cenario 5: Metadado do snapshot**
- Dado que a fase 2 do pipeline "abc" modificou 3 arquivos
- Quando `SnapshotService.getSnapshot("abc", 2)` eh chamado
- Entao retorna:
```json
{
  "pipelineId": "abc",
  "phaseIndex": 2,
  "phaseName": "Implementation",
  "timestamp": "2025-01-15T10:00:00Z",
  "files": [
    { "path": "src/a.ts", "action": "modified", "hash": "...", "size": 1024 },
    { "path": "src/b.ts", "action": "created" },
    { "path": "src/c.ts", "action": "deleted", "hash": "...", "size": 512 }
  ]
}
```

**Cenario 6: Warning para arquivos grandes**
- Dado que `data/dataset.json` tem 15MB
- Quando o agente tenta modifica-lo
- Entao o snapshot eh feito normalmente
- Mas uma mensagem aparece no chat: "Aviso: snapshot de data/dataset.json (15MB). Considere aumentar o limite em snapshot-config.json."

### Notas tecnicas
- Snapshot eh LAZY: copia ANTES da primeira escrita de cada arquivo (nao snapshot tudo no inicio)
- Local: `~/.thinkcoffee/snapshots/<pipelineId>/<phaseIndex>/`
- Metadado: `snapshot.json` no mesmo diretorio
- Hash via crypto.createHash('sha256')
- Integra com `handleToolCall` no AgentService

---

## US-03: Rollback de fase do pipeline

**Como** desenvolvedor,
**quero** reverter todas as mudancas feitas por uma fase do pipeline com um unico comando,
**para que** quando um agente cometer um erro, eu possa voltar ao estado anterior em segundos.

### Cenarios de aceite

**Cenario 1: Rollback via chat -- fase atual**
- Dado que a fase 2 (Implementation) acabou de ser rejeitada
- Quando o usuario digita `/rollback` no chat
- Entao o sistema restaura todos os arquivos modificados ao estado do snapshot
- E arquivos criados pela fase sao deletados
- E arquivos deletados pela fase sao restaurados
- E a fase 2 volta para status `in-progress` com tasks `pending`

**Cenario 2: Rollback via chat -- fase especifica**
- Dado que a fase 3 esta em andamento
- Quando o usuario digita `/rollback 2` no chat
- Entao o sistema restaura os arquivos da fase 2
- E as fases 3+ sao resetadas (pois dependiam dos resultados da fase 2)

**Cenario 3: Rollback via CLI**
- Dado que o usuario esta no terminal
- Quando executa `think rollback <pipelineId>`
- Entao o mesmo comportamento do chat eh aplicado

**Cenario 4: Confirmacao antes do rollback**
- Dado que o usuario pediu rollback
- Entao o sistema exibe: "Rollback da fase 2 (Implementation). Acoes: restaurar 3 arquivos, deletar 2 arquivos criados. Confirmar? [S/N]"
- Se o usuario confirma: executa
- Se o usuario recusa: cancela

**Cenario 5: Resumo apos rollback**
- Dado que o rollback foi executado
- Entao o chat exibe: "Rollback completo. Fase 2 (Implementation): 3 arquivos restaurados, 2 arquivos criados removidos. Pipeline voltou ao inicio da fase 2."

**Cenario 6: Snapshot inexistente**
- Dado que a fase 0 (Planning) nao teve write_file
- Quando o usuario tenta `/rollback 0`
- Entao o chat exibe: "Nenhum snapshot encontrado para a fase 0 (Planning). Nenhum arquivo foi modificado nesta fase."

**Cenario 7: Rollback de arquivos deletados**
- Dado que o agente deletou `src/deprecated.ts` na fase 2
- Quando o rollback eh executado
- Entao `src/deprecated.ts` eh restaurado a partir do snapshot com o conteudo original

### Notas tecnicas
- `RollbackService` usa `SnapshotService.getSnapshot()` para obter metadado
- Para cada arquivo com `action: "modified"`: copia do snapshot de volta ao workspace
- Para cada arquivo com `action: "created"`: deleta do workspace
- Para cada arquivo com `action: "deleted"`: copia do snapshot de volta ao workspace
- Atualiza pipeline via `PipelineService`: fase volta a `in-progress`, tasks a `pending`
- Registra acao de rollback no action log

---

## US-04: Dry-Run para simular pipeline

**Como** desenvolvedor,
**quero** rodar o pipeline em modo simulacao (dry-run),
**para que** eu possa revisar o que os agentes fariam antes de autorizar modificacoes no meu codigo.

### Cenarios de aceite

**Cenario 1: Ativar dry-run via CLI**
- Dado que o usuario quer simular
- Quando executa `think pipeline run --dry-run`
- Entao o pipeline eh criado com `dryRun: true`

**Cenario 2: Leituras funcionam normalmente**
- Dado que o pipeline esta em modo dry-run
- Quando o agente chama `read_file`, `list_files` ou `search_code`
- Entao as tools executam normalmente e retornam resultados reais

**Cenario 3: Escritas sao simuladas**
- Dado que o pipeline esta em modo dry-run
- Quando o agente chama `write_file("src/new.ts", "conteudo")`
- Entao nenhum arquivo eh criado/modificado no workspace
- E o agente recebe: "DRY-RUN: Would write to src/new.ts (42 bytes)"
- E a acao eh registrada no action log com `dryRun: true`

**Cenario 4: Comandos shell sao simulados**
- Dado que o pipeline esta em modo dry-run
- Quando o agente chama `run_command("pnpm install")`
- Entao nenhum comando eh executado
- E o agente recebe: "DRY-RUN: Would execute: pnpm install"

**Cenario 5: Chat exibe label [DRY-RUN]**
- Dado que o pipeline esta em dry-run
- Quando o agente envia mensagens no chat
- Entao cada mensagem tem prefixo visual "[DRY-RUN]"

**Cenario 6: Resumo ao final do dry-run**
- Dado que o dry-run completou todas as fases
- Entao o chat exibe resumo:
```
[DRY-RUN] Pipeline completo (simulacao).
Acoes planejadas:
- 5 arquivos seriam escritos (3 novos, 2 modificados)
- 3 comandos shell seriam executados
- 0 arquivos seriam deletados
Para executar de verdade, rode novamente sem --dry-run.
```

**Cenario 7: Botao "Executar de verdade" no VS Code**
- Dado que o dry-run completou
- Quando o resumo aparece no chat
- Entao ha um botao/link "Executar pipeline (sem dry-run)" que inicia a mesma pipeline com `dryRun: false`

### Notas tecnicas
- `Pipeline.dryRun: boolean` adicionado ao tipo
- `handleToolCall` verifica `pipeline.dryRun` antes de executar tools de escrita
- Action log registra todas as acoes (inclusive simuladas)
- Resumo gerado pelo `ActionLogService.getFileActions()` ao final

---

## US-05: Preview de diff antes de gravar arquivo

**Como** desenvolvedor,
**quero** ver uma comparacao visual (diff) do que o agente quer mudar antes que o arquivo seja gravado,
**para que** eu mantenha controle total sobre cada alteracao no meu codigo e possa aceitar ou rejeitar individualmente.

### Cenarios de aceite

**Cenario 1: Diff de arquivo existente (modo existing-only)**
- Dado que `src/index.ts` existe com conteudo "A"
- E a configuracao `thinkcoffee.diffPreview` esta em `existing-only`
- Quando o agente chama `write_file("src/index.ts", "B")`
- Entao o VS Code abre um diff tab mostrando "A" vs "B"
- E uma notificacao aparece com botoes "Aceitar" e "Rejeitar"

**Cenario 2: Usuario aceita o diff**
- Dado que o diff esta aberto
- Quando o usuario clica "Aceitar"
- Entao o arquivo eh gravado com o conteudo "B"
- E o diff tab eh fechado
- E o agente recebe "File written: src/index.ts"

**Cenario 3: Usuario rejeita o diff**
- Dado que o diff esta aberto
- Quando o usuario clica "Rejeitar"
- Entao o arquivo NAO eh gravado
- E o diff tab eh fechado
- E o agente recebe "write_file rejected by user for src/index.ts"

**Cenario 4: Novo arquivo no modo existing-only**
- Dado que `src/new.ts` NAO existe
- E a configuracao esta em `existing-only`
- Quando o agente chama `write_file("src/new.ts", "conteudo")`
- Entao o arquivo eh gravado diretamente (sem diff)

**Cenario 5: Novo arquivo no modo always**
- Dado que `src/new.ts` NAO existe
- E a configuracao esta em `always`
- Quando o agente chama `write_file("src/new.ts", "conteudo")`
- Entao o VS Code abre diff de arquivo vazio vs conteudo proposto

**Cenario 6: Modo never**
- Dado que a configuracao esta em `never`
- Quando o agente chama `write_file` em qualquer arquivo
- Entao grava diretamente sem diff (comportamento atual)

**Cenario 7: Timeout**
- Dado que o diff esta aberto ha 120 segundos sem resposta
- Entao a escrita eh cancelada
- E o agente recebe "write_file cancelled: user timeout for src/index.ts"

### Notas tecnicas
- `DiffPreviewHandler` em `packages/vscode/src/utils/`
- Arquivo temporario para proposta em `os.tmpdir()`
- `vscode.commands.executeCommand('vscode.diff', uri1, uri2, title)`
- `vscode.window.showInformationMessage` com opcoes
- Timeout via `setTimeout` + `Promise.race`
- Configuracao `thinkcoffee.diffPreview`: `always` | `existing-only` | `never`

---

## US-06: Confirmacao antes de comandos perigosos

**Como** desenvolvedor,
**quero** que o sistema me pergunte antes de executar comandos shell classificados como destrutivos,
**para que** eu nao perca dados ou quebre meu ambiente por uma acao automatica de um agente.

### Cenarios de aceite

**Cenario 1: Comando bloqueado**
- Dado que o agente tenta executar `:(){ :|:& };:` (fork bomb)
- Quando `run_command` eh chamado
- Entao o comando eh bloqueado imediatamente
- E o agente recebe: "Command blocked: matches dangerous pattern"
- E o action log registra com `riskLevel: "blocked"` e `userDecision: "auto-blocked"`

**Cenario 2: Comando destrutivo com popup**
- Dado que o agente tenta executar `rm -rf /tmp/old-data`
- E a configuracao `thinkcoffee.commandConfirmation` esta em `destructive-only`
- Quando `run_command` eh chamado
- Entao o VS Code mostra popup: "Agente backend quer executar: `rm -rf /tmp/old-data` (classificado como DESTRUTIVO). Executar / Bloquear"

**Cenario 3: Usuario permite execucao**
- Dado que o popup de confirmacao esta aberto
- Quando o usuario clica "Executar"
- Entao o comando eh executado
- E o action log registra `userDecision: "accepted"`

**Cenario 4: Usuario bloqueia execucao**
- Dado que o popup de confirmacao esta aberto
- Quando o usuario clica "Bloquear"
- Entao o comando NAO eh executado
- E o agente recebe: "Command rejected by user: rm -rf /tmp/old-data"
- E o action log registra `userDecision: "rejected"`

**Cenario 5: Timeout do popup**
- Dado que o popup esta aberto ha 60 segundos sem resposta
- Entao o comando eh bloqueado por seguranca
- E o agente recebe: "Command cancelled: user timeout"

**Cenario 6: Modo always**
- Dado que `thinkcoffee.commandConfirmation` esta em `always`
- Quando o agente tenta `ls -la` (comando seguro)
- Entao o popup aparece (para qualquer comando)

**Cenario 7: Modo never**
- Dado que `thinkcoffee.commandConfirmation` esta em `never`
- Quando o agente tenta `rm -rf /` (destrutivo)
- Entao o comando ainda eh bloqueado pelo command-validator (blocked patterns)
- Mas comandos destrutivos (nao blocked) executam sem popup

### Notas tecnicas
- `validateCommand()` de `command-validator.ts` ja classifica risco
- Integrar antes de `execSync` no `handleToolCall`
- `vscode.window.showWarningMessage` para popup com opcoes
- Action log registra resultado da validacao e decisao do usuario

---

## US-07: Protecao contra path traversal

**Como** desenvolvedor,
**quero** que agentes sejam impedidos de acessar arquivos fora do meu workspace,
**para que** meus dados pessoais e do sistema estejam protegidos.

### Cenarios de aceite

**Cenario 1: Path traversal basico bloqueado**
- Dado que o workspace eh `/home/user/project`
- Quando o agente chama `read_file("../../.ssh/id_rsa")`
- Entao `safePath` lanca erro "Path traversal denied"
- E o agente recebe mensagem de erro

**Cenario 2: Path traversal Windows bloqueado**
- Dado que o workspace eh `C:\Users\dev\project`
- Quando o agente chama `read_file("..\\..\\Windows\\System32\\config\\SAM")`
- Entao `safePath` lanca erro

**Cenario 3: Path absoluto fora do workspace bloqueado**
- Dado que o workspace eh `/home/user/project`
- Quando o agente chama `read_file("/etc/passwd")`
- Entao `safePath` lanca erro

**Cenario 4: Drive diferente no Windows bloqueado**
- Dado que o workspace eh `C:\Users\dev\project`
- Quando o agente chama `read_file("D:\\sensitive\\data.txt")`
- Entao `safePath` lanca erro

**Cenario 5: Path valido dentro do workspace permitido**
- Dado que o workspace eh `/home/user/project`
- Quando o agente chama `read_file("src/deep/nested/file.ts")`
- Entao `safePath` retorna `/home/user/project/src/deep/nested/file.ts`

**Cenario 6: Path com pontos internos permitido**
- Dado que o workspace eh `/home/user/project`
- Quando o agente chama `read_file("src/../src/index.ts")`
- Entao `safePath` resolve para `/home/user/project/src/index.ts` (valido)

**Cenario 7: Consistencia entre AgentService e MCP**
- Dado que o mesmo path eh testado em ambos os contextos
- Entao o resultado eh identico (ambos usam `safePath` do core)

### Notas tecnicas
- `safePath(root, relativePath): string` em `packages/core/src/utils/safe-path.ts`
- Usa `path.normalize(path.resolve(root, relativePath))`
- Compara com `normalizedRoot + path.sep` (nao apenas `startsWith`)
- Exportar via `packages/core/src/index.ts`

---

## US-08: Tools unificadas entre VSCode e MCP

**Como** contribuidor do ThinkCoffee,
**quero** que a logica das tools esteja centralizada no core,
**para que** bugs corrigidos se propaguem automaticamente e nao haja duplicacao.

### Cenarios de aceite

**Cenario 1: Tool read_file centralizada**
- Dado que `packages/core/src/tools/read-file.ts` existe
- Quando AgentService chama `readFileTool(workspace, { path: "src/index.ts" })`
- Entao retorna o mesmo resultado que o MCP server retornaria
- E ambos usam `safePath` internamente

**Cenario 2: Paridade de comportamento**
- Dado que um mesmo input eh passado para a tool via AgentService e via MCP
- Entao o output eh identico (testes de paridade)

**Cenario 3: Novos hooks na tool centralizada**
- Dado que `write_file` precisa chamar snapshot e action log
- Quando a tool processar, ela aceita hooks opcionais: `{ beforeWrite?, afterWrite? }`
- Entao AgentService injeta hooks de snapshot e log
- E MCP usa a tool sem hooks (ou com hooks diferentes)

### Notas tecnicas
- `packages/core/src/tools/` com uma funcao por tool
- Cada tool: `(workspace: string, input: ToolInput, options?: ToolOptions) => Promise<ToolResult>`
- `ToolResult: { success: boolean, output: string, filesAffected?: string[], error?: string }`
- AgentService e MCP importam e delegam

---

## US-09: Limpeza automatica de snapshots antigos

**Como** desenvolvedor,
**quero** que snapshots antigos sejam removidos automaticamente,
**para que** o disco nao encha com backups obsoletos.

### Cenarios de aceite

**Cenario 1: Limpeza por idade**
- Dado que existem snapshots com 10 dias
- E a configuracao tem `retentionDays: 7`
- Quando o garbage collector roda
- Entao snapshots com mais de 7 dias sao removidos

**Cenario 2: Pipeline ativo preservado**
- Dado que o pipeline "abc" esta com status "active" e tem snapshots de 8 dias atras
- Quando o garbage collector roda
- Entao os snapshots do pipeline "abc" NAO sao removidos (pipeline ativo)

**Cenario 3: Execucao ao iniciar VS Code**
- Dado que o usuario abre o VS Code
- Quando a extension do ThinkCoffee eh ativada
- Entao o garbage collector roda uma vez

**Cenario 4: Execucao periodica**
- Dado que o VS Code esta aberto ha mais de 24h
- Entao o garbage collector roda novamente (interval de 24h)

**Cenario 5: Log de limpeza**
- Dado que o garbage collector removeu 3 snapshots totalizando 25MB
- Entao o console registra: "Snapshot cleanup: 3 snapshots removidos (25 MB liberados)"

### Notas tecnicas
- `SnapshotService.cleanup()` metodo
- Configuracao em `~/.thinkcoffee/snapshot-config.json`
- Default: `{ retentionDays: 7, maxSizeMB: 50 }`
- Verificar `PipelineService.get()` para checar se pipeline esta ativo

---

## US-10: Testes robustos para a safety net

**Como** contribuidor do ThinkCoffee,
**quero** que todos os novos modulos tenham cobertura >= 80%,
**para que** eu tenha confianca de que o sistema de protecao funciona corretamente.

### Cenarios de aceite

**Cenario 1: ActionLogService testado**
- Dado que `ActionLogService` tem metodos log, getByPipeline, getByPhase, getFileActions
- Quando testes rodam
- Entao todos os metodos sao testados com mocks de filesystem
- E cobertura >= 80%

**Cenario 2: SnapshotService testado**
- Dado que `SnapshotService` tem metodos snapshotFile, getSnapshot, listSnapshots, deleteSnapshot, cleanup
- Quando testes rodam
- Entao snapshot de criacao, modificacao e delecao testados
- E snapshot unico por arquivo por fase testado
- E cobertura >= 80%

**Cenario 3: RollbackService testado**
- Dado que `RollbackService` restaura, deleta e recria arquivos
- Quando testes rodam
- Entao rollback de cada tipo de acao testado
- E atualizacao do pipeline testada
- E cobertura >= 80%

**Cenario 4: safePath testado extensivamente**
- Dado que `safePath` protege contra path traversal
- Quando testes rodam
- Entao edge cases testados: `..`, caminhos absolutos, drives Windows, unicode, espacos, symlinks
- E cobertura >= 80%

**Cenario 5: Integracao dry-run testada**
- Dado que um pipeline simulado roda em modo dry-run
- Quando fluxo completo: start -> dry-run tools -> resumo
- Entao nenhum arquivo recebeu write no mock
- E action log contem todas as acoes com `dryRun: true`

**Cenario 6: Integracao snapshot + rollback testada**
- Dado que um pipeline real executa e modifica arquivos
- Quando snapshot -> modificacao -> rollback
- Entao os hashes dos arquivos antes e depois do rollback sao identicos

**Cenario 7: CI green**
- Dado que `pnpm test` eh executado
- Quando todos os testes rodam
- Entao exit code eh 0
- E nenhum teste depende de rede ou filesystem real
- E todos usam `vi.mock('fs')` e `vi.mock('os')`

### Notas tecnicas
- Arquivos de teste em `packages/core/src/services/__tests__/` e `packages/core/src/utils/__tests__/`
- Seguir padrao existente dos testes em `__tests__/`
- Usar `vi.mock`, `vi.fn`, `vi.spyOn` do Vitest
- Teste de integracao pode usar filesystem temporario (`mkdtempSync`)
