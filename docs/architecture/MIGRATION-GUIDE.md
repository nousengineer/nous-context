# Guia de Migracao - Sistema de Agentes v2

**Documento**: Migration Guide  
**Versao**: 2.0.0  
**Data**: 2025-01-14  

---

## Visao Geral

Este guia descreve como migrar codigo existente para o novo sistema de agentes modular.

---

## 1. Imports Atualizados

### Antes (v1)
```typescript
import { 
  AgentRole, 
  Pipeline, 
  AgentTask,
  AgentModelConfig,
  AGENT_META,
  loadAgentConfig,
} from '@thinkcoffee/core';
```

### Depois (v2)
```typescript
// Contratos de agentes
import { 
  AgentRole, 
  IAgent,
  AgentMetadata,
  IAgentContext,
  IAgentRegistry,
  getAgentRegistry,
} from '@thinkcoffee/core/agents/contracts';

// Tools
import {
  AgentTool,
  ToolBuilder,
  getToolRegistry,
} from '@thinkcoffee/core/agents/tools';

// Config
import {
  AgentModelConfig,
  QualityPreset,
} from '@thinkcoffee/core/agents/config';

// Pipeline
import {
  Pipeline,
  AgentTask,
  PipelinePhase,
} from '@thinkcoffee/core/pipeline/contracts';
```

### Compatibilidade
Os imports antigos continuam funcionando via re-exports em `@thinkcoffee/core`.

---

## 2. Criando Agentes Customizados

### Antes (v1)
```typescript
// Tudo hardcoded no AgentService.ts
const AGENT_META: Record<AgentRole, { label: string; description: string }> = {
  'my-agent': { label: 'My Agent', description: '...' },
};

function buildSystemPrompt(role: AgentRole, ctx: AgentContext): string {
  if (role === 'my-agent') {
    return '...';
  }
  // ...
}
```

### Depois (v2)
```typescript
import { IAgent, BaseAgent, AgentMetadata, IAgentContext, AgentResult } from '@thinkcoffee/core';
import { AgentTool } from '@thinkcoffee/core/agents/tools';

class MyCustomAgent extends BaseAgent {
  readonly metadata: AgentMetadata = {
    role: 'my-agent',
    label: 'My Custom Agent',
    sigla: 'MA',
    description: 'Does something specific',
    capabilities: [
      { id: 'my-capability', name: 'My Cap', description: '...' },
    ],
    version: '1.0.0',
    author: 'My Team',
  };

  getTools(): AgentTool[] {
    return [
      // Return tools this agent can use
    ];
  }

  buildSystemPrompt(context: IAgentContext): string {
    return `Voce e ${this.metadata.label}...
    
## Projeto
- Nome: ${context.projectName}
- Objetivo: ${context.objective}

## Sua tarefa
${context.task.description}
`;
  }

  async beforeExecute(context: IAgentContext): Promise<void> {
    // Setup code
  }

  async afterExecute(context: IAgentContext, result: AgentResult): Promise<void> {
    // Cleanup code
  }
}

// Registro
import { getAgentRegistry } from '@thinkcoffee/core';
getAgentRegistry().register(new MyCustomAgent());
```

---

## 3. Definindo Tools

### Antes (v1)
```typescript
// Hardcoded no AgentService.ts
function getAgentTools(workspace: string): vscode.LanguageModelChatTool[] {
  return [
    {
      name: 'my_tool',
      description: 'Does something',
      inputSchema: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      },
    },
  ];
}
```

### Depois (v2)
```typescript
import { ToolBuilder, getToolRegistry } from '@thinkcoffee/core/agents/tools';

// Usando builder
const myTool = new ToolBuilder('my_tool')
  .description('Does something specific')
  .parameter('input', 'string', 'The input value', true)
  .parameter('options', 'object', 'Extra options', false)
  .allowedRoles(['backend', 'frontend']) // Opcional: restringir roles
  .mutating(true) // Marca como tool que modifica estado
  .executor(async (params, context) => {
    const { input, options } = params;
    
    // Implementacao
    const result = doSomething(input, options);
    
    return {
      success: true,
      output: `Result: ${result}`,
      artifacts: ['path/to/created/file.ts'],
    };
  })
  .build();

// Registrar globalmente
getToolRegistry().register(myTool);
```

---

## 4. Hooks de Lifecycle

### Antes (v1)
```typescript
// Nao existia sistema de hooks
// Logging/metrics eram espalhados pelo codigo
```

### Depois (v2)
```typescript
import { 
  IAgentLifecycleHook, 
  LifecycleEvent,
  getLifecycleManager,
} from '@thinkcoffee/core/agents/contracts';

// Hook de logging
const loggingHook: IAgentLifecycleHook = {
  id: 'my-app:logging',
  name: 'Custom Logging',
  phases: ['pre-execute', 'post-execute', 'on-error'],
  priority: 100,
  
  async handle(event: LifecycleEvent) {
    switch (event.phase) {
      case 'pre-execute':
        console.log(`Starting: ${event.agent} - ${event.context.task.title}`);
        break;
      case 'post-execute':
        console.log(`Completed: ${event.agent}`);
        break;
      case 'on-error':
        console.error(`Error in ${event.agent}:`, (event as any).error);
        break;
    }
    return { continue: true };
  },
};

// Registrar
getLifecycleManager().register(loggingHook);
```

---

## 5. Usando o Registry

### Listando Agentes
```typescript
import { getAgentRegistry } from '@thinkcoffee/core';

const registry = getAgentRegistry();

// Listar todos
const agents = registry.list();

// Por role
const backend = registry.get('backend');

// Por capability
const fileWriters = registry.getByCapability('file-write');

// Com filtro customizado
const myAgents = registry.filter({
  author: 'My Team',
  capabilities: ['code-generation'],
});
```

### Eventos de Registro
```typescript
const unsubscribe = registry.on('agent:registered', (event) => {
  console.log(`New agent registered: ${event.role}`);
});

// Remover listener
unsubscribe();
```

---

## 6. Construindo Contexto

### Antes (v1)
```typescript
const ctx = {
  projectId: 'proj-1',
  projectName: 'My Project',
  workspace: '/path/to/workspace',
  objective: 'Build feature X',
  previousOutputs: [],
  task: myTask,
};
```

### Depois (v2)
```typescript
import { AgentContextBuilder } from '@thinkcoffee/core/agents/contracts';

const ctx = new AgentContextBuilder()
  .setProject('proj-1', 'My Project')
  .setPipeline('pipe-123')
  .setWorkspace('/path/to/workspace')
  .setObjective('Build feature X')
  .setPhase({
    id: 'phase-1',
    name: 'Implementation',
    order: 2,
    totalPhases: 5,
    parallel: true,
    requiresApproval: false,
  })
  .setTask(myTask)
  .addPreviousOutput({
    agent: 'architect',
    output: 'Architecture document...',
    timestamp: new Date().toISOString(),
  })
  .setEnv({ NODE_ENV: 'production' })
  .setDryRun(false)
  .build();
```

---

## 7. Checklist de Migracao

### Core Package
- [ ] Atualizar imports para novos paths
- [ ] Substituir AGENT_META por AgentRegistry
- [ ] Usar ToolBuilder para definir tools
- [ ] Implementar lifecycle hooks para logging/metrics

### VSCode Extension
- [ ] Refatorar AgentService para usar IAgent interface
- [ ] Extrair tools para modulo separado
- [ ] Implementar adapters (Copilot, Ollama) como IModelAdapter
- [ ] Registrar agentes builtin no activation

### Testes
- [ ] Criar mocks para IAgentRegistry
- [ ] Testar tools isoladamente
- [ ] Testar lifecycle hooks
- [ ] Testar AgentContextBuilder

---

## 8. Troubleshooting

### Erro: "Agent not found"
```typescript
// Verificar se o agente foi registrado
const registry = getAgentRegistry();
console.log('Registered agents:', registry.listRoles());
```

### Erro: "Tool execution failed"
```typescript
// Verificar se o tool esta disponivel para o role
const tools = getToolRegistry().getForRole('backend');
console.log('Available tools:', tools.map(t => t.name));
```

### Erro: "Context validation failed"
```typescript
// AgentContextBuilder valida campos obrigatorios
// Verificar se todos foram setados antes de build()
try {
  const ctx = builder.build();
} catch (e) {
  console.error('Missing field:', e.message);
}
```

---

## Suporte

Para duvidas sobre a migracao, abra uma issue no repositorio ou consulte a documentacao em `docs/architecture/`.
