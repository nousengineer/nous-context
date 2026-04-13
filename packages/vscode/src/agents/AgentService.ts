import * as vscode from 'vscode';
import {
  ChatService, PipelineService, ContextService, DecisionService,
  AGENT_META, loadAgentConfig, saveAgentConfig, getModelForAgent,
  QUALITY_PRESETS, getModelCost,
  applyQualityPreset, isQualityPreset, getPMModelForPreset,
  recordModelFailure, getModelFailureCounts,
} from '@thinkcoffee/core';
import { discoverModels, getCachedModels, type DiscoveredModel } from './ModelRegistry';
import type {
  AgentRole, Pipeline, AgentTask, ChatMessage, AgentModelConfig, PMModelAssignment, PhaseTemplate, QualityPreset, TaskStatus,
} from '@thinkcoffee/core';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { buildCodeMap } from './CodeMap';
import { getOllamaClient, reloadOllamaClient, toOllamaTools, type OllamaChatMessage, type OllamaToolCall } from './OllamaClient';
import { loadOllamaConfig, saveOllamaConfig } from '@thinkcoffee/core';

// ─── Types ───────────────────────────────────────────────────

interface RunningAgent {
  role: AgentRole;
  taskId: string;
  pipelineId: string;
  cts: vscode.CancellationTokenSource;
  startedAt: number;
}

interface AgentContext {
  projectId: string;
  projectName: string;
  workspace: string;
  objective: string;
  previousOutputs: { agent: AgentRole; output: string }[];
  task: AgentTask;
  rejectionFeedback?: string;
}

// ─── Agent Label Helper ──────────────────────────────────────

const AGENT_SIGLA: Record<AgentRole, string> = {
  'product-manager': 'PM',
  'architect': 'AR',
  'organizer': 'OG',
  'git': 'GI',
  'dead-code': 'DC',
  'troubleshooter': 'TS',
  'backend': 'BE',
  'frontend': 'FE',
  'devops': 'DO',
  'qa': 'QA',
  'code-review': 'CR',
};

/** Build agent label as "SIGLA - model_family" */
function agentLabel(role: AgentRole, modelOverride?: string): string {
  const sigla = AGENT_SIGLA[role] || role.substring(0, 2).toUpperCase();
  const model = modelOverride || getModelForAgent(role);
  return `${sigla} - ${model}`;
}

/** Get PM model family for the active preset (or config fallback) */
function getActivePMModel(): string {
  const config = loadAgentConfig();
  const preset = isQualityPreset(config.mode) ? config.mode as QualityPreset : undefined;
  return preset ? getPMModelForPreset(preset) : getModelForAgent('product-manager', config);
}

// ─── System Prompts ──────────────────────────────────────────

function buildSystemPrompt(role: AgentRole, ctx: AgentContext): string {
  const meta = AGENT_META[role];
  const base = `Voce e o ${meta.label} do time ThinkCoffee.
${meta.description}

## Projeto
- Nome: ${ctx.projectName}
- Workspace: ${ctx.workspace}
- Objetivo do pipeline: ${ctx.objective}

## Sua tarefa
${ctx.task.title}: ${ctx.task.description}

## Regras criticas
1. VOCE DEVE USAR a ferramenta write_file para criar/editar arquivos. NAO apenas descreva o que faria — FACA.
2. Primeiro leia o codigo existente (read_file, list_files), depois escreva os arquivos.
3. Cada deliverable (documento, codigo, config, teste) deve ser um arquivo escrito no workspace via write_file.
4. Se sua tarefa e de arquitetura/planejamento, escreva o documento em um arquivo .md no workspace.
5. Se sua tarefa e de codigo, escreva os arquivos .ts/.tsx/.js etc no workspace.
6. Responda em portugues (BR) a menos que o contexto exija ingles tecnico.
7. Seja objetivo e pratico — foque em output acionavel.
8. Se encontrar um PROBLEMA que NAO e da sua area, use mention_agent para delegar ao agente correto. Descreva o problema claramente. O agente vai resolver e voce sera notificado para continuar.
9. Formate sua resposta com markdown.
10. NAO use emojis — nunca.`;

  // Extra instructions for the organizer agent
  const roleExtra = role === 'organizer'
    ? `\n\n## Instrucoes especiais do Organizer
Voce e o agente que garante que o projeto esteja organizado de forma profissional.
NAO consulte o PM — decida voce mesmo o melhor padrao baseado na stack e nos arquivos existentes.

## Sua abordagem (NESTA ORDEM):
1. Use list_files para mapear TODA a estrutura atual do projeto
2. Use read_file nos arquivos principais para entender a stack (package.json, tsconfig, etc)
3. IDENTIFIQUE o design pattern mais adequado (Clean Architecture, MVC, DDD, Hexagonal, Modular, etc) baseado na stack e no que ja existe
4. REORGANIZE as pastas e arquivos:
   - Crie as novas pastas via write_file (escreva um arquivo index dentro delas)
   - Mova arquivos: leia o conteudo (read_file), escreva no novo caminho (write_file), delete o antigo (run_command: rm ou del)
   - Atualize imports/requires quebrados nos arquivos movidos
5. Corrija arquivos fora do padrao profissional: nomes inconsistentes, pastas bagunçadas, arquivos soltos na raiz que deveriam estar em src/
6. Escreva um arquivo REORGANIZATION.md na raiz com: pattern escolhido, estrutura antes/depois, lista de mudancas
7. NAO faca git add/commit/push — o agente Git cuida disso

## Regras criticas
- DECIDA o pattern sozinho. Nao perca tempo consultando outros agentes.
- Se o projeto ja esta bem organizado, faca apenas ajustes menores e reporte.
- Use write_file para TODAS as mudancas. Nao descreva — FACA.`
    : '';

  // Extra instructions for the git agent
  const gitExtra = role === 'git'
    ? `\n\n## Instrucoes especiais do Git Agent
Voce e o agente responsavel por finalizar o repositorio Git.

## Sua abordagem (NESTA ORDEM):
1. Use run_command para verificar o estado do repo: git status
2. Descubra a branch atual: git rev-parse --abbrev-ref HEAD
3. Se estiver na main/master, crie feature branch: git checkout -b feature/<slug>-<8chars-id>
4. Stage todas mudancas: git add -A
5. Gere uma mensagem de commit profissional em ingles, formato conventional commits (feat:, fix:, refactor:, etc)
6. Commit: git commit -m "<mensagem>" (inclua no body o Pipeline ID)
7. Push: git push -u origin <branch>
8. Se gh cli estiver disponivel, abra PR: gh pr create --title "<titulo>" --body "<descricao>" --base main
9. MERGE na main:
   a. git checkout main
   b. git pull origin main
   c. git merge <feature-branch> --no-ff -m "Merge branch '<feature-branch>'"
   d. Se houver conflitos: abra os arquivos com read_file, resolva editando com write_file, depois git add -A && git commit --no-edit
   e. git push origin main
10. Limpe a feature branch: git branch -d <feature-branch> && git push origin --delete <feature-branch>

## Regras criticas
- SEMPRE use run_command para executar comandos git
- Se git push falhar (auth, remote), reporte o erro mas NAO falhe a task
- Se merge tiver conflitos, RESOLVA usando read_file + write_file nos arquivos conflitantes
- Se gh cli nao estiver disponivel, apenas reporte que o PR deve ser criado manualmente
- NUNCA faca force push
- So modifique arquivos para resolver conflitos de merge`
    : '';

  // Extra instructions for the dead-code cleaner agent
  const deadCodeExtra = role === 'dead-code'
    ? `\n\n## Instrucoes especiais do Dead Code Cleaner
Voce e o agente responsavel por limpar codigo morto do projeto.
Voce recebe um CODE_MAP nos outputs anteriores com o grafo de dependencias completo.

## Sua abordagem (NESTA ORDEM):
1. LEIA o CODE_MAP nos outputs anteriores — ele mostra todos os arquivos, seus imports, exports e quem os importa
2. Identifique arquivos marcados como [ORPHAN] — ninguem os importa
3. Para cada orfao, verifique com read_file se realmente e codigo morto (pode ser entrypoint, config, ou script)
4. DELETE arquivos 100%% mortos: run_command para rm/del
5. Para arquivos parcialmente mortos (tem exports vivos e mortos), use read_file + write_file para remover so os exports mortos
6. Use search_code para confirmar que um export nao e usado em nenhum lugar antes de remover
7. Ao final, liste tudo que foi removido

## NAO DELETE (safe list):
- package.json, tsconfig*.json, *.config.js/ts
- Arquivos de teste (*.test.*, *.spec.*)
- Arquivos .d.ts
- README, LICENSE, .md files
- Entrypoints (index.ts, main.ts, app.ts, server.ts)
- Arquivos referenciados em package.json (main, bin, scripts)

## Regras criticas
- SEMPRE confirme com search_code antes de deletar
- Se em duvida, NAO delete — melhor deixar do que quebrar
- Use run_command para deletar arquivos, write_file para editar
- Faca git add -A && git commit -m "chore: remove dead code" ao final`
    : '';

  // Extra instructions for the troubleshooter agent
  const troubleshooterExtra = role === 'troubleshooter'
    ? `\n\n## Instrucoes especiais do Troubleshooter
Voce e o agente de emergencia. Outro agente falhou e o PM te chamou pra resolver.

## Sua abordagem (NESTA ORDEM):
1. LEIA o feedback do PM nos outputs anteriores — ele explica exatamente o que deu errado
2. Use list_files e read_file para entender o estado ATUAL do workspace
3. IDENTIFIQUE a causa raiz (arquivo faltando? codigo errado? import quebrado?)
4. Use write_file para CRIAR ou CORRIGIR cada arquivo necessario
5. Se precisar deletar arquivos, use delete_file ou run_command (rm/del)
6. Ao final, use report_error para DOCUMENTAR o erro para os devs:
   - Qual agente errou e por que
   - O que o PM reportou
   - O que voce corrigiu
   - Quais arquivos foram alterados

## Regras criticas
- VOCE DEVE usar write_file. Se nao criar/corrigir arquivos, voce tambem falhou.
- VOCE DEVE usar report_error ao final. O report e para os devs humanos entenderem o que a IA errou.
- Nao analise apenas — RESOLVA. Codigo, nao teoria.
- Voce tem UMA chance. Nao existe retry apos voce.
- Se a tarefa original pedia implementar algo, IMPLEMENTE.
- Se faltam arquivos, CRIE-OS com conteudo funcional.`
    : '';

  const prev = ctx.previousOutputs.length > 0
    ? '\n\n## Outputs anteriores dos agentes\n' + ctx.previousOutputs.map(
      p => `### ${AGENT_META[p.agent].label}\n${p.output.substring(0, 3000)}`
    ).join('\n\n')
    : '';

  const feedback = ctx.rejectionFeedback
    ? `\n\n## FEEDBACK DE REJEICAO (prioridade alta)\n${ctx.rejectionFeedback}`
    : '';

  return base + roleExtra + troubleshooterExtra + gitExtra + deadCodeExtra + prev + feedback;
}

function buildPMAutoAssignPrompt(
  objective: string,
  phases: { name: string; agents: AgentRole[] }[],
  availableModels: DiscoveredModel[],
  preset?: QualityPreset,
): string {
  const presetData = preset ? QUALITY_PRESETS[preset] : null;
  const costFilter = presetData
    ? `\n- RESTRICAO DE CUSTO: So use modelos com custo entre ${presetData.costRange.min}x e ${presetData.costRange.max}x`
    : '';
  const filteredModels = presetData
    ? availableModels.filter(m => m.costMultiplier >= presetData.costRange.min && m.costMultiplier <= presetData.costRange.max)
    : availableModels;
  const models = filteredModels.map(m => `- \`${m.family}\` (${m.label}, tier: ${m.tier}, custo: ${m.costMultiplier}x)`).join('\n');
  const agents = phases.flatMap(p => p.agents).map(a => `- ${a}: ${AGENT_META[a].description}`).join('\n');
  const pmNote = presetData
    ? `- PM usa \`${presetData.models['product-manager']}\` (ja definido pelo modo ${preset})`
    : '- PM usa claude-opus-4.6 (ja definido)';

  return `Voce e o Product Manager do time ThinkCoffee.
Seu trabalho agora e ESCOLHER qual modelo de IA cada agente do pipeline deve usar.

## Modo ativo: ${preset ? `${QUALITY_PRESETS[preset].label} (${preset})` : 'auto'}

## Objetivo do pipeline
${objective}

## Agentes no pipeline
${agents}

## Modelos disponiveis (dentro do tier de custo)
${models}

## Regras de escolha
${pmNote}${costFilter}
- Para tarefas complexas de raciocinio/arquitetura: priorize modelos com tier premium ou standard alto
- Para implementacao de codigo: priorize modelos com tier code
- Para tarefas padrao: modelos standard
- Para tarefas leves/rapidas: modelos fast
- Code Review deve usar o modelo mais forte disponivel no tier
- DIVERSIFIQUE vendors quando possivel (Anthropic, OpenAI, Google, xAI, Microsoft)

Responda APENAS com JSON valido, sem markdown. Formato:
[{"role": "architect", "model": "modelo-family", "reason": "justificativa curta"}, ...]

NAO inclua product-manager na lista (ja esta definido).`;
}

function buildPMSelectModePrompt(objective: string): string {
  const presetInfo = Object.entries(QUALITY_PRESETS).map(([key, p]) =>
    `### ${p.label} (\`${key}\`)\n- Custo: ${p.costRange.min}x a ${p.costRange.max}x\n- ${p.subtitle}\n- ${p.description}`
  ).join('\n\n');

  return `Voce e o Opus, o decisor estrategico do time ThinkCoffee.
Sua tarefa e analisar o objetivo do pipeline e decidir QUAL MODO DE QUALIDADE usar.

## Objetivo do pipeline
${objective}

## Modos disponiveis

${presetInfo}

## Criterios de decisao
- **cafe-soluvel** (0x): Use para tarefas simples, hotfixes, POCs, prototipos, ajustes pequenos, coisas urgentes que nao precisam de qualidade alta. Custo zero.
- **coado-com-carinho** (0.1x-1x): Use para features normais, refactors, tasks de sprint, melhorias incrementais. O dia a dia de desenvolvimento. Bom custo-beneficio.
- **espresso-duplo** (3x): Use para arquitetura de sistema, migrations criticas, lancamentos, features complexas que exigem perfeicao, codigo que sera muito revisado.
- **auto**: Use quando o objetivo exige uma combinacao heterogenea de modelos — ex: backend precisa de modelo premium mas frontend pode ser simples. Voce escolhe livremente o melhor modelo para cada agente sem restricao de custo.

## Regras
- Analise a COMPLEXIDADE, CRITICIDADE e IMPACTO do objetivo
- Se tiver duvida entre dois modos, prefira o mais barato (economize!)
- Objetivo vago ou simples → cafe-soluvel
- Objetivo claro com escopo medio → coado-com-carinho
- Objetivo complexo, critico, ou que exige excelencia → espresso-duplo
- Objetivo heterogeneo (partes simples + partes criticas) → auto

Responda APENAS com JSON valido, sem markdown:
{"mode": "cafe-soluvel", "reason": "justificativa curta de porque este modo"}

Use EXATAMENTE um dos nomes: cafe-soluvel, coado-com-carinho, espresso-duplo, auto.`;
}

function buildPMPlanPhasesPrompt(objective: string): string {
  const roles = Object.entries(AGENT_META)
    .map(([role, meta]) => `- \`${role}\`: ${meta.description}`)
    .join('\n');

  return `Voce e o Product Manager (PM) do time ThinkCoffee, rodando em claude-opus-4.6.
Seu trabalho agora e PLANEJAR AS FASES da pipeline para o objetivo abaixo.

## Objetivo
${objective}

## Agentes disponiveis
${roles}

## Regras
- Voce decide QUANTAS fases, QUAIS sao as fases, e QUAIS AGENTES participam de cada fase
- Cada fase tem: name (string), order (int comecando de 0), parallel (bool — se os agentes da fase rodam em paralelo), agents (lista de roles)
- Cada fase pode ter 1 ou mais agentes
- A PRIMEIRA fase deve SEMPRE incluir "product-manager" para planejamento
- Fases de implementacao que tem backend+frontend+devops podem ser paralelas
- Fases de teste e review devem vir DEPOIS da implementacao
- NAO crie fases desnecessarias. Se o objetivo for simples, menos fases. Se for complexo, mais fases
- Voce pode customizar a descricao da tarefa de cada agente em cada fase via taskDescriptions
- Se precisar de uma fase de "Refatoracao", "Design de UI", "Seguranca", etc, voce pode criar

## Formato de resposta
Responda APENAS com JSON valido (array), sem markdown, sem explicacao. Formato:
[
  {
    "name": "Planning",
    "order": 0,
    "parallel": false,
    "agents": ["product-manager"],
    "taskDescriptions": {
      "product-manager": {
        "title": "Definir requisitos e backlog",
        "description": "Analisar objetivo e produzir requisitos, criterios de aceite, user stories."
      }
    }
  },
  {
    "name": "Architecture",
    "order": 1,
    "parallel": false,
    "agents": ["architect"],
    "taskDescriptions": {
      "architect": {
        "title": "Definir arquitetura tecnica",
        "description": "Stack, estrutura de pastas, contratos de API, modelo de dados."
      }
    }
  }
]

Pense bem no objetivo e crie as fases mais adequadas. Adapte a pipeline ao projeto.`;
}

// ─── Agent Tools ─────────────────────────────────────────────

function getAgentTools(workspace: string): vscode.LanguageModelChatTool[] {
  return [
    {
      name: 'read_file',
      description: 'Read a file from the workspace. Returns file contents.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from workspace root' },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_files',
      description: 'List files/directories at a path in the workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from workspace root (use "." for root)' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Write content to a file in the workspace. Creates directories as needed.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from workspace root' },
          content: { type: 'string', description: 'Full file content to write' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'search_code',
      description: 'Search for a text pattern across workspace files. Returns matching lines with file paths.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Text or regex pattern to search for' },
          fileGlob: { type: 'string', description: 'Optional glob pattern to filter files (e.g. **/*.ts)' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'run_command',
      description: 'Run a shell command in the workspace directory. Returns stdout/stderr.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
        },
        required: ['command'],
      },
    },
    {
      name: 'move_file',
      description: 'Move a file or directory to a new location. Parent directories are created automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Relative path of the file/directory to move' },
          destination: { type: 'string', description: 'Relative destination path (including filename)' },
        },
        required: ['source', 'destination'],
      },
    },
    {
      name: 'copy_file',
      description: 'Copy a file to a new location. Parent directories are created automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Relative path of the file to copy' },
          destination: { type: 'string', description: 'Relative destination path (including filename)' },
        },
        required: ['source', 'destination'],
      },
    },
    {
      name: 'rename_file',
      description: 'Rename a file or directory in place.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Relative path of the file/directory to rename' },
          newName: { type: 'string', description: 'New name (just the filename, not a full path)' },
        },
        required: ['source', 'newName'],
      },
    },
    {
      name: 'delete_file',
      description: 'Delete a file or empty directory from the workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file or empty directory to delete' },
          recursive: { type: 'boolean', description: 'If true, delete directory and all contents recursively. Use with caution.' },
        },
        required: ['path'],
      },
    },
    {
      name: 'create_directory',
      description: 'Create a directory (and any missing parent directories) in the workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the directory to create' },
        },
        required: ['path'],
      },
    },
    {
      name: 'mention_agent',
      description: 'Delegate a problem to another agent. Use when you find an issue outside your expertise. The mentioned agent will fix it and you will be notified when done so you can continue.',
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'Agent role to mention (e.g. backend, frontend, qa, architect, troubleshooter)' },
          message: { type: 'string', description: 'What you need this agent to do — describe the problem clearly' },
          problem: { type: 'string', description: 'Brief description of the problem you found (used for reporting)' },
        },
        required: ['agent', 'message'],
      },
    },
    {
      name: 'report_error',
      description: 'Create an internal error report for developers. Use after fixing an AI error to document what went wrong, what was fixed, and lessons learned.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title for the error report' },
          originalAgent: { type: 'string', description: 'Agent role that caused the error' },
          errorDescription: { type: 'string', description: 'What went wrong — the AI mistake' },
          pmFeedback: { type: 'string', description: 'PM feedback that triggered the fix' },
          fix: { type: 'string', description: 'What was fixed and how' },
          filesChanged: { type: 'string', description: 'Comma-separated list of files created/modified' },
        },
        required: ['title', 'originalAgent', 'errorDescription', 'fix'],
      },
    },
  ];
}

async function handleToolCall(
  toolCall: vscode.LanguageModelToolCallPart,
  workspace: string,
  chat: ChatService,
  agentRole: AgentRole,
): Promise<string> {
  const input = toolCall.input as Record<string, string>;

  switch (toolCall.name) {
    case 'read_file': {
      if (!input.path || typeof input.path !== 'string') return 'Error: path is required (string)';
      const abs = path.resolve(workspace, input.path);
      if (!abs.startsWith(workspace)) return 'Error: Path traversal denied';
      try {
        const content = fs.readFileSync(abs, 'utf-8');
        const lines = content.split('\n');
        return lines.length > 500
          ? lines.slice(0, 500).join('\n') + `\n... (${lines.length - 500} more lines)`
          : content;
      } catch (e: any) {
        return `Error reading file: ${e.message}`;
      }
    }
    case 'list_files': {
      const target = path.resolve(workspace, input.path || '.');
      if (!target.startsWith(workspace) && target !== workspace) return 'Error: Path traversal denied';
      try {
        const entries = fs.readdirSync(target, { withFileTypes: true });
        return entries
          .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
          .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
          .map(e => e.isDirectory() ? `${e.name}/` : e.name)
          .join('\n');
      } catch (e: any) {
        return `Error listing files: ${e.message}`;
      }
    }
    case 'write_file': {
      if (!input.path || typeof input.path !== 'string') return 'Error: path is required (string)';
      if (!input.content && input.content !== '') return 'Error: content is required (string)';
      const abs = path.resolve(workspace, input.path);
      if (!abs.startsWith(workspace)) return 'Error: Path traversal denied';
      try {
        const dir = path.dirname(abs);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(abs, input.content, 'utf-8');
        chat.send({
          sender: agentRole,
          senderLabel: agentLabel(agentRole),
          content: `Arquivo escrito: \`${input.path}\``,
          type: 'code',
        });
        return `File written: ${input.path}`;
      } catch (e: any) {
        return `Error writing file: ${e.message}`;
      }
    }
    case 'search_code': {
      try {
        const glob = input.fileGlob || '**/*';
        const results = await vscode.workspace.findFiles(glob, '**/node_modules/**', 50);
        const matches: string[] = [];
        const regex = new RegExp(input.pattern, 'gi');
        for (const uri of results) {
          try {
            const content = fs.readFileSync(uri.fsPath, 'utf-8');
            const lines = content.split('\n');
            lines.forEach((line, i) => {
              if (regex.test(line)) {
                const rel = path.relative(workspace, uri.fsPath).replace(/\\/g, '/');
                matches.push(`${rel}:${i + 1}: ${line.trim()}`);
              }
              regex.lastIndex = 0;
            });
          } catch { /* skip binary files */ }
          if (matches.length >= 100) break;
        }
        return matches.length > 0 ? matches.join('\n') : 'No matches found.';
      } catch (e: any) {
        return `Error searching: ${e.message}`;
      }
    }
    case 'run_command': {
      try {
        const { execSync } = require('child_process');
        const output = execSync(input.command, {
          cwd: workspace,
          encoding: 'utf-8',
          timeout: 30000,
          shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
        });
        chat.send({
          sender: agentRole,
          senderLabel: agentLabel(agentRole),
          content: `\`${input.command}\`\n\n\`\`\`\n${(output || '(no output)').trim().substring(0, 2000)}\n\`\`\``,
          type: 'code',
        });
        return output.trim().substring(0, 4000) || '(no output)';
      } catch (e: any) {
        return `Command failed: ${e.stderr || e.message}`.substring(0, 2000);
      }
    }
    case 'move_file': {
      if (!input.source || !input.destination) return 'Error: source and destination are required';
      const absSrc = path.resolve(workspace, input.source);
      const absDst = path.resolve(workspace, input.destination);
      if (!absSrc.startsWith(workspace)) return 'Error: Path traversal denied (source)';
      if (!absDst.startsWith(workspace)) return 'Error: Path traversal denied (destination)';
      try {
        if (!fs.existsSync(absSrc)) return `Error: source not found: ${input.source}`;
        const dstDir = path.dirname(absDst);
        if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
        fs.renameSync(absSrc, absDst);
        chat.send({
          sender: agentRole,
          senderLabel: agentLabel(agentRole),
          content: `Movido: \`${input.source}\` -> \`${input.destination}\``,
          type: 'code',
        });
        return `Moved: ${input.source} -> ${input.destination}`;
      } catch (e: any) {
        return `Error moving file: ${e.message}`;
      }
    }
    case 'copy_file': {
      if (!input.source || !input.destination) return 'Error: source and destination are required';
      const absSrc = path.resolve(workspace, input.source);
      const absDst = path.resolve(workspace, input.destination);
      if (!absSrc.startsWith(workspace)) return 'Error: Path traversal denied (source)';
      if (!absDst.startsWith(workspace)) return 'Error: Path traversal denied (destination)';
      try {
        if (!fs.existsSync(absSrc)) return `Error: source not found: ${input.source}`;
        const dstDir = path.dirname(absDst);
        if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
        fs.copyFileSync(absSrc, absDst);
        chat.send({
          sender: agentRole,
          senderLabel: agentLabel(agentRole),
          content: `Copiado: \`${input.source}\` -> \`${input.destination}\``,
          type: 'code',
        });
        return `Copied: ${input.source} -> ${input.destination}`;
      } catch (e: any) {
        return `Error copying file: ${e.message}`;
      }
    }
    case 'rename_file': {
      if (!input.source || !input.newName) return 'Error: source and newName are required';
      if (input.newName.includes('/') || input.newName.includes('\\')) return 'Error: newName must be a filename, not a path';
      const absSrc = path.resolve(workspace, input.source);
      if (!absSrc.startsWith(workspace)) return 'Error: Path traversal denied';
      const absDst = path.join(path.dirname(absSrc), input.newName);
      if (!absDst.startsWith(workspace)) return 'Error: Path traversal denied';
      try {
        if (!fs.existsSync(absSrc)) return `Error: source not found: ${input.source}`;
        fs.renameSync(absSrc, absDst);
        const relDst = path.relative(workspace, absDst).replace(/\\/g, '/');
        chat.send({
          sender: agentRole,
          senderLabel: agentLabel(agentRole),
          content: `Renomeado: \`${input.source}\` -> \`${relDst}\``,
          type: 'code',
        });
        return `Renamed: ${input.source} -> ${relDst}`;
      } catch (e: any) {
        return `Error renaming: ${e.message}`;
      }
    }
    case 'delete_file': {
      if (!input.path || typeof input.path !== 'string') return 'Error: path is required (string)';
      const abs = path.resolve(workspace, input.path);
      if (!abs.startsWith(workspace)) return 'Error: Path traversal denied';
      if (abs === workspace) return 'Error: Cannot delete workspace root';
      try {
        if (!fs.existsSync(abs)) return `Error: not found: ${input.path}`;
        const stat = fs.statSync(abs);
        if (stat.isDirectory()) {
          const recursive = (input as any).recursive === true;
          if (recursive) {
            fs.rmSync(abs, { recursive: true, force: true });
          } else {
            fs.rmdirSync(abs); // fails if not empty
          }
        } else {
          fs.unlinkSync(abs);
        }
        chat.send({
          sender: agentRole,
          senderLabel: agentLabel(agentRole),
          content: `Deletado: \`${input.path}\``,
          type: 'code',
        });
        return `Deleted: ${input.path}`;
      } catch (e: any) {
        return `Error deleting: ${e.message}`;
      }
    }
    case 'create_directory': {
      if (!input.path || typeof input.path !== 'string') return 'Error: path is required (string)';
      const abs = path.resolve(workspace, input.path);
      if (!abs.startsWith(workspace)) return 'Error: Path traversal denied';
      try {
        fs.mkdirSync(abs, { recursive: true });
        chat.send({
          sender: agentRole,
          senderLabel: agentLabel(agentRole),
          content: `Pasta criada: \`${input.path}\``,
          type: 'code',
        });
        return `Directory created: ${input.path}`;
      } catch (e: any) {
        return `Error creating directory: ${e.message}`;
      }
    }
    case 'report_error': {
      const reportInput = input as Record<string, string>;
      if (!reportInput.title || !reportInput.originalAgent || !reportInput.errorDescription || !reportInput.fix) {
        return 'Error: title, originalAgent, errorDescription and fix are required';
      }
      try {
        const reportsDir = path.join(workspace, '.thinkcoffee', 'reports');
        if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const slug = reportInput.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40);
        const reportPath = path.join(reportsDir, `${timestamp}_${slug}.md`);
        const content = `# Error Report: ${reportInput.title}\n\n` +
          `**Data**: ${new Date().toISOString()}\n` +
          `**Agente original**: ${reportInput.originalAgent}\n` +
          `**Corrigido por**: ${agentRole}\n\n` +
          `## Erro da IA\n${reportInput.errorDescription}\n\n` +
          (reportInput.pmFeedback ? `## Feedback do PM\n${reportInput.pmFeedback}\n\n` : '') +
          `## Correcao aplicada\n${reportInput.fix}\n\n` +
          (reportInput.filesChanged ? `## Arquivos alterados\n${reportInput.filesChanged.split(',').map((f: string) => `- ${f.trim()}`).join('\n')}\n` : '');
        fs.writeFileSync(reportPath, content, 'utf-8');
        chat.send({
          sender: agentRole,
          senderLabel: agentLabel(agentRole),
          content: `Report criado: \`.thinkcoffee/reports/${path.basename(reportPath)}\``,
          type: 'code',
        });
        return `Report written: .thinkcoffee/reports/${path.basename(reportPath)}`;
      } catch (e: any) {
        return `Error writing report: ${e.message}`;
      }
    }
    case 'mention_agent': {
      // Record the mention — AgentService will pick it up
      return `Mentioned @${input.agent}: "${input.message}" — the agent will be invoked and you will be notified when done.`;
    }
    default:
      return `Unknown tool: ${toolCall.name}`;
  }
}

// ─── AgentService ────────────────────────────────────────────

export class AgentService {
  private _running = new Map<string, RunningAgent>(); // taskId -> RunningAgent
  private _directInvocations = new Map<string, Set<AgentRole>>(); // pipelineId -> active direct invocations
  private _pendingMentions: { from: AgentRole; to: AgentRole; message: string; pipelineId: string; problem?: string }[] = [];
  private _activePipelineLoops = new Set<string>(); // pipelineIds with active PM loops
  private _globalChat: () => ChatService;
  private _getChatForPipeline: (pipelineId: string) => ChatService;
  private _pipelines: PipelineService;
  private _contexts: ContextService;
  private _decisions: DecisionService;
  private _getProject: () => { id: string; name: string } | null;
  private _onAgentStateChange = new vscode.EventEmitter<void>();
  readonly onAgentStateChange = this._onAgentStateChange.event;

  /** Get chat for a specific pipeline */
  private _pipelineChat(pipelineId: string): ChatService {
    return this._getChatForPipeline(pipelineId);
  }

  /** Get global chat (pre-pipeline operations) */
  private get _chat(): ChatService { return this._globalChat(); }

  constructor(
    globalChat: () => ChatService,
    getChatForPipeline: (pipelineId: string) => ChatService,
    pipelines: PipelineService,
    contexts: ContextService,
    decisions: DecisionService,
    getProject: () => { id: string; name: string } | null,
  ) {
    this._globalChat = globalChat;
    this._getChatForPipeline = getChatForPipeline;
    this._pipelines = pipelines;
    this._contexts = contexts;
    this._decisions = decisions;
    this._getProject = getProject;
  }

  /** Track a direct invocation (typing indicator) for a pipeline */
  private _trackDirect(pipelineId: string, role: AgentRole): void {
    let set = this._directInvocations.get(pipelineId);
    if (!set) { set = new Set(); this._directInvocations.set(pipelineId, set); }
    set.add(role);
    this._onAgentStateChange.fire();
  }

  /** Remove a direct invocation tracker */
  private _untrackDirect(pipelineId: string, role: AgentRole): void {
    const set = this._directInvocations.get(pipelineId);
    if (set) { set.delete(role); if (set.size === 0) this._directInvocations.delete(pipelineId); }
    this._onAgentStateChange.fire();
  }

  /** Get currently running agents */
  getRunning(pipelineId?: string): { role: AgentRole; taskId: string; pipelineId: string; elapsed: number }[] {
    let entries = Array.from(this._running.values());
    if (pipelineId) {
      entries = entries.filter(r => r.pipelineId === pipelineId);
    }
    const result = entries.map(r => ({
      role: r.role,
      taskId: r.taskId,
      pipelineId: r.pipelineId,
      elapsed: Date.now() - r.startedAt,
    }));
    // Include direct invocations per-pipeline
    for (const [pid, roles] of this._directInvocations) {
      if (pipelineId && pid !== pipelineId) continue;
      for (const role of roles) {
        if (!result.some(a => a.role === role && a.pipelineId === pid)) {
          result.push({ role, taskId: `direct-${role}`, pipelineId: pid, elapsed: 0 });
        }
      }
    }
    return result;
  }

  /** Stop a running agent */
  stopAgent(taskId: string): void {
    const running = this._running.get(taskId);
    if (running) {
      running.cts.cancel();
      this._running.delete(taskId);
      this._pipelineChat(running.pipelineId).send({
        sender: 'system',
        senderLabel: 'Pipeline',
        content: `${AGENT_META[running.role].label} foi cancelado.`,
        type: 'info',
      });
      this._onAgentStateChange.fire();
    }
  }

  /** Stop all running agents */
  stopAll(): void {
    for (const [taskId] of this._running) {
      this.stopAgent(taskId);
    }
  }

  // ─── PM plans the phases ─────────────────────────────────

  async planPhases(objective: string): Promise<PhaseTemplate[] | null> {
    this._chat.send({
      sender: 'product-manager',
      senderLabel: agentLabel('product-manager'),
      content: 'Analisando o objetivo para planejar as fases da pipeline...',
      type: 'info',
    });

    try {
      const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: getActivePMModel() });
      if (!model) {
        this._chat.send({
          sender: 'system', senderLabel: 'System',
          content: 'Modelo PM indisponivel. Usando fases padrao.',
          type: 'error',
        });
        return null;
      }

      const prompt = buildPMPlanPhasesPrompt(objective);
      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const cts = new vscode.CancellationTokenSource();

      // Track PM as running for typing indicator
      this._trackDirect('', 'product-manager');
      this._onAgentStateChange.fire();

      const response = await model.sendRequest(messages, {}, cts.token);
      let fullText = '';
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          fullText += part.value;
        }
      }
      cts.dispose();

      // Parse JSON response
      const jsonMatch = fullText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('PM nao retornou JSON valido para as fases');

      const rawPhases: any[] = JSON.parse(jsonMatch[0]);

      // Validate and cast
      const phases: PhaseTemplate[] = rawPhases.map((rp, idx) => ({
        name: String(rp.name || `Phase ${idx + 1}`),
        order: typeof rp.order === 'number' ? rp.order : idx,
        parallel: Boolean(rp.parallel),
        agents: (rp.agents as string[]).filter((a: string) =>
          Object.keys(AGENT_META).includes(a)
        ) as AgentRole[],
        taskDescriptions: rp.taskDescriptions,
      }));

      // Ensure at least one phase with a valid agent
      if (phases.length === 0 || phases.some(p => p.agents.length === 0)) {
        throw new Error('PM retornou fases invalidas (sem agentes)');
      }

      // Report to chat
      const report = phases.map((p, i) =>
        `${i + 1}. **${p.name}** — ${p.agents.map(a => AGENT_META[a as AgentRole]?.label || a).join(', ')}${p.parallel ? ' (paralelo)' : ''}`
      ).join('\n');

      this._chat.send({
        sender: 'product-manager',
        senderLabel: agentLabel('product-manager'),
        content: `Pipeline planejada com **${phases.length} fases**:\n\n${report}`,
        type: 'response',
      });

      return phases;
    } catch (err: any) {
      this._chat.send({
        sender: 'system', senderLabel: 'System',
        content: `Falha ao planejar fases: ${err.message}. Usando fases padrao.`,
        type: 'error',
      });
      return null;
    } finally {
      this._untrackDirect('', 'product-manager');
      this._onAgentStateChange.fire();
    }
  }

  // ─── PM selects quality mode via Opus ────────────────────

  async pmSelectMode(objective: string): Promise<QualityPreset | null> {
    this._chat.send({
      sender: 'product-manager',
      senderLabel: agentLabel('product-manager'),
      content: 'Analisando objetivo para decidir o modo de qualidade...',
      type: 'info',
    });

    try {
      // Mode selection is ALWAYS done by Opus (even if the resulting mode uses a non-Opus PM)
      const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: getActivePMModel() });
      if (!model) {
        this._chat.send({
          sender: 'system', senderLabel: 'System',
          content: 'Modelo PM indisponivel. Usando modo cafe-soluvel como fallback.',
          type: 'error',
        });
        applyQualityPreset('cafe-soluvel');
        return 'cafe-soluvel';
      }

      const prompt = buildPMSelectModePrompt(objective);
      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const cts = new vscode.CancellationTokenSource();
      const response = await model.sendRequest(messages, {}, cts.token);

      let fullText = '';
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          fullText += part.value;
        }
      }
      cts.dispose();

      // Parse JSON response
      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('PM nao retornou JSON valido para selecao de modo');

      const result = JSON.parse(jsonMatch[0]) as { mode: string; reason: string };

      // Handle 'auto' mode — PM picks models freely without cost constraints
      if (result.mode === 'auto') {
        const config = loadAgentConfig();
        config.mode = 'auto';
        saveAgentConfig(config);

        this._chat.send({
          sender: 'product-manager',
          senderLabel: agentLabel('product-manager'),
          content: `Modo selecionado: **Automatico** (PM escolhe livremente)\n\n> ${result.reason}\n\nPM vai atribuir o melhor modelo para cada agente sem restricao de custo.`,
          type: 'response',
        });

        return null; // null signals auto mode to caller
      }

      const mode = result.mode as QualityPreset;

      if (!QUALITY_PRESETS[mode]) {
        throw new Error(`Modo invalido retornado pelo PM: ${result.mode}`);
      }

      // Apply the preset
      const config = applyQualityPreset(mode);
      const presetData = QUALITY_PRESETS[mode];

      this._chat.send({
        sender: 'product-manager',
        senderLabel: agentLabel('product-manager'),
        content: `Modo selecionado: **${presetData.label}** (${presetData.subtitle})\n\n> ${result.reason}\n\nPM deste pipeline: \`${config.models['product-manager']}\` (custo: ${presetData.costRange.min}x-${presetData.costRange.max}x)`,
        type: 'response',
      });

      return mode;
    } catch (err: any) {
      this._chat.send({
        sender: 'system', senderLabel: 'System',
        content: `Falha ao selecionar modo: ${err.message}. Usando cafe-soluvel.`,
        type: 'error',
      });
      applyQualityPreset('cafe-soluvel');
      return 'cafe-soluvel';
    }
  }

  // ─── Auto-assign models via PM ──────────────────────────

  async autoAssignModels(pipeline: Pipeline): Promise<AgentModelConfig | null> {
    const project = this._getProject();
    if (!project) return null;

    const config = loadAgentConfig();
    const activePreset = isQualityPreset(config.mode) ? config.mode as QualityPreset : undefined;
    const pmModel = activePreset ? getPMModelForPreset(activePreset) : getModelForAgent('product-manager', config);

    this._pipelineChat(pipeline.id).send({
      sender: 'product-manager',
      senderLabel: agentLabel('product-manager', pmModel),
      content: 'Atribuindo modelos aos agentes dentro do tier de custo...',
      type: 'info',
    });

    try {
      const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: pmModel });
      if (!model) {
        this._pipelineChat(pipeline.id).send({
          sender: 'system', senderLabel: 'System',
          content: `${pmModel} nao disponivel. Usando configuracao do preset.`,
          type: 'error',
        });
        return config;
      }

      const dynamicModels = (await discoverModels()).filter(m => m.costMultiplier === 0);
      const prompt = buildPMAutoAssignPrompt(
        pipeline.objective,
        pipeline.phases.map(p => ({ name: p.name, agents: p.agents })),
        dynamicModels,
        activePreset,
      );

      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const cts = new vscode.CancellationTokenSource();
      const response = await model.sendRequest(messages, {}, cts.token);

      let fullText = '';
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          fullText += part.value;
        }
      }
      cts.dispose();

      // Parse JSON response
      const jsonMatch = fullText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('PM nao retornou JSON valido');

      const assignments: PMModelAssignment[] = JSON.parse(jsonMatch[0]);

      // Validate PM assignments: extension policy is free-only (0x)
      const presetData = activePreset ? QUALITY_PRESETS[activePreset] : null;
      for (const a of assignments) {
        if (a.role !== 'product-manager') {
          const cost = getModelCost(a.model);
          if (cost !== 0) {
            const fallbackModel = QUALITY_PRESETS['free-tier'].models[a.role as AgentRole] || getModelForAgent(a.role as AgentRole, config);
            a.model = fallbackModel;
            a.reason += ' (modelo pago bloqueado; substituido por modelo gratuito)';
          } else if (presetData && config.mode !== 'auto' && (cost < presetData.costRange.min || cost > presetData.costRange.max)) {
            // Keep old preset guard for non-auto modes.
            const presetDefault = QUALITY_PRESETS[activePreset!].models[a.role as AgentRole];
            if (presetDefault) {
              a.model = presetDefault;
              a.reason += ' (custo corrigido pelo sistema)';
            }
          }
          config.models[a.role as AgentRole] = a.model;
        }
      }

      saveAgentConfig(config);

      // Report assignments in chat
      const report = assignments.map(a =>
        `- **${AGENT_META[a.role as AgentRole]?.label || a.role}**: \`${a.model}\` — ${a.reason}`
      ).join('\n');

      const effectivePMModel = getModelForAgent('product-manager', config);
      this._pipelineChat(pipeline.id).send({
        sender: 'product-manager',
        senderLabel: agentLabel('product-manager', pmModel),
        content: `Modelos atribuidos pelo PM:\n\n${report}\n\n- **Product Manager**: \`${effectivePMModel}\``,
        type: 'response',
      });

      return config;

    } catch (err: any) {
      this._pipelineChat(pipeline.id).send({
        sender: 'system', senderLabel: 'System',
        content: `Falha ao auto-atribuir modelos: ${err.message}. Usando config do preset.`,
        type: 'error',
      });
      return config;
    }
  }

  // ─── Run pipeline phase ─────────────────────────────────

  async runPhase(projectId: string, pipelineId: string): Promise<void> {
    const pipeline = this._pipelines.get(projectId, pipelineId);
    if (!pipeline) return;

    const phase = pipeline.phases[pipeline.currentPhase];
    if (!phase || phase.status !== 'in-progress') return;

    const workspace = pipeline.workspace || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const project = this._getProject();
    if (!project) return;

    // Collect prior outputs from completed phases
    const previousOutputs: { agent: AgentRole; output: string }[] = [];
    for (let i = 0; i < pipeline.currentPhase; i++) {
      for (const task of pipeline.phases[i].tasks) {
        if (task.output) {
          previousOutputs.push({ agent: task.agent, output: task.output });
        }
      }
    }

    this._pipelineChat(pipelineId).send({
      sender: 'system',
      senderLabel: 'Pipeline',
      content: `Fase **${phase.name}** iniciada. Agentes: ${phase.agents.map(a => AGENT_META[a].label).join(', ')}${phase.parallel ? ' (paralelo)' : ''}`,
      type: 'info',
    });

    // Check for rejection feedback
    const rejectionFeedback = (phase as any).rejectionFeedback;

    // Only run tasks that are pending (skip completed or already in-progress)
    const tasksToRun = phase.tasks.filter(t => t.status === 'pending');
    if (tasksToRun.length === 0) return;

    if (phase.parallel) {
      // Run all agents in parallel
      const promises = tasksToRun.map(task =>
        this._runAgent(task, {
          projectId: project.id,
          projectName: project.name,
          workspace,
          objective: pipeline.objective,
          previousOutputs,
          task,
          rejectionFeedback,
        }, pipelineId)
      );
      await Promise.allSettled(promises);
    } else {
      // Run sequentially
      for (const task of tasksToRun) {
        await this._runAgent(task, {
          projectId: project.id,
          projectName: project.name,
          workspace,
          objective: pipeline.objective,
          previousOutputs,
          task,
          rejectionFeedback,
        }, pipelineId);
      }
    }

    // Process pending @mentions from this phase
    await this._processPendingMentions(projectId, pipelineId, workspace, previousOutputs);
  }

  // ─── Run a single agent ─────────────────────────────────

  private async _runAgent(task: AgentTask, ctx: AgentContext, pipelineId: string): Promise<void> {
    // ── Ollama path: if enabled, use local model instead of VS Code API ──
    const ollamaClient = getOllamaClient();
    if (ollamaClient.isEnabled) {
      return this._runAgentViaOllama(task, ctx, pipelineId);
    }

    const role = task.agent;
    const config = loadAgentConfig();
    const modelFamily = getModelForAgent(role, config);

    // Cost tier guard + hard free-only policy.
    const activePreset = isQualityPreset(config.mode) ? config.mode as QualityPreset : undefined;
    const presetData = activePreset ? QUALITY_PRESETS[activePreset] : null;
    let effectiveFamily = modelFamily;
    const modelCost = getModelCost(modelFamily);
    if (modelCost !== 0) {
      effectiveFamily = QUALITY_PRESETS['free-tier'].models[role] || modelFamily;
    } else if (presetData && config.mode !== 'auto' && modelCost > presetData.costRange.max) {
      effectiveFamily = presetData.models[role] || modelFamily;
    }

    // Select model
    let model: vscode.LanguageModelChat;
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: effectiveFamily });
      if (!models.length) {
        // Fallback: prefer models within the active preset's cost range
        const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        if (!allModels.length) throw new Error('Nenhum modelo Copilot disponivel');

        const maxCost = 0;
        const ranked = presetData?.ranking ?? [];
        const affordable = allModels.filter(m => getModelCost(m.family) <= maxCost);
        const pool = affordable.length ? affordable : allModels.filter(m => getModelCost(m.family) === 0);
        if (!pool.length) throw new Error('Nenhum modelo gratuito (0x) disponivel');

        // Prefer models from the preset ranking (order matters)
        const byRanking = ranked
          .map(fam => pool.find(m => m.family === fam))
          .filter(Boolean) as vscode.LanguageModelChat[];
        model = byRanking[0] ?? pool[0];

        this._pipelineChat(pipelineId).send({
          sender: 'system', senderLabel: 'System',
          content: `${effectiveFamily} indisponivel para ${agentLabel(role)}. Usando ${model.family} (custo: ${getModelCost(model.family)}x).`,
          type: 'info',
        });
      } else {
        model = models[0];
      }
    } catch (err: any) {
      this._pipelines.failTask(ctx.projectId, pipelineId, task.id, err.message);
      this._pipelineChat(pipelineId).send({
        sender: role, senderLabel: agentLabel(role),
        content: `Falha ao iniciar: ${err.message}`,
        type: 'error',
      });
      return;
    }

    // Start task in pipeline
    this._pipelines.startTask(ctx.projectId, pipelineId, task.id);

    const cts = new vscode.CancellationTokenSource();
    this._running.set(task.id, { role, taskId: task.id, pipelineId, cts, startedAt: Date.now() });
    this._onAgentStateChange.fire();

    // Announce in chat
    this._pipelineChat(pipelineId).send({
      sender: role,
      senderLabel: agentLabel(role),
      content: `Iniciando: **${task.title}** (modelo: \`${model.family}\`)`,
      type: 'info',
    });

    const workspace = ctx.workspace;
    const tools = getAgentTools(workspace);
    const systemPrompt = buildSystemPrompt(role, ctx);
    const kickoff = `Execute sua tarefa agora.\n\nTarefa: ${task.title}\n${task.description}\n\nIMPORTANTE: Voce DEVE usar write_file para criar os arquivos. NAO apenas descreva em texto o que faria — use as ferramentas para LER o codigo existente e ESCREVER os arquivos no workspace. Comece lendo a estrutura com list_files e read_file, depois crie/edite arquivos com write_file.`;
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(systemPrompt + '\n\n---\n\n' + kickoff),
    ];

    try {
      let fullOutput = '';
      const filesWritten: string[] = [];
      let toolCallRounds = 0;
      const MAX_TOOL_ROUNDS = 15;

      while (toolCallRounds < MAX_TOOL_ROUNDS) {
        const response = await model.sendRequest(messages, { tools }, cts.token);

        let textAccum = '';
        const pendingToolCalls: vscode.LanguageModelToolCallPart[] = [];

        for await (const part of response.stream) {
          if (cts.token.isCancellationRequested) break;

          if (part instanceof vscode.LanguageModelTextPart) {
            textAccum += part.value;
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            pendingToolCalls.push(part);
          }
        }

        if (textAccum) {
          fullOutput += textAccum;
          // Post text to chat (chunked if long)
          const chunks = splitMessage(textAccum, 3000);
          for (const chunk of chunks) {
            this._pipelineChat(pipelineId).send({
              sender: role,
              senderLabel: agentLabel(role),
              content: chunk,
              type: 'response',
            });
          }
        }

        // No tool calls — done
        if (pendingToolCalls.length === 0) break;

        // Handle tool calls
        toolCallRounds++;

        // Add assistant message with text + tool calls (Claude requires faithful reproduction)
        const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
        if (textAccum) {
          assistantParts.push(new vscode.LanguageModelTextPart(textAccum));
        }
        for (const tc of pendingToolCalls) {
          assistantParts.push(new vscode.LanguageModelToolCallPart(tc.callId, tc.name, tc.input));
        }
        messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

        // Execute tools and add results
        const toolResults: vscode.LanguageModelToolResultPart[] = [];
        for (const tc of pendingToolCalls) {
          // Check for @mentions
          if (tc.name === 'mention_agent') {
            const input = tc.input as { agent: string; message: string; problem?: string };
            this._pendingMentions.push({
              from: role,
              to: input.agent as AgentRole,
              message: input.message,
              pipelineId,
              problem: input.problem,
            });
            this._pipelineChat(pipelineId).send({
              sender: role,
              senderLabel: agentLabel(role),
              content: `@${input.agent} ${input.message}`,
              type: 'request',
              mentions: [input.agent],
            });
          }

          const result = await handleToolCall(tc, workspace, this._pipelineChat(pipelineId), role);
          toolResults.push(
            new vscode.LanguageModelToolResultPart(tc.callId, [new vscode.LanguageModelTextPart(result)])
          );

          // Track write_file calls so PM can verify artifacts
          if (tc.name === 'write_file') {
            const inp = tc.input as Record<string, string>;
            if (inp.path && result.startsWith('File written:')) {
              filesWritten.push(inp.path);
            }
          }

          // Include tool results in fullOutput so PM sees them
          fullOutput += `\n[tool:${tc.name}] ${result}\n`;
        }

        // Add tool results as user message
        messages.push(vscode.LanguageModelChatMessage.User(toolResults));
      }

      // Task complete
      this._pipelines.completeTask(ctx.projectId, pipelineId, task.id, fullOutput, filesWritten.length > 0 ? filesWritten : undefined);
      this._pipelines.saveAgentHistory(
        ctx.projectId, pipelineId, task.id,
        this._contexts, this._decisions,
      ).catch(() => { });

      this._pipelineChat(pipelineId).send({
        sender: role,
        senderLabel: agentLabel(role),
        content: `Tarefa concluida: **${task.title}**`,
        type: 'info',
      });

      // PM reviews individual task after completion
      // Skip for: PM itself, troubleshooter (to avoid loop), and pure analysis tasks
      const skipReview = role === 'product-manager'
        || role === 'troubleshooter'
        || role === 'git'
        || role === 'dead-code'
        || role === 'organizer'
        || (role === 'code-review' && (task.title.startsWith('Diagnosticar') || task.title.startsWith('Diagnose')));
      if (!skipReview) {
        await this._pmTaskReview(ctx.projectId, pipelineId, task, role, fullOutput);
      }

    } catch (err: any) {
      if (cts.token.isCancellationRequested) {
        this._pipelines.failTask(ctx.projectId, pipelineId, task.id, 'Cancelado pelo usuario');
      } else {
        const errMsg = err instanceof vscode.LanguageModelError
          ? `LM Error (${err.code}): ${err.message}`
          : err.message || String(err);
        this._pipelines.failTask(ctx.projectId, pipelineId, task.id, errMsg);
        this._pipelineChat(pipelineId).send({
          sender: role, senderLabel: agentLabel(role),
          content: `Erro: ${errMsg}`,
          type: 'error',
        });
      }
    } finally {
      cts.dispose();
      this._running.delete(task.id);
      this._onAgentStateChange.fire();
    }
  }

  // ─── Process @mentions ──────────────────────────────────

  private async _processPendingMentions(
    projectId: string,
    pipelineId: string,
    workspace: string,
    previousOutputs: { agent: AgentRole; output: string }[],
  ): Promise<void> {
    const mentions = [...this._pendingMentions];
    this._pendingMentions = [];

    for (const mention of mentions) {
      // Check if this agent already has a task in the current phase
      const pipeline = this._pipelines.get(projectId, pipelineId);
      if (!pipeline) continue;

      const currentPhase = pipeline.phases[pipeline.currentPhase];
      const hasTaskInPhase = currentPhase?.tasks.some(t => t.agent === mention.to);

      if (hasTaskInPhase) {
        // Agent is in the current phase — it already ran or will run
        this._pipelineChat(pipelineId).send({
          sender: 'system',
          senderLabel: 'Pipeline',
          content: `${AGENT_META[mention.from].label} solicitou @${mention.to}: ${mention.message}`,
          type: 'info',
        });
      } else {
        // Agent is NOT in the current phase — invoke directly with the mention context
        const problemTag = mention.problem ? ` (problema: ${mention.problem})` : '';
        this._pipelineChat(pipelineId).send({
          sender: mention.from,
          senderLabel: agentLabel(mention.from),
          content: `Delegando para @${mention.to}${problemTag}: ${mention.message}`,
          type: 'request',
          mentions: [mention.to],
        });

        // Collect all prior outputs including the mentioning agent's output
        const allOutputs = [...previousOutputs];
        for (const task of currentPhase?.tasks || []) {
          if (task.output && !allOutputs.some(o => o.agent === task.agent)) {
            allOutputs.push({ agent: task.agent, output: task.output });
          }
        }

        const contextSummary = allOutputs.map(o => `### ${AGENT_META[o.agent].label}\n${o.output.substring(0, 2000)}`).join('\n\n');

        // Invoke the mentioned agent with full context
        await this.invokeAgent(
          pipelineId,
          mention.to,
          `Solicitacao de ${AGENT_META[mention.from].label}:\n\n${mention.message}\n\nContexto:\n${contextSummary}`,
        );

        // Notify the caller agent that the mentioned agent finished
        this._pipelineChat(pipelineId).send({
          sender: mention.to,
          senderLabel: agentLabel(mention.to),
          content: `@${mention.from} Pronto — concluida a solicitacao: ${mention.message.substring(0, 200)}. Pode continuar sua tarefa.`,
          type: 'info',
          mentions: [mention.from],
        });
      }
    }
  }

  // ─── Direct agent invocation (outside pipeline) ─────────

  async invokeAgent(pipelineId: string, role: AgentRole, userMessage: string): Promise<void> {
    const project = this._getProject();
    if (!project) {
      this._pipelineChat(pipelineId).send({
        sender: 'system', senderLabel: 'System',
        content: 'Nenhum projeto ativo.',
        type: 'error',
      });
      return;
    }

    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const config = loadAgentConfig();
    const modelFamily = getModelForAgent(role, config);

    // Cost tier guard for direct invocations + hard free-only policy.
    const directPreset = isQualityPreset(config.mode) ? config.mode as QualityPreset : undefined;
    const directPresetData = directPreset ? QUALITY_PRESETS[directPreset] : null;
    let directFamily = modelFamily;
    const directCost = getModelCost(modelFamily);
    if (directCost !== 0) {
      directFamily = QUALITY_PRESETS['free-tier'].models[role] || modelFamily;
    } else if (directPresetData && config.mode !== 'auto' && directCost > directPresetData.costRange.max) {
      directFamily = directPresetData.models[role] || modelFamily;
    }

    let model: vscode.LanguageModelChat;
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: directFamily });
      if (!models.length) {
        const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        if (!allModels.length) throw new Error('Nenhum modelo Copilot disponivel');

        const maxCost = 0;
        const ranked = directPresetData?.ranking ?? [];
        const affordable = allModels.filter(m => getModelCost(m.family) <= maxCost);
        const pool = affordable.length ? affordable : allModels.filter(m => getModelCost(m.family) === 0);
        if (!pool.length) throw new Error('Nenhum modelo gratuito (0x) disponivel');

        const byRanking = ranked
          .map(fam => pool.find(m => m.family === fam))
          .filter(Boolean) as vscode.LanguageModelChat[];
        model = byRanking[0] ?? pool[0];
      } else {
        model = models[0];
      }
    } catch (err: any) {
      this._pipelineChat(pipelineId).send({
        sender: 'system', senderLabel: 'System',
        content: `Erro ao selecionar modelo para ${agentLabel(role)}: ${err.message}`,
        type: 'error',
      });
      return;
    }

    this._pipelineChat(pipelineId).send({
      sender: role,
      senderLabel: agentLabel(role),
      content: `Processando... (modelo: \`${model.family}\`)`,
      type: 'info',
    });

    // Track direct invocation so typing indicator shows
    this._trackDirect(pipelineId, role);
    this._onAgentStateChange.fire();

    const meta = AGENT_META[role];
    const systemPrompt = `Voce e o ${meta.label} do time ThinkCoffee.\n${meta.description}\n\nProjeto: ${project.name}\nWorkspace: ${workspace}\n\nResponda em portugues (BR). Seja objetivo. NAO use emojis.`;

    const messages = [
      vscode.LanguageModelChatMessage.User(systemPrompt + '\n\n---\n\n' + userMessage),
    ];

    const tools = getAgentTools(workspace);
    const cts = new vscode.CancellationTokenSource();

    try {
      let fullOutput = '';
      let rounds = 0;
      const MAX_ROUNDS = 10;

      while (rounds < MAX_ROUNDS) {
        const response = await model.sendRequest(messages, { tools }, cts.token);
        let textAccum = '';
        const toolCalls: vscode.LanguageModelToolCallPart[] = [];

        for await (const part of response.stream) {
          if (part instanceof vscode.LanguageModelTextPart) {
            textAccum += part.value;
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            toolCalls.push(part);
          }
        }

        if (textAccum) {
          fullOutput += textAccum;
          const chunks = splitMessage(textAccum, 3000);
          for (const chunk of chunks) {
            this._pipelineChat(pipelineId).send({
              sender: role,
              senderLabel: agentLabel(role),
              content: chunk,
              type: 'response',
            });
          }
        }

        if (toolCalls.length === 0) break;
        rounds++;

        // Add assistant message with text + tool calls (Claude requires faithful reproduction)
        const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
        if (textAccum) {
          assistantParts.push(new vscode.LanguageModelTextPart(textAccum));
        }
        for (const tc of toolCalls) {
          assistantParts.push(new vscode.LanguageModelToolCallPart(tc.callId, tc.name, tc.input));
        }
        messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

        const results: vscode.LanguageModelToolResultPart[] = [];
        for (const tc of toolCalls) {
          const result = await handleToolCall(tc, workspace, this._pipelineChat(pipelineId), role);
          results.push(new vscode.LanguageModelToolResultPart(tc.callId, [new vscode.LanguageModelTextPart(result)]));
        }
        messages.push(vscode.LanguageModelChatMessage.User(results));
      }
    } catch (err: any) {
      const errMsg = err instanceof vscode.LanguageModelError
        ? `LM Error (${err.code}): ${err.message}`
        : err.message || String(err);
      this._pipelineChat(pipelineId).send({
        sender: role, senderLabel: agentLabel(role),
        content: `Erro: ${errMsg}`,
        type: 'error',
      });
    } finally {
      this._untrackDirect(pipelineId, role);
      this._onAgentStateChange.fire();
      cts.dispose();
    }
  }

  dispose(): void {
    this._activePipelineLoops.clear();
    this.stopAll();
    this._onAgentStateChange.dispose();
  }

  /** Check if PM oversight loop is running for a pipeline */
  isPipelineLoopActive(pipelineId: string): boolean {
    return this._activePipelineLoops.has(pipelineId);
  }

  // ─── PM Pipeline Oversight Loop ─────────────────────────

  /**
   * Run the full pipeline with PM oversight.
   * PM monitors each phase: run agents -> PM reviews -> approve/reject -> repeat.
   * Only one loop can be active at a time.
   */
  async runPipeline(projectId: string, pipelineId: string): Promise<void> {
    // Prevent duplicate loops
    if (this._activePipelineLoops.has(pipelineId)) return;
    this._activePipelineLoops.add(pipelineId);

    this._pipelineChat(pipelineId).send({
      sender: 'product-manager',
      senderLabel: agentLabel('product-manager'),
      content: 'Assumindo supervisao da pipeline. Vou acompanhar cada fase e avaliar os resultados.',
      type: 'info',
    });

    try {
      while (this._activePipelineLoops.has(pipelineId)) {
        const pipeline = this._pipelines.get(projectId, pipelineId);
        if (!pipeline) break;

        // Pipeline done?
        if (pipeline.status === 'completed' || pipeline.status === 'failed') {
          this._pipelineChat(pipelineId).send({
            sender: 'product-manager',
            senderLabel: agentLabel('product-manager'),
            content: pipeline.status === 'completed'
              ? 'Pipeline concluida com sucesso! Todas as fases foram aprovadas.'
              : 'Pipeline falhou. Verifique os erros nos logs dos agentes.',
            type: 'info',
          });

          // On success, run organizer + git agent
          if (pipeline.status === 'completed') {
            await this._runPipelineFinalization(projectId, pipelineId);
          }
          break;
        }

        const phase = pipeline.phases[pipeline.currentPhase];
        if (!phase) break;

        if (phase.status === 'in-progress') {
          // Run the phase agents
          await this.runPhase(projectId, pipelineId);

          // Re-read pipeline — PM task review may have reset tasks to pending
          const updated = this._pipelines.get(projectId, pipelineId);
          if (!updated) break;
          const updPhase = updated.phases[updated.currentPhase];
          if (!updPhase) break;

          // Check for failed tasks — PM decides how to handle
          const failedTasks = updPhase.tasks.filter(t => t.status === 'failed');
          if (failedTasks.length > 0) {
            const decision = await this._pmHandleFailedTasks(projectId, pipelineId, failedTasks);
            if (decision === 'abort') {
              // Mark pipeline as failed
              const p = this._pipelines.get(projectId, pipelineId);
              if (p) {
                p.status = 'failed';
                updPhase.status = 'failed';
                this._pipelines.save(p);
              }
              this._pipelineChat(pipelineId).send({
                sender: 'product-manager',
                senderLabel: agentLabel('product-manager'),
                content: 'Pipeline abortada pelo PM devido a falhas criticas.',
                type: 'info',
              });
              break;
            }
            // decision === 'retry' — tasks were reset to pending, re-run
            continue;
          }

          // Check for tasks PM rejected (reset to pending)
          const pendingTasks = updPhase.tasks.filter(t => t.status === 'pending');
          if (pendingTasks.length > 0) {
            // Re-run the phase to process pending tasks
            continue;
          }

          // After runPhase completes, the phase should be awaiting-approval or failed
          // Continue the loop to check
          continue;
        }

        if (phase.status === 'awaiting-approval') {
          // PM reviews the phase
          const review = await this._pmReviewPhase(projectId, pipelineId);

          if (review.approved) {
            // Approve and advance
            const p = this._pipelines.approvePhase(projectId, pipelineId, 'product-manager');
            if (!p) break;

            this._pipelineChat(pipelineId).send({
              sender: 'product-manager',
              senderLabel: agentLabel('product-manager'),
              content: `Fase **${phase.name}** aprovada pelo PM.${p.status === 'completed' ? '\n\nPipeline concluida!' : ''}`,
              type: 'info',
            });
            this._onAgentStateChange.fire();

            if (p.status === 'completed') {
              await this._runPipelineFinalization(projectId, pipelineId);
              break;
            }
            if (p.status === 'failed') break;
            // Next iteration will pick up the new in-progress phase
            continue;
          } else {
            // Reject with feedback
            this._pipelines.rejectPhase(projectId, pipelineId, review.feedback);

            this._pipelineChat(pipelineId).send({
              sender: 'product-manager',
              senderLabel: agentLabel('product-manager'),
              content: `Fase **${phase.name}** rejeitada. Agentes vao refazer com feedback:\n\n${review.feedback}`,
              type: 'info',
            });
            this._onAgentStateChange.fire();
            // Next iteration will re-run the phase (now in-progress again)
            continue;
          }
        }

        // Phase is in some other state (pending, completed, etc) — shouldn't happen, but break to be safe
        break;
      }
    } catch (err: any) {
      this._pipelineChat(pipelineId).send({
        sender: 'system',
        senderLabel: 'Pipeline',
        content: `Erro no loop do PM: ${err.message}`,
        type: 'error',
      });
    } finally {
      if (this._activePipelineLoops.has(pipelineId)) {
        this._activePipelineLoops.delete(pipelineId);
      }
      this._onAgentStateChange.fire();
    }
  }

  // ─── Model rotation on rejection ────────────────────────

  /**
   * Pick a different model for an agent, respecting cost tier and using preset ranking.
   * Prefers models in the preset ranking, penalizes models with failure history.
   */
  private _pickAlternativeModel(role: AgentRole, currentModel: string): string {
    const config = loadAgentConfig();
    const activePreset = isQualityPreset(config.mode) ? config.mode as QualityPreset : undefined;
    const presetData = activePreset ? QUALITY_PRESETS[activePreset] : null;
    const ranking = presetData?.ranking ?? [];

    const tierRank: Record<string, number> = { premium: 4, code: 3, standard: 2, fast: 1 };
    const failureCounts = getModelFailureCounts(role);

    let allModels = getCachedModels();

    // Filter by cost range if a preset is active
    if (presetData) {
      allModels = allModels.filter(
        m => m.costMultiplier >= presetData.costRange.min && m.costMultiplier <= presetData.costRange.max
      );
    }

    const candidates = allModels
      .filter(m => m.family !== currentModel)
      .map(m => {
        const tier = tierRank[m.tier] || 0;
        const failures = failureCounts[m.family] || 0;
        // Bonus for being in ranking (higher position = more bonus)
        const rankIdx = ranking.indexOf(m.family);
        const rankBonus = rankIdx >= 0 ? (ranking.length - rankIdx) * 0.3 : 0;
        const score = tier + rankBonus - (failures * 0.5);
        return { ...m, score, failures };
      })
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) return currentModel;

    // Among top-scored, prefer a different vendor for diversity
    const topScore = candidates[0].score;
    const topTier = candidates.filter(c => c.score >= topScore - 0.5);
    const currentVendorPrefix = currentModel.split('-')[0];
    const diffVendor = topTier.find(m => !m.family.startsWith(currentVendorPrefix));
    return (diffVendor || candidates[0]).family;
  }

  // ─── PM Individual Task Review ──────────────────────────

  /**
   * After each agent completes a task, PM evaluates the output.
   * PM can approve the task or request a redo.
   */
  private async _pmTaskReview(
    projectId: string,
    pipelineId: string,
    task: AgentTask,
    agentRole: AgentRole,
    output: string,
  ): Promise<void> {
    const pipeline = this._pipelines.get(projectId, pipelineId);
    if (!pipeline) return;

    // Reload task from saved pipeline to get updated artifacts (completeTask writes to disk)
    const currentPhase = pipeline.phases[pipeline.currentPhase];
    const savedTask = currentPhase?.tasks.find(t => t.id === task.id) || task;

    this._pipelineChat(pipelineId).send({
      sender: 'product-manager',
      senderLabel: agentLabel('product-manager'),
      content: `Revisando tarefa de ${agentLabel(agentRole)}: **${task.title}**...`,
      type: 'info',
    });

    this._trackDirect(pipelineId, 'product-manager');
    this._onAgentStateChange.fire();

    try {
      const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: getActivePMModel() });
      if (!model) return; // Skip review if model unavailable

      // Build artifacts section from task data
      const artifactsList = savedTask.artifacts && savedTask.artifacts.length > 0
        ? `## Arquivos criados/modificados pelo agente\n${savedTask.artifacts.map(f => `- ${f}`).join('\n')}\n\n`
        : '## Arquivos criados/modificados pelo agente\nNenhum arquivo foi criado via write_file.\n\n';

      const prompt = `Voce e o Product Manager (PM) supervisando a pipeline: "${pipeline.objective}"

## Agente: ${agentLabel(agentRole)}
## Tarefa: ${task.title}
## Descricao: ${task.description}

${artifactsList}## Output do agente (ultimos 8000 chars)
${output.substring(output.length - 8000)}

## Sua tarefa
Avalie se o agente completou a tarefa adequadamente:
1. O output atende a descricao da tarefa?
2. O agente usou write_file para criar/modificar os arquivos necessarios? Verifique a lista de "Arquivos criados/modificados" acima.
3. Ha erros graves ou omissoes criticas?

IMPORTANTE: A lista de arquivos acima mostra TODAS as chamadas write_file confirmadas. Se ha arquivos listados, o agente DE FATO criou esses arquivos.

Responda APENAS com JSON valido:
{"approved": true, "summary": "Breve resumo do que foi feito"}
ou
{"approved": false, "feedback": "O que precisa ser corrigido"}

Seja pragmatico — aprove se o trabalho e razoavel. Rejeite apenas se ha falhas criticas.`;

      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const cts = new vscode.CancellationTokenSource();
      const response = await model.sendRequest(messages, {}, cts.token);

      let fullText = '';
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          fullText += part.value;
        }
      }
      cts.dispose();

      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const result = JSON.parse(jsonMatch[0]);

      if (result.approved) {
        this._pipelineChat(pipelineId).send({
          sender: 'product-manager',
          senderLabel: agentLabel('product-manager'),
          content: `Tarefa aprovada (${agentLabel(agentRole)}): ${result.summary || 'OK'}`,
          type: 'info',
        });
      } else {
        // PM rejects — invoke troubleshooter to fix directly (no retry loop)
        const config = loadAgentConfig();
        const currentModel = getModelForAgent(agentRole, config);

        // Record this model's failure for future reference
        recordModelFailure(currentModel, agentRole, task.title, result.feedback);

        this._pipelineChat(pipelineId).send({
          sender: 'product-manager',
          senderLabel: agentLabel('product-manager'),
          content: `Tarefa rejeitada (${agentLabel(agentRole)}): ${result.feedback}\n\nInvocando Troubleshooter para corrigir...`,
          type: 'info',
        });

        // Run troubleshooter directly — it reads the failed output, diagnoses, and fixes in one pass
        await this._runTroubleshooter(projectId, pipelineId, task, agentRole, output, result.feedback);
      }
    } catch (err: any) {
      // On error, skip review — don't block the pipeline
      this._pipelineChat(pipelineId).send({
        sender: 'system',
        senderLabel: 'System',
        content: `Erro no review individual do PM: ${err.message}`,
        type: 'error',
      });
    } finally {
      this._untrackDirect(pipelineId, 'product-manager');
      this._onAgentStateChange.fire();
    }
  }

  // ─── Troubleshooter — single-pass fix agent ─────────────

  /**
   * When PM rejects a task, the Troubleshooter agent takes over.
   * It reads the failed output + PM feedback, analyzes the workspace,
   * and applies fixes directly using write_file. No retry loop.
   * After it finishes, the original task is marked completed with
   * the troubleshooter's output appended.
   */
  private async _runTroubleshooter(
    projectId: string,
    pipelineId: string,
    failedTask: AgentTask,
    originalRole: AgentRole,
    failedOutput: string,
    pmFeedback: string,
  ): Promise<void> {
    const pipeline = this._pipelines.get(projectId, pipelineId);
    if (!pipeline) return;

    const workspace = pipeline.workspace || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const originalLabel = AGENT_META[originalRole].label;
    const outputSnippet = failedOutput.substring(failedOutput.length - 6000);
    const artifactsInfo = failedTask.artifacts?.length
      ? `Arquivos ja criados pelo agente original: ${failedTask.artifacts.join(', ')}`
      : 'O agente original NAO criou nenhum arquivo (esse e o problema principal)';

    // Build troubleshooter task
    const tsTask: AgentTask = {
      id: crypto.randomUUID(),
      agent: 'troubleshooter',
      title: `Corrigir: ${failedTask.title}`,
      description: `O ${originalLabel} falhou na tarefa "${failedTask.title}" e o PM rejeitou.

## Feedback do PM (LEIA COM ATENCAO)
${pmFeedback}

## ${artifactsInfo}

## Tarefa original que o ${originalLabel} deveria ter feito
${failedTask.description}

## Output do agente que falhou (ultimos 6000 chars)
${outputSnippet}

## Objetivo da pipeline
${pipeline.objective}

## O QUE VOCE DEVE FAZER
1. Leia os arquivos existentes no workspace (list_files, read_file) para entender o estado atual
2. Baseado no feedback do PM, identifique EXATAMENTE o que falta
3. Use write_file para CRIAR ou CORRIGIR cada arquivo necessario
4. Se algum import/require quebrou, corrija-o
5. Garanta que TODOS os arquivos mencionados no feedback do PM sejam criados/corrigidos

LEMBRE: Voce tem UMA chance. Use write_file. Nao descreva — FACA.`,
      status: 'pending' as TaskStatus,
    };

    const ctx: AgentContext = {
      projectId,
      projectName: pipeline.objective,
      workspace,
      objective: pipeline.objective,
      previousOutputs: [{ agent: originalRole, output: failedOutput.substring(0, 4000) }],
      task: tsTask,
      rejectionFeedback: pmFeedback,
    };

    // Run the troubleshooter (reuses _runAgent but WITHOUT PM re-review to avoid loop)
    await this._runAgent(tsTask, ctx, pipelineId);

    // After troubleshooter completes, merge its artifacts into the original task
    // and mark the original task as completed
    const updatedPipeline = this._pipelines.get(projectId, pipelineId);
    if (updatedPipeline) {
      const phase = updatedPipeline.phases[updatedPipeline.currentPhase];
      const originalTask = phase?.tasks.find(t => t.id === failedTask.id);
      if (originalTask) {
        const tsArtifacts = tsTask.artifacts || [];
        originalTask.artifacts = [...(originalTask.artifacts || []), ...tsArtifacts];
        originalTask.output = (originalTask.output || '') + `\n\n[TROUBLESHOOTER FIX]\n${tsTask.output || '(sem output)'}`;
        originalTask.status = 'completed';
        this._pipelines.save(updatedPipeline);
      }
    }

    this._pipelineChat(pipelineId).send({
      sender: 'troubleshooter',
      senderLabel: agentLabel('troubleshooter'),
      content: `Correcao aplicada para a tarefa "${failedTask.title}" do ${originalLabel}.`,
      type: 'info',
    });

    // Auto-generate error report for devs (in case TS didn't use report_error tool)
    try {
      const reportsDir = path.join(workspace, '.thinkcoffee', 'reports');
      if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const slug = failedTask.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40);
      const reportPath = path.join(reportsDir, `${timestamp}_${slug}.md`);

      // Only write if TS didn't already create a report for this fix
      if (!fs.readdirSync(reportsDir).some(f => f.includes(slug) && f !== path.basename(reportPath))) {
        const tsOutput = tsTask.output || '(sem output)';
        const tsArtifactsList = (tsTask.artifacts || []).map(f => `- ${f}`).join('\n') || '- (nenhum)';
        const report = `# Error Report: ${failedTask.title}\n\n` +
          `**Data**: ${new Date().toISOString()}\n` +
          `**Pipeline**: ${pipeline.objective}\n` +
          `**Pipeline ID**: ${pipelineId}\n` +
          `**Agente original**: ${originalLabel} (${originalRole})\n` +
          `**Modelo do agente**: ${getModelForAgent(originalRole)}\n` +
          `**Corrigido por**: Troubleshooter (${getModelForAgent('troubleshooter')})\n\n` +
          `---\n\n` +
          `## Feedback do PM (motivo da rejeicao)\n${pmFeedback}\n\n` +
          `## Output original do agente (ultimos 3000 chars)\n\`\`\`\n${failedOutput.substring(failedOutput.length - 3000)}\n\`\`\`\n\n` +
          `## Correcao do Troubleshooter\n${tsOutput.substring(0, 4000)}\n\n` +
          `## Arquivos alterados pelo Troubleshooter\n${tsArtifactsList}\n`;
        fs.writeFileSync(reportPath, report, 'utf-8');

        this._pipelineChat(pipelineId).send({
          sender: 'system',
          senderLabel: 'Pipeline',
          content: `Report de erro salvo em \`.thinkcoffee/reports/${path.basename(reportPath)}\``,
          type: 'info',
        });
      }
    } catch { /* report generation is best-effort */ }
  }

  // ─── PM Handle Failed/Missing Agents ────────────────────

  /**
   * PM evaluates failed tasks and decides: retry them or abort the pipeline.
   * Returns 'retry' (tasks reset to pending) or 'abort'.
   */
  private async _pmHandleFailedTasks(
    projectId: string,
    pipelineId: string,
    failedTasks: AgentTask[],
  ): Promise<'retry' | 'abort'> {
    const pipeline = this._pipelines.get(projectId, pipelineId);
    if (!pipeline) return 'abort';

    const phase = pipeline.phases[pipeline.currentPhase];
    if (!phase) return 'abort';

    const failedSummary = failedTasks
      .map(t => `- **${AGENT_META[t.agent].label}** — ${t.title}: ${(t.output || 'sem output').substring(0, 1000)}`)
      .join('\n');

    this._pipelineChat(pipelineId).send({
      sender: 'product-manager',
      senderLabel: agentLabel('product-manager'),
      content: `Detectei ${failedTasks.length} tarefa(s) com falha na fase **${phase.name}**. Avaliando...`,
      type: 'info',
    });

    this._trackDirect(pipelineId, 'product-manager');
    this._onAgentStateChange.fire();

    try {
      const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: getActivePMModel() });
      if (!model) {
        // Default: retry once
        this._resetTasksToPending(pipeline, failedTasks);
        return 'retry';
      }

      const prompt = `Voce e o Product Manager (PM) supervisando a pipeline: "${pipeline.objective}"

## Fase atual: ${phase.name}
## Tarefas com falha
${failedSummary}

## Tarefa
Decida o que fazer com as tarefas que falharam:
1. "retry" — Resetar as tarefas para tentar novamente (use se o erro parece transitorio ou o agente pode corrigir)
2. "abort" — Abortar a pipeline (use APENAS se o erro e irrecuperavel e bloqueia tudo)

Responda APENAS com JSON:
{"decision": "retry", "reason": "Motivo"}
ou
{"decision": "abort", "reason": "Motivo"}

Prefira "retry" na duvida. Aborte apenas em situacoes realmente irrecuperaveis.`;

      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const cts = new vscode.CancellationTokenSource();
      const response = await model.sendRequest(messages, {}, cts.token);

      let fullText = '';
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          fullText += part.value;
        }
      }
      cts.dispose();

      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this._resetTasksToPending(pipeline, failedTasks);
        return 'retry';
      }

      const result = JSON.parse(jsonMatch[0]);

      this._pipelineChat(pipelineId).send({
        sender: 'product-manager',
        senderLabel: agentLabel('product-manager'),
        content: `Decisao do PM: **${result.decision}** — ${result.reason || ''}`,
        type: 'info',
      });

      if (result.decision === 'abort') {
        return 'abort';
      }

      // Retry: reset failed tasks
      this._resetTasksToPending(pipeline, failedTasks);
      return 'retry';
    } catch (err: any) {
      this._pipelineChat(pipelineId).send({
        sender: 'system',
        senderLabel: 'System',
        content: `Erro no tratamento de falhas do PM: ${err.message}. Tentando retry.`,
        type: 'error',
      });
      this._resetTasksToPending(pipeline, failedTasks);
      return 'retry';
    } finally {
      this._untrackDirect(pipelineId, 'product-manager');
      this._onAgentStateChange.fire();
    }
  }

  private _resetTasksToPending(pipeline: Pipeline, tasks: AgentTask[]): void {
    const phase = pipeline.phases[pipeline.currentPhase];
    if (!phase) return;
    for (const failed of tasks) {
      const t = phase.tasks.find(tt => tt.id === failed.id);
      if (t) {
        t.status = 'pending';
        t.output = `[RETRY] Erro anterior: ${(t.output || '').substring(0, 1000)}`;
      }
    }
    phase.status = 'in-progress';
    pipeline.status = 'active';
    this._pipelines.save(pipeline);
  }

  // ─── Ollama Agent Execution ──────────────────────────────

  /**
   * Run an agent via Ollama instead of VS Code Copilot API.
   * Supports the same tool loop (read_file, write_file, etc.)
   * using Ollama's OpenAI-compatible tool calling.
   */
  private async _runAgentViaOllama(task: AgentTask, ctx: AgentContext, pipelineId: string): Promise<void> {
    const role = task.agent;
    const ollamaClient = getOllamaClient();

    this._pipelines.startTask(ctx.projectId, pipelineId, task.id);

    const cts = new vscode.CancellationTokenSource();
    this._running.set(task.id, { role, taskId: task.id, pipelineId, cts, startedAt: Date.now() });
    this._onAgentStateChange.fire();

    this._pipelineChat(pipelineId).send({
      sender: role,
      senderLabel: `${AGENT_SIGLA[role] || role.substring(0, 2).toUpperCase()} - ${ollamaClient.family}`,
      content: `Iniciando: **${task.title}** (modelo: \`${ollamaClient.family}\`)`,
      type: 'info',
    });

    const workspace = ctx.workspace;
    const tools = getAgentTools(workspace);
    const ollamaTools = toOllamaTools(tools);
    const systemPrompt = buildSystemPrompt(role, ctx);
    const kickoff = `Execute sua tarefa agora.\n\nTarefa: ${task.title}\n${task.description}\n\nIMPORTANTE: Voce DEVE usar write_file para criar os arquivos. NAO apenas descreva em texto o que faria — use as ferramentas para LER o codigo existente e ESCREVER os arquivos no workspace. Comece lendo a estrutura com list_files e read_file, depois crie/edite arquivos com write_file.`;

    const messages: OllamaChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: kickoff },
    ];

    const abortCtrl = new AbortController();
    cts.token.onCancellationRequested(() => abortCtrl.abort());

    try {
      let fullOutput = '';
      const filesWritten: string[] = [];
      let toolCallRounds = 0;
      const MAX_TOOL_ROUNDS = 15;

      while (toolCallRounds < MAX_TOOL_ROUNDS) {
        const result = await ollamaClient.chatWithTools(messages, ollamaTools, abortCtrl.signal);

        if (result.text) {
          fullOutput += result.text;
          const chunks = splitMessage(result.text, 3000);
          for (const chunk of chunks) {
            this._pipelineChat(pipelineId).send({
              sender: role,
              senderLabel: `${AGENT_SIGLA[role] || role.substring(0, 2).toUpperCase()} - ${ollamaClient.family}`,
              content: chunk,
              type: 'response',
            });
          }
        }

        // No tool calls — done
        if (!result.toolCalls.length) break;

        toolCallRounds++;

        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: result.text || '',
          tool_calls: result.toolCalls,
        });

        // Execute each tool call
        for (const tc of result.toolCalls) {
          const fnName = tc.function.name;
          const fnArgs = tc.function.arguments;

          // Check @mentions
          if (fnName === 'mention_agent') {
            this._pendingMentions.push({
              from: role,
              to: fnArgs.agent as AgentRole,
              message: fnArgs.message as string,
              pipelineId,
              problem: fnArgs.problem as string | undefined,
            });
          }

          // Create a fake ToolCallPart for the handler
          const fakeToolCall = {
            callId: crypto.randomUUID(),
            name: fnName,
            input: fnArgs,
          } as unknown as vscode.LanguageModelToolCallPart;

          const toolResult = await handleToolCall(fakeToolCall, workspace, this._pipelineChat(pipelineId), role);

          // Send tool result back to Ollama
          messages.push({ role: 'tool', content: toolResult });

          if (fnName === 'write_file' && fnArgs.path && toolResult.startsWith('File written:')) {
            filesWritten.push(fnArgs.path as string);
          }
          fullOutput += `\n[tool:${fnName}] ${toolResult}\n`;
        }
      }

      this._pipelines.completeTask(ctx.projectId, pipelineId, task.id, fullOutput, filesWritten.length > 0 ? filesWritten : undefined);
      this._pipelines.saveAgentHistory(ctx.projectId, pipelineId, task.id, this._contexts, this._decisions).catch(() => { });

      this._pipelineChat(pipelineId).send({
        sender: role,
        senderLabel: `${AGENT_SIGLA[role] || role.substring(0, 2).toUpperCase()} - ${ollamaClient.family}`,
        content: `Tarefa concluida: **${task.title}**`,
        type: 'info',
      });
    } catch (err: any) {
      this._pipelines.failTask(ctx.projectId, pipelineId, task.id, err.message);
      this._pipelineChat(pipelineId).send({
        sender: role,
        senderLabel: `${AGENT_SIGLA[role] || role.substring(0, 2).toUpperCase()} - ${ollamaClient.family}`,
        content: `Erro (Ollama): ${err.message}`,
        type: 'error',
      });
    } finally {
      this._running.delete(task.id);
      cts.dispose();
      this._onAgentStateChange.fire();
    }
  }

  // ─── Pipeline Finalization (Organizer + Git) ─────────────

  /**
   * After all pipeline phases complete:
   * 1. Run the Organizer agent to reorganize files professionally
   * 2. Run the Git agent to create branch, commit, push and open PR
   */
  private async _runPipelineFinalization(projectId: string, pipelineId: string): Promise<void> {
    const pipeline = this._pipelines.get(projectId, pipelineId);
    if (!pipeline) return;

    const workspace = pipeline.workspace || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    if (!workspace) return;

    // Collect a summary of all phases and outputs for context
    const phasesSummary = pipeline.phases.map(p => {
      const taskSummary = p.tasks.map(t => {
        const artifacts = t.artifacts?.length ? `\nArquivos: ${t.artifacts.join(', ')}` : '';
        return `  - ${AGENT_META[t.agent].label}: ${t.title} (${t.status})${artifacts}`;
      }).join('\n');
      return `### ${p.name}\n${taskSummary}`;
    }).join('\n\n');

    this._pipelineChat(pipelineId).send({
      sender: 'product-manager',
      senderLabel: agentLabel('product-manager'),
      content: 'Pipeline concluida! Iniciando finalizacao: Organizer vai reorganizar os arquivos, depois o Git Agent vai salvar no GitHub.',
      type: 'info',
    });

    // ── Step 1: Run Organizer Agent ──
    try {
      this._pipelineChat(pipelineId).send({
        sender: 'organizer',
        senderLabel: agentLabel('organizer'),
        content: 'Iniciando reorganizacao profissional do projeto...',
        type: 'info',
      });

      const orgTask: AgentTask = {
        id: crypto.randomUUID(),
        agent: 'organizer',
        title: 'Finalizar: organizar estrutura do projeto',
        description: `A pipeline "${pipeline.objective}" foi concluida com sucesso.

## Resumo das fases
${phasesSummary}

## Sua tarefa
Organize o projeto de forma profissional SEM consultar o PM:
1. Use list_files para ver TODA a estrutura atual
2. Leia package.json, tsconfig e arquivos-chave para entender a stack
3. DECIDA o design pattern mais adequado (Clean Architecture, MVC, DDD, Modular, etc)
4. Mova e organize arquivos/pastas conforme o pattern escolhido
5. Corrija nomes inconsistentes, arquivos soltos, pastas bagunçadas
6. Atualize imports/requires quebrados
7. Escreva REORGANIZATION.md na raiz descrevendo as mudancas
8. NAO faca git add/commit/push — o agente Git cuida disso depois.

IMPORTANTE: Aja diretamente. Use write_file e run_command. Nao descreva — FACA.`,
        status: 'pending' as TaskStatus,
      };

      const orgCtx: AgentContext = {
        projectId,
        projectName: pipeline.objective,
        workspace,
        objective: pipeline.objective,
        previousOutputs: pipeline.phases.flatMap(p =>
          p.tasks
            .filter(t => t.output)
            .map(t => ({ agent: t.agent, output: (t.output || '').substring(0, 2000) }))
        ).slice(-5), // Last 5 outputs for context
        task: orgTask,
      };

      await this._runAgent(orgTask, orgCtx, pipelineId);

      this._pipelineChat(pipelineId).send({
        sender: 'organizer',
        senderLabel: agentLabel('organizer'),
        content: 'Reorganizacao do projeto finalizada.',
        type: 'info',
      });
    } catch (err: any) {
      this._pipelineChat(pipelineId).send({
        sender: 'system',
        senderLabel: 'System',
        content: `Erro no Organizer (nao-bloqueante): ${err.message}. Prosseguindo para Git...`,
        type: 'error',
      });
    }

    // ── Step 2: Run Git Agent ──
    try {
      this._pipelineChat(pipelineId).send({
        sender: 'git',
        senderLabel: agentLabel('git'),
        content: 'Iniciando workflow Git: branch, commit, push e PR...',
        type: 'info',
      });

      const gitTask: AgentTask = {
        id: crypto.randomUUID(),
        agent: 'git',
        title: 'Git: commit, push, merge na main',
        description: `A pipeline "${pipeline.objective}" foi concluida e os arquivos foram organizados.
Pipeline ID: ${pipelineId}

## Fases concluidas
${pipeline.phases.map(p => `- ${p.name}: ${p.status}`).join('\n')}

## O QUE VOCE DEVE FAZER (use run_command para TODOS os comandos)
1. git status — verifique as mudancas
2. Crie branch: git checkout -b feature/${pipeline.objective.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50)}-${pipelineId.substring(0, 8)}
3. git add -A
4. git commit -m "feat: ${pipeline.objective}\n\nPipeline ThinkCoffee (${pipelineId})\nFases: ${pipeline.phases.map(p => p.name).join(', ')}"
5. git push -u origin <nome-da-branch>
6. Se gh cli disponivel: gh pr create --title "feat: ${pipeline.objective}" --body "Pipeline ThinkCoffee ${pipelineId}" --base main
7. MERGE na main:
   a. git checkout main
   b. git pull origin main
   c. git merge <feature-branch> --no-ff
   d. Se houver conflitos: use read_file nos arquivos, resolva com write_file, git add -A && git commit --no-edit
   e. git push origin main
8. Limpe: git branch -d <feature-branch> && git push origin --delete <feature-branch>
9. Se push ou merge falhar, reporte mas NAO falhe a task

IMPORTANTE: Use APENAS run_command para git. So edite arquivos se precisar resolver conflitos.`,
        status: 'pending' as TaskStatus,
      };

      const gitCtx: AgentContext = {
        projectId,
        projectName: pipeline.objective,
        workspace,
        objective: pipeline.objective,
        previousOutputs: [],
        task: gitTask,
      };

      await this._runAgent(gitTask, gitCtx, pipelineId);

      this._pipelineChat(pipelineId).send({
        sender: 'git',
        senderLabel: agentLabel('git'),
        content: 'Workflow Git finalizado.',
        type: 'info',
      });
    } catch (err: any) {
      // Git agent failed — fall back to direct git commands
      this._pipelineChat(pipelineId).send({
        sender: 'system',
        senderLabel: 'System',
        content: `Git Agent falhou: ${err.message}. Tentando fallback direto...`,
        type: 'error',
      });
      await this._pmGitFinalize(projectId, pipelineId);
    }

    // ── Step 3: Run Dead Code Cleaner (background / fire-and-forget) ──
    void this._runDeadCodeCleanup(projectId, pipelineId, workspace, phasesSummary).catch(err => {
      this._pipelineChat(pipelineId).send({
        sender: 'system',
        senderLabel: 'System',
        content: `Dead Code Cleaner falhou (nao-bloqueante): ${err.message}`,
        type: 'error',
      });
    });
  }

  /**
   * Runs the dead-code cleaner agent in background after pipeline finalization.
   * Builds a code dependency map and passes it as context.
   */
  private async _runDeadCodeCleanup(
    projectId: string,
    pipelineId: string,
    workspace: string,
    phasesSummary: string,
  ): Promise<void> {
    this._pipelineChat(pipelineId).send({
      sender: 'dead-code',
      senderLabel: agentLabel('dead-code'),
      content: 'Construindo mapa de dependencias do projeto...',
      type: 'info',
    });

    const codeMap = buildCodeMap(workspace);

    this._pipelineChat(pipelineId).send({
      sender: 'dead-code',
      senderLabel: agentLabel('dead-code'),
      content: `Mapa concluido: ${codeMap.totalFiles} arquivos analisados, ${codeMap.orphans.length} potenciais orfaos. Iniciando limpeza...`,
      type: 'info',
    });

    const dcTask: AgentTask = {
      id: crypto.randomUUID(),
      agent: 'dead-code',
      title: 'Limpar codigo morto do projeto',
      description: `A pipeline foi finalizada e o codigo foi commitado. Agora limpe o codigo morto.

## CODE_MAP (grafo de dependencias)
${codeMap.mapText}

## Orfaos detectados (${codeMap.orphans.length})
${codeMap.orphans.length > 0 ? codeMap.orphans.map(o => `- ${o}`).join('\n') : 'Nenhum orfao detectado — verifique exports nao-usados dentro dos arquivos.'}

## Fases da pipeline
${phasesSummary}

## Instrucoes
1. Analise os orfaos acima — confirme com search_code se realmente nao sao usados
2. Delete arquivos 100% mortos com run_command
3. Em arquivos parcialmente mortos, remova apenas exports/funcoes nao-usadas com write_file
4. Ao final: git add -A && git commit -m "chore: remove dead code" && git push`,
      status: 'pending' as TaskStatus,
    };

    const dcCtx: AgentContext = {
      projectId,
      projectName: this._pipelines.get(projectId, pipelineId)?.objective || '',
      workspace,
      objective: 'Remover codigo morto e arquivos orfaos',
      previousOutputs: [{
        agent: 'dead-code',
        output: `CODE_MAP:\n${codeMap.mapText}`,
      }],
      task: dcTask,
    };

    await this._runAgent(dcTask, dcCtx, pipelineId);

    this._pipelineChat(pipelineId).send({
      sender: 'dead-code',
      senderLabel: agentLabel('dead-code'),
      content: 'Limpeza de codigo morto finalizada.',
      type: 'info',
    });
  }

  // ─── PM Git Finalize (Fallback) ─────────────────────────

  /**
   * On pipeline completion, PM creates a feature branch, commits all changes, and opens a PR.
   */
  private async _pmGitFinalize(projectId: string, pipelineId: string): Promise<void> {
    const pipeline = this._pipelines.get(projectId, pipelineId);
    if (!pipeline) return;

    const workspace = pipeline.workspace || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    if (!workspace) return;

    this._pipelineChat(pipelineId).send({
      sender: 'product-manager',
      senderLabel: agentLabel('product-manager'),
      content: 'Pipeline concluida. Iniciando workflow Git: criando branch, commit e PR...',
      type: 'info',
    });

    this._trackDirect(pipelineId, 'product-manager');
    this._onAgentStateChange.fire();

    try {
      const { execSync } = require('child_process');
      const execOpts = { cwd: workspace, encoding: 'utf-8' as const, timeout: 30000 };

      // Generate branch name from objective
      const branchSlug = pipeline.objective
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50);
      const branchName = `feature/${branchSlug}-${pipelineId.substring(0, 8)}`;

      // Check if git repo exists
      try {
        execSync('git rev-parse --is-inside-work-tree', execOpts);
      } catch {
        this._pipelineChat(pipelineId).send({
          sender: 'product-manager',
          senderLabel: agentLabel('product-manager'),
          content: 'Workspace nao e um repositorio Git. Pulando workflow Git.',
          type: 'info',
        });
        return;
      }

      // Get current branch for PR base
      let baseBranch = 'main';
      try {
        baseBranch = execSync('git rev-parse --abbrev-ref HEAD', execOpts).trim();
      } catch { /* use main */ }

      // Create and checkout feature branch
      try {
        execSync(`git checkout -b ${branchName}`, execOpts);
      } catch {
        // Branch might exist, try switching
        try {
          execSync(`git checkout ${branchName}`, execOpts);
        } catch (err: any) {
          this._pipelineChat(pipelineId).send({
            sender: 'product-manager',
            senderLabel: agentLabel('product-manager'),
            content: `Erro ao criar branch: ${err.message}`,
            type: 'error',
          });
          return;
        }
      }

      // Stage all changes
      execSync('git add -A', execOpts);

      // Check if there are changes to commit
      const status = execSync('git status --porcelain', execOpts).trim();
      if (!status) {
        this._pipelineChat(pipelineId).send({
          sender: 'product-manager',
          senderLabel: agentLabel('product-manager'),
          content: 'Nenhuma alteracao detectada para commit. Branch criada mas sem mudancas.',
          type: 'info',
        });
        return;
      }

      // Commit
      const commitMsg = `feat: ${pipeline.objective}\n\nPipeline ThinkCoffee (${pipelineId})\nFases: ${pipeline.phases.map(p => p.name).join(', ')}`;
      execSync(`git commit -m ${JSON.stringify(commitMsg)}`, execOpts);

      this._pipelineChat(pipelineId).send({
        sender: 'product-manager',
        senderLabel: agentLabel('product-manager'),
        content: `Branch **${branchName}** criada com commit.\nBase: ${baseBranch}`,
        type: 'info',
      });

      // Try to push and create PR
      try {
        execSync(`git push -u origin ${branchName}`, { ...execOpts, timeout: 60000 });

        // Try GitHub CLI for PR creation
        try {
          const prTitle = `feat: ${pipeline.objective}`;
          const prBody = `## Pipeline ThinkCoffee\n\n**Objetivo:** ${pipeline.objective}\n**Pipeline ID:** ${pipelineId}\n\n### Fases\n${pipeline.phases.map(p => `- ${p.name}: ${p.status}`).join('\n')}`;
          execSync(
            `gh pr create --title ${JSON.stringify(prTitle)} --body ${JSON.stringify(prBody)} --base ${baseBranch}`,
            { ...execOpts, timeout: 60000 },
          );

          this._pipelineChat(pipelineId).send({
            sender: 'product-manager',
            senderLabel: agentLabel('product-manager'),
            content: `PR criado com sucesso! Branch: **${branchName}** -> ${baseBranch}`,
            type: 'info',
          });
        } catch {
          this._pipelineChat(pipelineId).send({
            sender: 'product-manager',
            senderLabel: agentLabel('product-manager'),
            content: `Push feito. PR nao criado automaticamente (gh CLI nao disponivel). Crie manualmente: **${branchName}** -> ${baseBranch}`,
            type: 'info',
          });
        }
      } catch (pushErr: any) {
        this._pipelineChat(pipelineId).send({
          sender: 'product-manager',
          senderLabel: agentLabel('product-manager'),
          content: `Branch e commit criados localmente. Push falhou: ${pushErr.message}\n\nExecute manualmente:\n\`git push -u origin ${branchName}\``,
          type: 'info',
        });
      }
    } catch (err: any) {
      this._pipelineChat(pipelineId).send({
        sender: 'product-manager',
        senderLabel: agentLabel('product-manager'),
        content: `Erro no workflow Git: ${err.message}`,
        type: 'error',
      });
    } finally {
      this._untrackDirect(pipelineId, 'product-manager');
      this._onAgentStateChange.fire();
    }
  }

  // ─── PM Phase Review ────────────────────────────────────

  private async _pmReviewPhase(
    projectId: string,
    pipelineId: string,
  ): Promise<{ approved: boolean; feedback: string }> {
    const pipeline = this._pipelines.get(projectId, pipelineId);
    if (!pipeline) return { approved: true, feedback: '' };

    const phase = pipeline.phases[pipeline.currentPhase];
    if (!phase) return { approved: true, feedback: '' };

    this._pipelineChat(pipelineId).send({
      sender: 'product-manager',
      senderLabel: agentLabel('product-manager'),
      content: `Revisando fase **${phase.name}**...`,
      type: 'info',
    });

    this._trackDirect(pipelineId, 'product-manager');
    this._onAgentStateChange.fire();

    try {
      const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: getActivePMModel() });
      if (!model) {
        this._pipelineChat(pipelineId).send({
          sender: 'system', senderLabel: 'System',
          content: 'Modelo PM indisponivel para review. Auto-aprovando fase.',
          type: 'error',
        });
        return { approved: true, feedback: '' };
      }

      // Collect outputs from this phase (including artifacts)
      const outputs = phase.tasks.map(t => {
        const artifactsInfo = t.artifacts && t.artifacts.length > 0
          ? `Arquivos criados: ${t.artifacts.join(', ')}\n`
          : '';
        return `### ${AGENT_META[t.agent].label} — ${t.title}\nStatus: ${t.status}\n${artifactsInfo}${t.output ? t.output.substring(0, 4000) : '(sem output)'}`;
      }).join('\n\n');

      // Collect objective and prior context
      const priorPhases = pipeline.phases
        .filter((_, i) => i < pipeline.currentPhase)
        .map(p => `- **${p.name}**: ${p.status}`)
        .join('\n');

      const prompt = `Voce e o Product Manager (PM) do time ThinkCoffee.
Voce esta supervisando a pipeline: "${pipeline.objective}"

## Fase atual: ${phase.name} (fase ${pipeline.currentPhase + 1} de ${pipeline.phases.length})
Agentes: ${phase.agents.map(a => AGENT_META[a].label).join(', ')}

## Fases anteriores
${priorPhases || '(nenhuma)'}

## Outputs dos agentes nesta fase
${outputs}

## Sua tarefa
Avalie os outputs dos agentes desta fase. Verifique:
1. Os outputs atendem ao objetivo da pipeline?
2. A qualidade do trabalho e aceitavel?
3. Os arquivos foram criados/modificados corretamente?
4. Ha erros, omissoes ou inconsistencias?

## Formato de resposta
Responda APENAS com JSON valido (sem markdown), no formato:
{"approved": true}
ou
{"approved": false, "feedback": "Explicacao detalhada do que precisa ser corrigido ou melhorado."}

Se os outputs estiverem razoaveis e cumprirem o minimo necessario, APROVE. Rejeite apenas se houver problemas claros.
NAO seja excessivamente exigente — foque em bloqueios reais.`;

      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const cts = new vscode.CancellationTokenSource();
      const response = await model.sendRequest(messages, {}, cts.token);

      let fullText = '';
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          fullText += part.value;
        }
      }
      cts.dispose();

      // Parse JSON
      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this._pipelineChat(pipelineId).send({
          sender: 'product-manager', senderLabel: agentLabel('product-manager'),
          content: 'Nao consegui gerar review estruturado. Aprovando fase.',
          type: 'info',
        });
        return { approved: true, feedback: '' };
      }

      const result = JSON.parse(jsonMatch[0]);
      return {
        approved: !!result.approved,
        feedback: result.feedback || '',
      };

    } catch (err: any) {
      this._pipelineChat(pipelineId).send({
        sender: 'system', senderLabel: 'System',
        content: `Erro na review do PM: ${err.message}. Auto-aprovando.`,
        type: 'error',
      });
      return { approved: true, feedback: '' };
    } finally {
      this._untrackDirect(pipelineId, 'product-manager');
      this._onAgentStateChange.fire();
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at paragraph or line boundary
    let splitIdx = remaining.lastIndexOf('\n\n', maxLen);
    if (splitIdx < maxLen * 0.3) splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen * 0.3) splitIdx = maxLen;
    chunks.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx).trimStart();
  }
  return chunks;
}
