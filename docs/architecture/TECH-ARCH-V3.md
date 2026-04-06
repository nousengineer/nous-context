# ThinkCoffee -- Arquitetura Técnica V3: Agent Safety Net

> Gerado pelo agente Architect | Baseado em: `docs/PM-BACKLOG-V3.md`
> Data: 2025-01-15
> Versão: 3.0

## 1. Visão Geral

Este documento detalha a arquitetura técnica para a implementação da feature "Agent Safety Net", conforme especificado no `PM-BACKLOG-V3.md`. O objetivo é criar uma camada de segurança robusta que permita aos usuários simular, reverter e auditar as ações dos agentes de IA.

A arquitetura se baseia em três novos serviços principais no `packages/core`:
1.  **ActionLogService**: Para registrar todas as ações das ferramentas.
2.  **SnapshotService**: Para criar backups de arquivos antes de modificações.
3.  **RollbackService**: Para restaurar o workspace a partir de um snapshot.

Adicionalmente, a lógica das ferramentas será centralizada, e a segurança de acesso a arquivos será reforçada.

---

## 2. Stack de Tecnologia

A stack existente será mantida. Nenhuma nova tecnologia principal será adicionada.

- **Linguagem**: TypeScript
- **Ambiente de Execução**: Node.js (para CLI e serviços de backend), VS Code Extension Host (para a extensão)
- **Gerenciador de Pacotes**: pnpm com workspaces
- **Framework de Testes**: Vitest
- **Containerização**: Docker (para ambientes de desenvolvimento e produção)

---

## 3. Estrutura de Pastas e Projetos

As seguintes alterações e adições serão feitas na estrutura de pastas, principalmente dentro de `packages/core/src/`.

```
packages/core/src/
├── services/
│   ├── __tests__/
│   │   ├── ActionLogService.test.ts   # (Novo)
│   │   ├── SnapshotService.test.ts    # (Novo)
│   │   └── RollbackService.test.ts    # (Novo)
│   ├── ActionLogService.ts            # (Novo)
│   ├── SnapshotService.ts           # (Novo)
│   └── RollbackService.ts           # (Novo)
│
├── tools/                             # (Novo)
│   ├── __tests__/
│   │   ├── file-tools.test.ts         # (Novo)
│   │   └── run-command.test.ts        # (Novo)
│   ├── file-tools.ts                  # (Novo - read, write, list, delete)
│   ├── run-command.ts                 # (Novo)
│   ├── search-code.ts                 # (Novo)
│   └── index.ts                       # (Novo)
│
├── utils/
│   ├── __tests__/
│   │   └── safe-path.test.ts          # (Novo)
│   └── safe-path.ts                   # (Novo)
│
└── types/                             # (Novo - ou estender existente)
    └── safety-net.ts                  # (Novo - para interfaces e tipos)

packages/vscode/src/
├── agents/
│   └── AgentService.ts                # (Modificado para integrar novos serviços)
│
└── utils/
    └── DiffPreviewHandler.ts          # (Novo)
```

---

## 4. Modelo de Dados e Contratos de API

Novos tipos e interfaces serão criados para garantir a consistência dos dados entre os serviços. Eles serão definidos em `packages/core/src/types/safety-net.ts`.

### 4.1. `ActionLogEntry` (Data Model)

```typescript
// packages/core/src/types/safety-net.ts

export interface ActionLogEntry {
  id: string; // UUID v4
  timestamp: string; // ISO 8601
  pipelineId: string;
  phaseIndex: number;
  taskId: string;
  agentRole: string;
  toolName: 'read_file' | 'write_file' | 'list_files' | 'delete_file' | 'run_command' | 'search_code';
  input: any;
  output: string;
  result: 'success' | 'error' | 'rejected' | 'blocked';
  durationMs: number;
  dryRun: boolean;
  filesAffected?: {
    path: string;
    action: 'read' | 'write' | 'delete' | 'create';
  }[];
  commandDetails?: {
    command: string;
    exitCode?: number;
    validationResult: 'safe' | 'moderate' | 'destructive' | 'blocked';
    userDecision?: 'accepted' | 'rejected' | 'timeout';
  };
}
```

### 4.2. `Snapshot` (Data Model)

```typescript
// packages/core/src/types/safety-net.ts

export interface SnapshotFileMetadata {
  path: string; // Relative path from workspace root
  action: 'modified' | 'deleted' | 'created';
  originalHash: string; // SHA-256 of the original content
  originalSize: number; // Size in bytes
}

export interface SnapshotMetadata {
  pipelineId: string;
  phaseIndex: number;
  phaseName: string;
  timestamp: string; // ISO 8601
  files: SnapshotFileMetadata[];
}
```

### 4.3. `ActionLogService` (API Contract)

```typescript
// packages/core/src/services/ActionLogService.ts

export class ActionLogService {
  constructor(private readonly workspaceRoot: string);

  /**
   * Registra uma nova entrada de ação no log.
   * @param entry - O objeto de entrada de log parcial (sem id, timestamp).
   */
  async log(entry: Omit<ActionLogEntry, 'id' | 'timestamp'>): Promise<void>;

  /**
   * Retorna todas as entradas de log para um determinado pipeline.
   * @param pipelineId - O ID do pipeline.
   */
  async getByPipeline(pipelineId: string): Promise<ActionLogEntry[]>;

  /**
   * Retorna as ações de arquivo para uma fase específica.
   * @param pipelineId - O ID do pipeline.
   * @param phaseIndex - O índice da fase.
   */
  async getFileActions(pipelineId: string, phaseIndex: number): Promise<ActionLogEntry[]>;
}
```

### 4.4. `SnapshotService` (API Contract)

```typescript
// packages/core/src/services/SnapshotService.ts

export class SnapshotService {
  constructor(private readonly workspaceRoot: string);

  /**
   * Cria um snapshot de um arquivo se ele ainda não foi salvo nesta fase.
   * @param pipelineId - O ID do pipeline.
   * @param phaseIndex - O índice da fase.
   * @param relativePath - O caminho relativo do arquivo.
   * @param action - A ação que será executada ('modified' ou 'deleted').
   */
  async createSnapshot(pipelineId: string, phaseIndex: number, phaseName: string, relativePath: string, action: 'modified' | 'deleted'): Promise<void>;

  /**
   * Registra que um arquivo foi criado pelo agente.
   * @param pipelineId - O ID do pipeline.
   * @param phaseIndex - O índice da fase.
   * @param relativePath - O caminho relativo do arquivo.
   */
  async recordFileCreation(pipelineId: string, phaseIndex: number, phaseName: string, relativePath: string): Promise<void>;

  /**
   * Retorna os metadados de um snapshot.
   * @param pipelineId - O ID do pipeline.
   * @param phaseIndex - O índice da fase.
   */
  async getSnapshot(pipelineId: string, phaseIndex: number): Promise<SnapshotMetadata | null>;

  /**
   * Executa a limpeza de snapshots antigos.
   */
  async cleanup(): Promise<{ removedCount: number; freedSizeMb: number }>;
}
```

### 4.5. `RollbackService` (API Contract)

```typescript
// packages/core/src/services/RollbackService.ts

export class RollbackService {
  constructor(private readonly workspaceRoot: string);

  /**
   * Reverte o workspace para o estado de um snapshot.
   * @param pipelineId - O ID do pipeline.
   * @param phaseIndex - O índice da fase a ser revertida.
   */
  async rollback(pipelineId: string, phaseIndex: number): Promise<{ restored: number; deleted: number }>;
}
```

### 4.6. `Core Tools` (API Contract)

Todas as ferramentas seguirão um padrão unificado.

```typescript
// packages/core/src/tools/file-tools.ts

export interface ToolInput {
  path?: string;
  content?: string;
  // ... outros parâmetros específicos da ferramenta
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

// Exemplo de função de ferramenta
async function writeFile(workspaceRoot: string, input: { path: string; content: string }): Promise<ToolResult>;
```

---

## 5. Pontos de Integração

A lógica existente, principalmente no `AgentService`, será modificada para orquestrar esses novos serviços.

### 5.1. Fluxo de Execução de Ferramenta (com Safety Net)

O método `handleToolCall` (ou equivalente) no `AgentService` será refatorado para seguir este fluxo:

1.  **Receber Tool Call**: O agente solicita a execução de uma ferramenta (ex: `write_file`).
2.  **Verificar Dry-Run**:
    *   Se `dryRun` for `true`, registrar a ação no `ActionLogService` com `dryRun: true` e retornar uma mensagem simulada. **Nenhuma ação de escrita é executada.**
3.  **Ferramentas de Escrita (`write_file`, `delete_file`, `run_command`):**
    *   **`run_command`**: Chamar `command-validator`. Se for `destructive`, pedir confirmação ao usuário via UI (`vscode.window.showWarningMessage`). Se rejeitado, registrar e retornar erro.
    *   **`write_file` / `delete_file`**: Chamar `SnapshotService.createSnapshot()` para o arquivo afetado. Isso só acontece na primeira vez que o arquivo é tocado na fase.
    *   **`write_file` (arquivo existente)**: Chamar o `DiffPreviewHandler` para mostrar o diff ao usuário. Se rejeitado, registrar e retornar erro.
4.  **Executar a Ferramenta**: Chamar a função correspondente de `packages/core/src/tools/`.
5.  **Registrar Ação**: Chamar `ActionLogService.log()` com os detalhes da execução (input, output, sucesso/falha, duração).
6.  **Retornar Resultado**: Enviar o resultado de volta para o agente.

### 5.2. Centralização de `safePath`

- A nova função `safePath(root, relativePath)` será criada em `packages/core/src/utils/safe-path.ts`.
- Todas as ferramentas em `packages/core/src/tools/` a utilizarão para validar e resolver caminhos de arquivo.
- O `AgentService` e o `mcp-server` importarão e usarão as ferramentas do core, garantindo que a validação de caminho seja consistente.

### 5.3. Comandos do Usuário

- **`/rollback` (Chat)**: Acionará o `RollbackService.rollback()` para a fase atual ou especificada.
- **`think rollback` (CLI)**: Idem.
- **`think pipeline run --dry-run` (CLI)**: Definirá a flag `dryRun: true` no objeto do pipeline, que será propagada para o `AgentService`.

---

## 6. Próximos Passos

Com esta arquitetura definida, a equipe de backend pode começar a implementação, seguindo a estrutura de pastas e os contratos de API descritos.

- **@backend**: Iniciar a implementação dos serviços `ActionLogService`, `SnapshotService` e `RollbackService`, juntamente com seus respectivos testes unitários. Criar a estrutura de `packages/core/src/tools` e `packages/core/src/utils/safe-path.ts`.
- **@frontend**: Iniciar a implementação do `DiffPreviewHandler` e da UI de confirmação para comandos destrutivos no `packages/vscode`.
