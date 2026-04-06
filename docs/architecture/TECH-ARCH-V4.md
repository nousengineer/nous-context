# ThinkCoffee -- Arquitetura Técnica V4: Agent Safety Net

> Feature: Agent Safety Net (Dry-Run, Snapshot & Rollback)
> Autor: @architect
> Referência: `docs/PM-BACKLOG-V3.md`, `docs/PM-USER-STORIES-V3.md`
> Status: Proposto

---

## 1. Visão Geral da Arquitetura

Esta arquitetura introduz uma "rede de segurança" para todas as operações de agentes que modificam o ambiente do usuário. O objetivo é dar ao usuário controle total, confiança e a capacidade de reverter ações indesejadas.

Os princípios de design são:
1.  **Centralização no Core**: Toda a lógica de negócio, validação e manipulação de dados residirá em `packages/core` para ser compartilhada entre o `vscode` e o `mcp-server`.
2.  **Segurança por Padrão**: As configurações padrão devem ser as mais seguras (e.g., confirmação para comandos destrutivos, diff para edições).
3.  **Mínimo Acoplamento**: Os novos serviços (Log, Snapshot, Rollback) serão fracamente acoplados ao `AgentService`, que atuará como orquestrador.
4.  **Testabilidade**: Todos os novos serviços devem ser projetados para serem testados unitariamente com mocks do sistema de arquivos e APIs do VSCode.

O fluxo de uma chamada de ferramenta (tool call) de escrita será modificado para incorporar os novos pontos de verificação:

```mermaid
graph TD
    subgraph AgentService
        A[handleToolCall] --> B{É uma tool de escrita?};
        B -- Sim --> C{Dry-Run?};
        B -- Não --> G[Executa Tool (Leitura)];
        C -- Sim --> D[ActionLogService.log(dryRun=true)];
        C -- Não --> E[SnapshotService.snapshotFile];
        E --> F[Executa Tool (Escrita)];
        F --> H[ActionLogService.log(dryRun=false)];
    end

    subgraph Usuário
        I(Comando /rollback) --> J[RollbackService.execute];
    end

    subgraph Core Services
        J --> K[SnapshotService.getSnapshot];
        K --> J;
    end

    style G fill:#c9ffc9
    style D fill:#ffc
    style H fill:#ffc
    style E fill:#e6e6fa
```

---

## 2. Stack de Tecnologia

A stack existente será mantida. Novas funcionalidades utilizarão principalmente módulos nativos do Node.js para evitar dependências externas.

-   **Linguagem**: TypeScript
-   **Ambiente**: Node.js
-   **Testes**: Vitest
-   **Módulos Nativos a serem usados**:
    -   `node:fs/promises`: Para operações de arquivo assíncronas.
    -   `node:path`: Para manipulação segura de caminhos.
    -   `node:crypto`: Para gerar hashes (SHA-256) dos arquivos no snapshot.
    -   `node:os`: Para obter o diretório home do usuário (`os.homedir()`) e o diretório temporário (`os.tmpdir()`).

Nenhuma nova biblioteca externa é necessária para a implementação principal.

---

## 3. Estrutura de Pastas e Projetos

As novas funcionalidades serão organizadas dentro de `packages/core` para garantir a reutilização.

```
packages/
└── core/
    ├── src/
    │   ├── services/
    │   │   ├── ActionLogService.ts       # (NOVO) Gerencia logs de ações
    │   │   ├── SnapshotService.ts      # (NOVO) Gerencia snapshots
    │   │   ├── RollbackService.ts      # (NOVO) Orquestra o rollback
    │   │   └── __tests__/
    │   │       ├── ActionLogService.test.ts
    │   │       ├── SnapshotService.test.ts
    │   │       └── RollbackService.test.ts
    │   │
    │   ├── tools/                        # (NOVO) Lógica centralizada das tools
    │   │   ├── readFile.ts
    │   │   ├── writeFile.ts
    │   │   ├── listFiles.ts
    │   │   ├── runCommand.ts
    │   │   ├── searchCode.ts
    │   │   └── index.ts
    │   │
    │   ├── utils/
    │   │   ├── safePath.ts               # (NOVO) Validador de path centralizado
    │   │   └── __tests__/
    │   │       └── safePath.test.ts
    │   │
    │   └── index.ts                      # Exporta os novos serviços e utils
    │
    └── package.json

packages/
└── vscode/
    ├── src/
    │   ├── agents/
    │   │   └── AgentService.ts           # (MODIFICADO) Ponto de integração
    │   │
    │   ├── utils/
    │   │   └── DiffPreviewHandler.ts     # (NOVO) Lida com a UI de diff
    │   │
    │   └── chat/
    │       └── commandHandlers.ts        # (MODIFICADO) Adiciona handler para /rollback
    │
    └── package.json

packages/
└── cli/
    └── src/
        └── commands/
            └── rollback.ts               # (NOVO) Comando `think rollback`
```

---

## 4. Modelo de Dados

### 4.1. Action Log Entry (`~/.thinkcoffee/logs/<projectId>/<pipelineId>.jsonl`)

Cada linha no arquivo de log será um objeto JSON com a seguinte estrutura:

```typescript
// packages/core/src/services/ActionLogService.ts

export interface ActionLogEntry {
  id: string; // UUID para a entrada de log
  timestamp: string; // ISO 8601
  pipelineId: string;
  phaseIndex: number;
  taskId: string;
  agent: 'backend' | 'frontend' | 'architect' | 'qa';
  tool: string; // e.g., 'write_file', 'run_command'
  input: any;
  result: {
    success: boolean;
    output: string;
    error?: string;
  };
  durationMs: number;
  dryRun: boolean;
  filesAffected?: string[]; // Para write_file, delete_file
  commandInfo?: {
    command: string;
    exitCode?: number;
    riskLevel: 'safe' | 'moderate' | 'destructive' | 'blocked';
    userDecision?: 'accepted' | 'rejected' | 'auto-blocked' | 'timeout';
  };
}
```

### 4.2. Snapshot Metadata (`~/.thinkcoffee/snapshots/<pipelineId>/<phaseIndex>/snapshot.json`)

O arquivo de metadados que acompanha cada snapshot.

```typescript
// packages/core/src/services/SnapshotService.ts

export interface SnapshotFileMetadata {
  path: string; // Caminho relativo ao workspace
  action: 'modified' | 'deleted' | 'created';
  hash?: string; // SHA-256 do conteúdo original (para 'modified' e 'deleted')
  size?: number; // Tamanho em bytes do arquivo original
}

export interface SnapshotMetadata {
  pipelineId: string;
  phaseIndex: number;
  phaseName: string;
  timestamp: string; // ISO 8601
  files: SnapshotFileMetadata[];
}
```

### 4.3. Configuração (`~/.thinkcoffee/config.json` e `workspace/.vscode/settings.json`)

As configurações serão unificadas e lidas a partir de um serviço de configuração.

```json
// ~/.thinkcoffee/snapshot-config.json (ou similar)
{
  "retentionDays": 7,
  "maxSizeMB": 100
}

// .vscode/settings.json
{
  "thinkcoffee.diffPreview": "existing-only", // "always" | "existing-only" | "never"
  "thinkcoffee.commandConfirmation": "destructive-only" // "always" | "destructive-only" | "never"
}
```

---

## 5. Contratos de API (Interfaces dos Serviços)

As interfaces a seguir definem os contratos para os novos serviços no `packages/core`.

```typescript
// packages/core/src/utils/safePath.ts
/**
 * Resolve um caminho relativo dentro de um root, garantindo que não saia do diretório root.
 * @throws Error se houver tentativa de path traversal.
 */
function safePath(root: string, relativePath: string): string;

// packages/core/src/services/ActionLogService.ts
export class ActionLogService {
  constructor(logsDir: string);
  async log(entry: Omit<ActionLogEntry, 'id' | 'timestamp'>): Promise<void>;
  async getByPipeline(pipelineId: string): Promise<ActionLogEntry[]>;
  async getByPhase(pipelineId: string, phaseIndex: number): Promise<ActionLogEntry[]>;
}

// packages/core/src/services/SnapshotService.ts
export class SnapshotService {
  constructor(snapshotsDir: string, workspaceRoot: string);
  /**
   * Cria um snapshot de um arquivo ANTES de uma operação de escrita/deleção.
   * Não faz nada se o arquivo já foi snapshotado nesta fase.
   */
  async snapshotFile(pipelineId: string, phaseIndex: number, phaseName: string, relativePath: string): Promise<void>;
  /**
   * Registra que um arquivo foi criado.
   */
  async recordCreatedFile(pipelineId: string, phaseIndex: number, phaseName: string, relativePath: string): Promise<void>;
  async getSnapshot(pipelineId: string, phaseIndex: number): Promise<SnapshotMetadata | null>;
  async cleanup(options: { retentionDays: number; activePipelines: string[] }): Promise<void>;
}

// packages/core/src/services/RollbackService.ts
export class RollbackService {
  constructor(snapshotService: SnapshotService, workspaceRoot: string);
  /**
   * Retorna as ações que seriam executadas durante um rollback.
   */
  async plan(pipelineId: string, phaseIndex: number): Promise<{ filesToRestore: string[], filesToDelete: string[] }>;
  /**
   * Executa o rollback, restaurando o workspace ao estado do snapshot.
   */
  async execute(pipelineId: string, phaseIndex: number): Promise<void>;
}
```

---

## 6. Pontos de Integração

### 6.1. `AgentService.ts`

Este é o principal ponto de integração. O método `handleToolCall` será refatorado para orquestrar a "Safety Net".

**Fluxo para `write_file`:**

1.  **`safePath`**: Validar o caminho do arquivo.
2.  **Dry-Run Check**: Se `pipeline.dryRun` for `true`:
    -   Chamar `ActionLogService.log` com `dryRun: true`.
    -   Retornar uma mensagem simulada para o agente (e.g., "DRY-RUN: Would write...").
    -   Encerrar o fluxo aqui.
3.  **Diff Preview (VSCode)**:
    -   Chamar `DiffPreviewHandler.showDiff`.
    -   Aguardar a decisão do usuário (Aceitar/Rejeitar).
    -   Se rejeitado, retornar erro para o agente.
4.  **Snapshot**:
    -   Chamar `SnapshotService.snapshotFile` para salvar o estado original do arquivo (se existir).
5.  **Execução**:
    -   Chamar a tool `writeFile` centralizada em `packages/core/tools`.
6.  **Logging**:
    -   Chamar `ActionLogService.log` com o resultado da operação.

**Fluxo para `run_command`:**

1.  **`command-validator`**: Chamar `validateCommand` para obter o nível de risco.
2.  **Dry-Run Check**: Se `dryRun` for `true`, logar e retornar.
3.  **Confirmação do Usuário (VSCode)**:
    -   Se o risco for `destructive` (e a configuração exigir), mostrar popup de confirmação.
    -   Aguardar decisão. Se rejeitado, retornar erro.
4.  **Execução**: Chamar a tool `runCommand` centralizada.
5.  **Logging**: Chamar `ActionLogService.log` com o resultado, incluindo o nível de risco e a decisão do usuário.

### 6.2. `packages/cli` e `packages/vscode/src/chat`

-   Ambos precisarão de um novo handler para o comando `rollback`.
-   O handler irá:
    1.  Instanciar `SnapshotService` e `RollbackService`.
    2.  Chamar `RollbackService.plan()` para obter o resumo das mudanças.
    3.  Pedir confirmação ao usuário.
    4.  Se confirmado, chamar `RollbackService.execute()`.
    5.  Atualizar o estado do pipeline (via `PipelineService`).

### 6.3. Centralização das Tools

-   A lógica atual dentro do `switch(toolName)` em `AgentService.ts` será movida para funções individuais em `packages/core/src/tools/`.
-   `AgentService` e `mcp-server` importarão e chamarão essas funções, passando o `workspaceRoot` e os `inputs`. Isso garante que `safePath` e outras lógicas de segurança sejam aplicadas consistentemente.

---

## 7. Plano de Testes

-   **Testes Unitários (`vitest`)**:
    -   `safePath.test.ts`: Testar todos os vetores de ataque de path traversal.
    -   `ActionLogService.test.ts`: Mockar `fs/promises` para verificar se os logs são escritos e lidos corretamente.
    -   `SnapshotService.test.ts`: Mockar `fs/promises` e `crypto` para testar a criação de snapshots e metadados.
    -   `RollbackService.test.ts`: Usar mocks dos serviços e `fs` para garantir que o rollback restaura o estado do sistema de arquivos corretamente.
    -   Testes para cada tool em `packages/core/src/tools/`.
-   **Testes de Integração (Manuais ou via script)**:
    -   Fluxo 1: Executar um pipeline em `dry-run` e verificar se nenhum arquivo foi alterado e se o log de ações reflete as simulações.
    -   Fluxo 2: Executar um pipeline que modifica arquivos, verificar se o snapshot foi criado corretamente.
    -   Fluxo 3: Executar o comando `rollback` e verificar se o workspace voltou ao estado original.
    -   Fluxo 4: Tentar executar um comando `rm -rf` e verificar se o popup de confirmação aparece e funciona.
    -   Fluxo 5: Tentar editar um arquivo e verificar se a UI de diff aparece e funciona.

Este documento serve como guia para a implementação. O agente `@backend` deve seguir esta arquitetura para desenvolver a feature.
