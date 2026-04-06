# Implementação do Histórico de Pipelines - ThinkCoffee

## Sumário
Este documento descreve a implementação da interface de histórico de chat para gerenciar e visualizar o histórico de pipelines na extensão ThinkCoffee para VSCode.

## Arquivos Criados/Modificados

### 1. **ChatHistoryView.ts**
Novo componente que exibe e gerencia o histórico de chat em uma view do VSCode.

**Funcionalidades:**
- Visualização do histórico com paginação
- Busca por texto nas mensagens
- Filtros por tipo (request, response, error, info, code) e remetente
- Estatísticas de histórico (total de mensagens, caracteres, período)
- Exportação em múltiplos formatos (JSON, Markdown, CSV, JSONL)
- Deleção de mensagens individuais
- Limpeza completa do histórico com confirmação

**Implementação:**
```typescript
// Registrar na extensão (extension.ts)
const historyProvider = new ChatHistoryView(context.extensionUri, chat);
context.subscriptions.push(
  vscode.window.registerWebviewViewProvider(
    ChatHistoryView.viewType,
    historyProvider,
    { webviewOptions: { retainContextWhenHidden: true } }
  )
);
```

### 2. **PipelineChatHistoryService.ts**
Serviço singleton que gerencia o histórico de chat para cada pipeline com persistência em disco.

**Funcionalidades:**
- Chat service por pipeline (lazy initialization)
- Backup automático do histórico
- Restauração de backups
- Sincronização de históricos (merge com deduplicação)
- Estatísticas de histórico
- Exportação em múltiplos formatos (JSON, JSONL, Markdown, CSV)
- Cleanup de backups antigos
- Diretório persistente em `~/.thinkcoffee/pipeline-chat/`

**Métodos principais:**
```typescript
getChatForPipeline(pipelineId: string): ChatService
backupPipelineHistory(pipelineId: string): string
restorePipelineHistory(pipelineId: string, backupFile: string): void
listBackups(pipelineId: string): BackupInfo[]
syncHistories(pipelineId: string, otherHistories: ChatMessage[][]): ChatMessage[]
getHistoryStats(pipelineId: string): HistoryStats
exportHistory(pipelineId: string, format: 'json' | 'jsonl' | 'markdown' | 'csv'): string
```

## Integração com Extension.ts

### Passo 1: Importar novos componentes
```typescript
import { ChatHistoryView } from './chat/ChatHistoryView';
import { getPipelineChatHistoryService } from './chat/PipelineChatHistoryService';
```

### Passo 2: Registrar ChatHistoryView
Após registrar `ChatViewProvider`, adicionar:
```typescript
const historyProvider = new ChatHistoryView(context.extensionUri, chat);
context.subscriptions.push(
  vscode.window.registerWebviewViewProvider(ChatHistoryView.viewType, historyProvider, {
    webviewOptions: { retainContextWhenHidden: true },
  })
);
```

### Passo 3: Registrar comando de backup
```typescript
vscode.commands.registerCommand('thinkcoffee.backupHistory', async () => {
  const project = await getProject();
  if (!project) return;

  const active = pipelineService.getActive(project.id);
  if (!active) {
    vscode.window.showWarningMessage('No active pipeline.');
    return;
  }

  const historyService = getPipelineChatHistoryService();
  const backupFile = historyService.backupPipelineHistory(active.id);
  vscode.window.showInformationMessage(`Backup criado: ${backupFile}`);
})
```

## package.json - Contribuições

Adicionar as seguintes contribuições ao `packages/vscode/package.json`:

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "thinkcoffee-container",
          "title": "ThinkCoffee",
          "icon": "resources/coffee.svg"
        }
      ]
    },
    "views": {
      "thinkcoffee-container": [
        {
          "id": "thinkcoffee.chat",
          "name": "Chat",
          "when": "workspaceFolder"
        },
        {
          "id": "thinkcoffee.chatHistory",
          "name": "Chat History",
          "when": "workspaceFolder"
        }
      ]
    },
    "commands": [
      {
        "command": "thinkcoffee.backupHistory",
        "title": "ThinkCoffee: Backup Chat History",
        "when": "workspaceFolder"
      },
      {
        "command": "thinkcoffee.exportHistory",
        "title": "ThinkCoffee: Export Chat History",
        "when": "workspaceFolder"
      }
    ]
  }
}
```

## Fluxo de Uso

### Visualizar Histórico
1. Abrir a view "Chat History" na sidebar
2. Histórico é carregado automaticamente
3. Usar busca para encontrar mensagens específicas
4. Filtrar por tipo ou remetente conforme necessário

### Exportar Histórico
1. Clicar em "Export" na view de histórico
2. Selecionar formato (JSON, Markdown, Texto)
3. Escolher local para salvar
4. Arquivo é criado com timestamp

### Backup Automático
O PipelineChatHistoryService mantém backups automáticos em:
```
~/.thinkcoffee/pipeline-chat/backup_<pipelineId>_<timestamp>.jsonl
```

### Recuperação de Pipeline
Ao iniciar um pipeline incompleto:
1. ChatViewProvider carrega histórico persistido
2. Mensagens anteriores aparecem na view de chat
3. Agentes podem ver contexto completo da conversa

## Armazenamento de Dados

### Estrutura de Diretórios
```
~/.thinkcoffee/
├── chat/
│   ├── default.jsonl
│   └── pipeline-<id>.jsonl
├── pipeline-chat/
│   ├── backup_pipeline-1_2024-01-15T10-30-45.jsonl
│   └── backup_pipeline-2_2024-01-14T14-20-10.jsonl
└── data.db
```

### Formato de Armazenamento
Cada arquivo `.jsonl` contém uma linha por mensagem em formato JSON (JSON Lines).

```jsonl
{"id":"uuid","timestamp":"2024-01-15T10:30:45.000Z","sender":"programmer","senderLabel":"You","content":"...","type":"request"}
{"id":"uuid","timestamp":"2024-01-15T10:31:20.000Z","sender":"system","senderLabel":"Sistema","content":"...","type":"info"}
```

## Melhorias Futuras

1. **Sincronização em nuvem** - Backup automático em nuvem
2. **Versionamento** - Controle de versão do histórico com rollback
3. **Análise de histórico** - Visualizações e gráficos de uso
4. **Filtros avançados** - Busca por data, mentions, etc.
5. **Compartilhamento** - Exportar histórico para colaboradores
6. **Integração com MCP** - Sync automático com contexto do Claude Desktop

## Testes

### Teste Manual
1. Criar novo pipeline
2. Enviar mensagens no chat
3. Abrir Chat History view
4. Verificar visualização e filtros
5. Exportar e validar arquivo
6. Fechar e reabrir extensão
7. Verificar histórico persiste

### Teste de Persistência
```bash
# Verificar arquivo de histórico
cat ~/.thinkcoffee/chat/default.jsonl

# Verificar backups
ls -la ~/.thinkcoffee/pipeline-chat/
```

## Troubleshooting

### Histórico não aparece
1. Verificar se `~/.thinkcoffee/` existe
2. Verificar permissões de arquivo
3. Reiniciar VSCode
4. Inspecionar DevTools (Help > Toggle Developer Tools)

### Erro ao exportar
1. Verificar se diretório de workspace está aberto
2. Verificar espaço em disco
3. Verificar permissões de escrita

## Próximos Passos

1. **Integrar ChatHistoryView** no `extension.ts`
2. **Testar visualização** no VSCode
3. **Validar persistência** entre reinicios
4. **Otimizar performance** para históricos grandes
5. **Adicionar testes** unitários e de integração
