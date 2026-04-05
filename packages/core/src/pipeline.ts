import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────

export type AgentRole =
  | 'product-manager'
  | 'architect'
  | 'backend'
  | 'frontend'
  | 'devops'
  | 'qa'
  | 'code-review';

export type PhaseStatus = 'pending' | 'in-progress' | 'awaiting-approval' | 'approved' | 'completed' | 'failed';
export type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'blocked';
export type PipelineStatus = 'planning' | 'architecture' | 'implementation' | 'testing' | 'review' | 'completed' | 'failed';

export interface AgentTask {
  id: string;
  agent: AgentRole;
  title: string;
  description: string;
  status: TaskStatus;
  output?: string;
  artifacts?: string[];
  startedAt?: string;
  completedAt?: string;
}

export interface PipelinePhase {
  id: string;
  name: string;
  order: number;
  parallel: boolean;
  requiresApproval: boolean;
  status: PhaseStatus;
  agents: AgentRole[];
  tasks: AgentTask[];
  approvedAt?: string;
  approvedBy?: string;
}

export interface Pipeline {
  id: string;
  projectId: string;
  workspace: string;
  objective: string;
  status: PipelineStatus;
  currentPhase: number;
  phases: PipelinePhase[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ─── Agent metadata ──────────────────────────────────────────

export const AGENT_META: Record<AgentRole, { label: string; description: string }> = {
  'product-manager': {
    label: 'Product Manager',
    description: 'Transforma o objetivo em requisitos estruturados, criterios de aceite e backlog priorizado.',
  },
  'architect': {
    label: 'Architect',
    description: 'Define stack, estrutura de pastas, contratos de API e modelo de dados.',
  },
  'backend': {
    label: 'Backend Engineer',
    description: 'Implementa endpoints, regras de negocio, migrations e integracoes.',
  },
  'frontend': {
    label: 'Frontend Engineer',
    description: 'Cria componentes, telas, integra com a API do backend.',
  },
  'devops': {
    label: 'DevOps Engineer',
    description: 'Configura CI/CD, Dockerfile, variaveis de ambiente, deploy.',
  },
  'qa': {
    label: 'QA Engineer',
    description: 'Escreve e roda testes unitarios e de integracao, reporta bugs.',
  },
  'code-review': {
    label: 'Code Reviewer',
    description: 'Revisao final: padroes de codigo, seguranca, performance, consistencia.',
  },
};

// ─── Default phase templates ─────────────────────────────────

function createDefaultPhases(): Omit<PipelinePhase, 'id' | 'tasks'>[] {
  return [
    { name: 'Planning', order: 0, parallel: false, requiresApproval: true, status: 'pending', agents: ['product-manager'] },
    { name: 'Architecture', order: 1, parallel: false, requiresApproval: true, status: 'pending', agents: ['architect'] },
    { name: 'Implementation', order: 2, parallel: true, requiresApproval: true, status: 'pending', agents: ['backend', 'frontend', 'devops'] },
    { name: 'Testing', order: 3, parallel: false, requiresApproval: true, status: 'pending', agents: ['qa'] },
    { name: 'Code Review', order: 4, parallel: false, requiresApproval: true, status: 'pending', agents: ['code-review'] },
  ];
}

function createTasksForPhase(phaseName: string, agents: AgentRole[], objective: string): AgentTask[] {
  const taskDescriptions: Record<AgentRole, (obj: string) => { title: string; description: string }> = {
    'product-manager': (obj) => ({
      title: 'Define requirements & backlog',
      description: `Analyze the objective: "${obj}"\n\nProduce:\n1. Structured requirements\n2. Acceptance criteria\n3. Prioritized backlog\n4. User stories`,
    }),
    'architect': (obj) => ({
      title: 'Design technical architecture',
      description: `Based on the PM requirements, design:\n1. Technology stack\n2. Folder/project structure\n3. API contracts\n4. Data model\n5. Integration points`,
    }),
    'backend': (_) => ({
      title: 'Implement backend',
      description: 'Follow the architecture document to implement:\n1. API endpoints\n2. Business logic\n3. Database migrations\n4. External integrations',
    }),
    'frontend': (_) => ({
      title: 'Implement frontend',
      description: 'Follow the architecture document to implement:\n1. UI components\n2. Pages/screens\n3. API integration\n4. State management',
    }),
    'devops': (_) => ({
      title: 'Setup infrastructure',
      description: 'Configure:\n1. CI/CD pipeline\n2. Dockerfile / container setup\n3. Environment variables\n4. Deployment scripts',
    }),
    'qa': (_) => ({
      title: 'Test & validate',
      description: 'Write and execute:\n1. Unit tests\n2. Integration tests\n3. Bug reports with full context\n4. Test coverage report',
    }),
    'code-review': (_) => ({
      title: 'Final code review',
      description: 'Review for:\n1. Code patterns & standards\n2. Security vulnerabilities\n3. Performance issues\n4. Architecture consistency\n5. Merge readiness',
    }),
  };

  return agents.map(agent => {
    const gen = taskDescriptions[agent];
    const { title, description } = gen(objective);
    return {
      id: crypto.randomUUID(),
      agent,
      title,
      description,
      status: 'pending' as TaskStatus,
    };
  });
}

// ─── Storage ─────────────────────────────────────────────────

function getPipelinesDir(projectId: string): string {
  const dir = path.join(os.homedir(), '.thinkcoffee', 'pipelines', projectId);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(`[ThinkCoffee] Cannot create pipelines dir ${dir}: ${(err as Error).message}`);
  }
  return dir;
}

function savePipeline(p: Pipeline): void {
  const dir = getPipelinesDir(p.projectId);
  const file = path.join(dir, `${p.id}.json`);
  fs.writeFileSync(file, JSON.stringify(p, null, 2), 'utf-8');
}

function loadPipeline(projectId: string, pipelineId: string): Pipeline | null {
  const file = path.join(getPipelinesDir(projectId), `${pipelineId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error(`[ThinkCoffee] Failed to parse pipeline ${pipelineId}: ${(err as Error).message}`);
    return null;
  }
}

// ─── PipelineService ─────────────────────────────────────────

export class PipelineService {
  /** Create a new pipeline from an objective */
  create(projectId: string, objective: string, workspace: string): Pipeline {
    const id = crypto.randomUUID();
    const phaseTemplates = createDefaultPhases();

    const phases: PipelinePhase[] = phaseTemplates.map(pt => {
      const phaseId = crypto.randomUUID();
      return {
        ...pt,
        id: phaseId,
        tasks: createTasksForPhase(pt.name, pt.agents, objective),
      };
    });

    // First phase starts automatically
    phases[0].status = 'in-progress';
    phases[0].tasks.forEach(t => { t.status = 'pending'; });

    const pipeline: Pipeline = {
      id,
      projectId,
      workspace,
      objective,
      status: 'planning',
      currentPhase: 0,
      phases,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    savePipeline(pipeline);
    return pipeline;
  }

  /** Get a pipeline by ID */
  get(projectId: string, pipelineId: string): Pipeline | null {
    return loadPipeline(projectId, pipelineId);
  }

  /** List all pipelines for a project */
  list(projectId: string): Pipeline[] {
    const dir = getPipelinesDir(projectId);
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    } catch {
      return [];
    }
    const results: Pipeline[] = [];
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        results.push(data);
      } catch (err) {
        console.error(`[ThinkCoffee] Skipping corrupted pipeline file ${f}: ${(err as Error).message}`);
      }
    }
    return results;
  }

  /** Get the active pipeline for a project (most recent non-completed) */
  getActive(projectId: string): Pipeline | null {
    const all = this.list(projectId);
    return all.find(p => p.status !== 'completed' && p.status !== 'failed') || null;
  }

  /** Get tasks for a specific agent role in the current phase */
  getAgentTasks(projectId: string, pipelineId: string, agent: AgentRole): AgentTask[] {
    const p = this.get(projectId, pipelineId);
    if (!p) return [];
    const phase = p.phases[p.currentPhase];
    if (!phase) return [];
    return phase.tasks.filter(t => t.agent === agent);
  }

  /** Start working on a task */
  startTask(projectId: string, pipelineId: string, taskId: string): Pipeline | null {
    const p = this.get(projectId, pipelineId);
    if (!p) return null;

    for (const phase of p.phases) {
      const task = phase.tasks.find(t => t.id === taskId);
      if (task) {
        if (task.status !== 'pending') return p; // already started
        task.status = 'in-progress';
        task.startedAt = new Date().toISOString();
        p.updatedAt = new Date().toISOString();
        savePipeline(p);
        return p;
      }
    }
    return p;
  }

  /** Complete a task with output and optionally list of artifacts (files) */
  completeTask(projectId: string, pipelineId: string, taskId: string, output: string, artifacts?: string[]): Pipeline | null {
    const p = this.get(projectId, pipelineId);
    if (!p) return null;

    const phase = p.phases[p.currentPhase];
    if (!phase) return p;

    const task = phase.tasks.find(t => t.id === taskId);
    if (!task) return p;

    task.status = 'completed';
    task.output = output;
    task.artifacts = artifacts;
    task.completedAt = new Date().toISOString();
    p.updatedAt = new Date().toISOString();

    // Check if all tasks in the phase are completed
    const allDone = phase.tasks.every(t => t.status === 'completed');
    if (allDone) {
      phase.status = phase.requiresApproval ? 'awaiting-approval' : 'completed';
      if (!phase.requiresApproval) {
        this._advancePhase(p);
      }
    }

    savePipeline(p);
    return p;
  }

  /** Fail a task with reason */
  failTask(projectId: string, pipelineId: string, taskId: string, reason: string): Pipeline | null {
    const p = this.get(projectId, pipelineId);
    if (!p) return null;

    for (const phase of p.phases) {
      const task = phase.tasks.find(t => t.id === taskId);
      if (task) {
        task.status = 'failed';
        task.output = reason;
        task.completedAt = new Date().toISOString();
        phase.status = 'failed';
        p.status = 'failed';
        p.updatedAt = new Date().toISOString();
        savePipeline(p);
        return p;
      }
    }
    return p;
  }

  /** Programmer approves the current phase, advancing to the next */
  approvePhase(projectId: string, pipelineId: string, approver: string = 'programmer'): Pipeline | null {
    const p = this.get(projectId, pipelineId);
    if (!p) return null;

    const phase = p.phases[p.currentPhase];
    if (!phase || phase.status !== 'awaiting-approval') return p;

    phase.status = 'approved';
    phase.approvedAt = new Date().toISOString();
    phase.approvedBy = approver;
    p.updatedAt = new Date().toISOString();

    this._advancePhase(p);
    savePipeline(p);
    return p;
  }

  /** Reject phase — sends it back to in-progress with feedback */
  rejectPhase(projectId: string, pipelineId: string, feedback: string): Pipeline | null {
    const p = this.get(projectId, pipelineId);
    if (!p) return null;

    const phase = p.phases[p.currentPhase];
    if (!phase || phase.status !== 'awaiting-approval') return p;

    // Reset tasks to pending so agents can redo them
    phase.status = 'in-progress';
    phase.tasks.forEach(t => {
      t.status = 'pending';
      t.output = (t.output || '') + `\n\n--- FEEDBACK ---\n${feedback}`;
      t.completedAt = undefined;
    });
    p.updatedAt = new Date().toISOString();
    savePipeline(p);
    return p;
  }

  /** Get a formatted status summary */
  getStatusSummary(projectId: string, pipelineId: string): string {
    const p = this.get(projectId, pipelineId);
    if (!p) return 'Pipeline not found.';

    const phaseStatusIcon: Record<PhaseStatus, string> = {
      'pending': '[ ]',
      'in-progress': '[>]',
      'awaiting-approval': '[?]',
      'approved': '[v]',
      'completed': '[v]',
      'failed': '[x]',
    };

    const taskStatusIcon: Record<TaskStatus, string> = {
      'pending': '[ ]',
      'in-progress': '[>]',
      'completed': '[v]',
      'failed': '[x]',
      'blocked': '[-]',
    };

    let out = `Pipeline: ${p.objective}\n`;
    out += `Status: ${p.status}\n`;
    out += `Created: ${p.createdAt}\n\n`;

    for (const phase of p.phases) {
      const icon = phaseStatusIcon[phase.status];
      out += `${icon} Phase ${phase.order + 1}: ${phase.name} (${phase.status})\n`;
      for (const task of phase.tasks) {
        const tIcon = taskStatusIcon[task.status];
        const agent = AGENT_META[task.agent].label;
        out += `    ${tIcon} ${agent}: ${task.title}\n`;
        if (task.output && phase.order === p.currentPhase) {
          const preview = task.output.length > 200 ? task.output.substring(0, 200) + '...' : task.output;
          out += `        Output: ${preview}\n`;
        }
      }
    }

    return out;
  }

  /**
   * Persist the completed task's output as a context entry + decision in the project DB.
   * Accepts service-like objects so it works without importing TypeORM directly.
   */
  async saveAgentHistory(
    projectId: string,
    pipelineId: string,
    taskId: string,
    contextService: { create(input: Record<string, any>): Promise<any> },
    decisionService: { create(input: Record<string, any>): Promise<any> },
  ): Promise<void> {
    const p = this.get(projectId, pipelineId);
    if (!p) return;

    let task: AgentTask | undefined;
    let phaseName = '';
    for (const phase of p.phases) {
      const t = phase.tasks.find(tk => tk.id === taskId);
      if (t) { task = t; phaseName = phase.name; break; }
    }
    if (!task || task.status !== 'completed' || !task.output) return;

    const agentLabel = AGENT_META[task.agent].label;

    // Context entry — full output for searchable history
    await contextService.create({
      projectId,
      key: `pipeline/${pipelineId}/${task.agent}`,
      value: task.output,
      category: 'agent-output',
      priority: 3,
      metadata: {
        pipelineId,
        phaseName,
        taskId: task.id,
        agent: task.agent,
        agentLabel,
        taskTitle: task.title,
        artifacts: task.artifacts || [],
        completedAt: task.completedAt,
        objective: p.objective,
      },
    });

    // Decision — records what the agent decided / did
    await decisionService.create({
      projectId,
      title: `[${agentLabel}] ${task.title}`,
      description: task.output.length > 4000 ? task.output.substring(0, 4000) + '\n\n... (truncated)' : task.output,
      rationale: {
        pipeline: pipelineId,
        phase: phaseName,
        agent: task.agent,
        objective: p.objective,
        artifacts: task.artifacts || [],
      },
    });
  }

  /** Delete a pipeline */
  delete(projectId: string, pipelineId: string): boolean {
    const file = path.join(getPipelinesDir(projectId), `${pipelineId}.json`);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
    return false;
  }

  // ─── Internal ────────────────────────────────────────────

  private _advancePhase(p: Pipeline): void {
    const statusMap: PipelineStatus[] = ['planning', 'architecture', 'implementation', 'testing', 'review', 'completed'];

    p.phases[p.currentPhase].status = 'completed';
    p.currentPhase++;

    if (p.currentPhase >= p.phases.length) {
      p.status = 'completed';
      p.completedAt = new Date().toISOString();
    } else {
      p.status = statusMap[p.currentPhase] || 'implementation';
      p.phases[p.currentPhase].status = 'in-progress';
    }
  }
}
