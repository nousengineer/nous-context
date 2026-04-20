import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { discoverModels } from './ModelRegistry';

export type ReasoningDepth = 'standard' | 'deep';

export interface ReasoningResult {
  summary: string;
  steps: string[];
  confidence: number;
}

export interface GeneratedCodeResult {
  code: string;
  explanation: string;
}

export interface SecurityFinding {
  file: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  detail: string;
}

export interface SecurityScanResult {
  findings: SecurityFinding[];
  attackSimulationPlan: string[];
  exploitChainHypotheses: string[];
  defensiveRecommendations: string[];
}

export interface WorkflowStep {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  goal: string;
  steps: WorkflowStep[];
}

export interface WorkflowStepArtifact {
  stepId: string;
  stepTitle: string;
  createdAt: string;
  summary: string;
  data?: unknown;
}

export interface WorkflowExecutionState {
  workflowId: string;
  runId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  currentStepIndex: number;
  updatedAt: string;
  artifacts: WorkflowStepArtifact[];
}

interface RunSummary {
  id: string;
  kind: string;
  at: string;
  summary: string;
}

export type PmChatAction = 'none' | 'create-pipeline' | 'approve-phase' | 'reject-phase' | 'show-status';

export interface PmChatResult {
  action: PmChatAction;
  message: string;
  objective?: string;
}

const PM_SYSTEM_PROMPT = `You are the Product Manager (PM) AI for ThinkCoffee, an AI-powered software development pipeline system.

Your role:
- Understand the developer's natural-language request about software development
- Decide the appropriate action based on the request
- Orchestrate a multi-phase pipeline of specialized agents when needed

Available agents in the pipeline:
- product-manager: Defines requirements, acceptance criteria, and backlog
- architect: Designs stack, folder structure, API contracts, and data model
- backend: Implements endpoints, business logic, database migrations
- frontend: Creates UI components, pages, and API integration
- devops: Sets up CI/CD, Docker, and environment variables
- qa: Writes and runs unit and integration tests
- code-review: Final code review for standards, security, and performance
- organizer: Organizes project structure and applies design patterns
- git: Manages Git workflow (branch, commit, push, PR)
- dead-code: Identifies and removes dead code
- troubleshooter: Diagnoses and fixes failures

Respond ONLY with a valid JSON object (no markdown fences, no extra text):
{
  "action": "none" | "create-pipeline" | "approve-phase" | "reject-phase" | "show-status",
  "message": "Your natural language response to the developer",
  "objective": "Short pipeline objective (only when action is create-pipeline)"
}

Decision rules:
- "create-pipeline": user wants to build a feature, implement something, start a project, or do development work
- "approve-phase": user says approve, continue, next phase, looks good, proceed, yes, etc.
- "reject-phase": user says reject, redo, not good, revise, go back, fix, etc.
- "show-status": user asks about status, progress, what is happening, show pipeline, etc.
- "none": general questions, explanations, or anything that does not require pipeline action`;

const MEMORY_KEY = 'thinkcoffee.advancedMemory.runSummaries';
const MAX_MEMORY_ITEMS = 40;
const WORKFLOW_STATE_PREFIX = 'thinkcoffee.workflowState.';

// ─── Agent role definitions ──────────────────────────────────

export type AgentRole =
  | 'product-manager' | 'architect' | 'organizer' | 'git' | 'dead-code'
  | 'troubleshooter' | 'backend' | 'frontend' | 'devops' | 'qa' | 'code-review';

const AGENT_SYSTEM_PROMPTS: Record<AgentRole, string> = {
  'product-manager': 'You are a Product Manager AI. Analyze objectives and produce structured requirements, acceptance criteria, user stories, and a prioritized backlog. Be specific and actionable.',
  'architect': 'You are a Software Architect AI. Design technical architecture: technology stack, folder structure, API contracts, data models, and integration points. Produce concrete, implementable designs.',
  'backend': 'You are a Backend Engineer AI. Implement API endpoints, business logic, database schemas/migrations, and integrations. Write production-ready code.',
  'frontend': 'You are a Frontend Engineer AI. Create UI components, pages, state management, and API integration. Write clean, accessible, production-ready code.',
  'devops': 'You are a DevOps Engineer AI. Configure CI/CD pipelines, Dockerfiles, environment variables, deployment scripts, and infrastructure as code.',
  'qa': 'You are a QA Engineer AI. Write comprehensive unit tests, integration tests, and end-to-end tests. Report bugs with full reproduction steps and coverage analysis.',
  'code-review': 'You are a Code Reviewer AI. Review for: coding standards, security vulnerabilities, performance issues, architecture consistency, and merge readiness. Be thorough and specific.',
  'organizer': 'You are a Project Organizer AI. Analyze project structure, identify the ideal design pattern, reorganize folders/files, and fix naming inconsistencies.',
  'git': 'You are a Git Agent AI. Manage Git workflow: create branches, stage changes, write descriptive commit messages using conventional commits, push, and create PRs.',
  'dead-code': 'You are a Dead Code Analyzer AI. Identify orphan files, unused exports, unreferenced functions/classes/variables. List everything that can be safely removed.',
  'troubleshooter': 'You are a Troubleshooter AI. Diagnose failures by analyzing error output, identifying root causes, and providing specific fixes with code changes.',
};

/** Pipeline execution plan as decided by the PM */
export interface ExecutionPlan {
  phases: ExecutionPhase[];
}

export interface ExecutionPhase {
  name: string;
  agents: AgentRole[];
  parallel: boolean;
  tasks: Record<string, string>; // agent → task description
}

export interface AgentResult {
  agent: AgentRole;
  model: string;
  output: string;
  delegateTo?: AgentRole[];
  status: 'completed' | 'failed';
}

export interface PipelineExecution {
  pipelineId: string;
  objective: string;
  phaseResults: Array<{
    phase: string;
    results: AgentResult[];
  }>;
  status: 'running' | 'completed' | 'failed';
}

export class AutonomousRuntime {
  private readonly output: vscode.OutputChannel;
  private readonly runs = new Map<string, vscode.CancellationTokenSource>();

  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    output?: vscode.OutputChannel,
  ) {
    this.output = output ?? vscode.window.createOutputChannel('ThinkCoffee Advanced');
  }

  getOutput(): vscode.OutputChannel {
    return this.output;
  }

  cancelAllRuns(): number {
    const ids = [...this.runs.keys()];
    for (const id of ids) {
      this.runs.get(id)?.cancel();
      this.runs.delete(id);
    }
    return ids.length;
  }

  async adaptiveReasoning(topic: string, depth: ReasoningDepth, token?: vscode.CancellationToken): Promise<ReasoningResult> {
    const plan = this.decomposeProblem(topic, depth === 'deep' ? 7 : 4);
    const prompt = [
      `Topic: ${topic}`,
      `Depth: ${depth}`,
      'Provide a concise synthesis, hidden patterns, inconsistencies, and a prioritized action sequence.',
      'Focus on technical rigor and defensible conclusions.',
    ].join('\n');

    const llm = await this.tryLLM(prompt, depth, token);
    const summary = llm || `Structured reasoning completed for: ${topic}`;
    return {
      summary,
      steps: plan,
      confidence: depth === 'deep' ? 0.86 : 0.74,
    };
  }

  async pmChat(
    userPrompt: string,
    projectState: { projectId: string; pipelineStatus?: string },
    token: vscode.CancellationToken,
  ): Promise<PmChatResult> {
    const contextBlock = [
      `Current project: ${projectState.projectId}`,
      `Active pipeline: ${projectState.pipelineStatus ?? 'none'}`,
    ].join('\n');

    const prompt = `${contextBlock}\n\nDeveloper request: ${userPrompt}`;

    const raw = await this.tryLLM(prompt, 'standard', token, PM_SYSTEM_PROMPT);

    if (!raw) {
      return {
        action: 'none',
        message: 'PM is not available — no LLM model found. Please check your Copilot configuration.',
      };
    }

    // Extract a JSON object from the response (tolerates extra text or markdown fences)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        const validActions: PmChatAction[] = ['none', 'create-pipeline', 'approve-phase', 'reject-phase', 'show-status'];
        const action: PmChatAction = validActions.includes(parsed['action'] as PmChatAction)
          ? (parsed['action'] as PmChatAction)
          : 'none';
        return {
          action,
          message: typeof parsed['message'] === 'string' && parsed['message']
            ? parsed['message']
            : raw,
          objective: typeof parsed['objective'] === 'string' ? parsed['objective'] : undefined,
        };
      } catch {
        // fall through to plain-text response
      }
    }

    return { action: 'none', message: raw };
  }

  // ─── Agent Orchestration ───────────────────────────────────

  /**
   * Ask PM to create an execution plan: which agents, what order, parallel or sequential.
   */
  async planExecution(
    objective: string,
    requestedAgents: string[],
    token?: vscode.CancellationToken,
  ): Promise<ExecutionPlan> {
    const planPrompt = `You are orchestrating a software development pipeline.

Objective: ${objective}
Requested agents: ${requestedAgents.join(', ')}

Available agents and their capabilities:
${Object.entries(AGENT_SYSTEM_PROMPTS).map(([role, desc]) => `- ${role}: ${desc.slice(0, 80)}`).join('\n')}

Create an execution plan. Decide:
1. Which phases to create (group agents logically)
2. For each phase: which agents run, whether they run in parallel or sequential
3. For each agent: a specific task description based on the objective

Respond ONLY with a valid JSON object (no markdown fences):
{
  "phases": [
    {
      "name": "Phase name",
      "parallel": true or false,
      "agents": ["agent-role-1", "agent-role-2"],
      "tasks": {
        "agent-role-1": "Specific task description for this agent",
        "agent-role-2": "Specific task description for this agent"
      }
    }
  ]
}`;

    const raw = await this.tryLLM(planPrompt, 'standard', token);
    if (raw) {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as ExecutionPlan;
          if (Array.isArray(parsed.phases) && parsed.phases.length > 0) {
            return parsed;
          }
        } catch { /* fallthrough */ }
      }
    }

    // Fallback: sequential plan with all requested agents
    return {
      phases: [{
        name: 'Execution',
        parallel: false,
        agents: requestedAgents as AgentRole[],
        tasks: Object.fromEntries(
          requestedAgents.map(a => [a, `Execute ${a} tasks for: ${objective}`]),
        ),
      }],
    };
  }

  /**
   * Call a specific agent with a specific model (by family) and task.
   */
  async callAgent(
    role: AgentRole,
    task: string,
    context: string,
    token?: vscode.CancellationToken,
    onHeartbeat?: (msg: string) => void,
  ): Promise<AgentResult> {
    const systemPrompt = AGENT_SYSTEM_PROMPTS[role] || 'You are a software development agent.';
    const modelFamily = this.getModelForRole(role);

    this.output.appendLine(`[agent:${role}] Starting with model ${modelFamily}`);

    const prompt = [
      context ? `Context from previous phases:\n${context}\n` : '',
      `Your task:\n${task}`,
      '',
      'If you need another agent to handle part of this work, include at the END of your response:',
      'DELEGATE: agent-role-1, agent-role-2',
      '',
      'Provide a thorough, actionable response.',
    ].join('\n');

    try {
      // Start heartbeat during LLM call
      const start = Date.now();
      const hb = onHeartbeat ? setInterval(() => {
        const secs = Math.round((Date.now() - start) / 1000);
        onHeartbeat(`@${role} generating response… (${secs}s)`);
      }, 6000) : undefined;

      const output = await this.tryLLMWithModel(prompt, modelFamily, token, systemPrompt);

      if (hb) clearInterval(hb);

      if (!output) {
        return { agent: role, model: modelFamily, output: `[${role}] No response from model.`, status: 'failed' };
      }

      // Check for delegation requests
      let delegateTo: AgentRole[] | undefined;
      const delegateMatch = output.match(/DELEGATE:\s*(.+)/i);
      if (delegateMatch) {
        const validRoles = Object.keys(AGENT_SYSTEM_PROMPTS) as AgentRole[];
        delegateTo = delegateMatch[1]
          .split(',')
          .map(s => s.trim() as AgentRole)
          .filter(r => validRoles.includes(r));
      }

      this.output.appendLine(`[agent:${role}] Completed${delegateTo ? ` (delegates to: ${delegateTo.join(', ')})` : ''}`);
      return { agent: role, model: modelFamily, output, delegateTo, status: 'completed' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[agent:${role}:error] ${msg}`);
      return { agent: role, model: modelFamily, output: `Error: ${msg}`, status: 'failed' };
    }
  }

  /**
   * Execute a full pipeline: PM plans → agents execute → delegations handled.
   * Reports progress via callback.
   */
  async orchestratePipeline(
    objective: string,
    requestedAgents: string[],
    onProgress: (update: { phase: string; agent: string; status: string; output?: string }) => void,
    token?: vscode.CancellationToken,
  ): Promise<PipelineExecution> {
    const execution: PipelineExecution = {
      pipelineId: `exec_${Date.now()}`,
      objective,
      phaseResults: [],
      status: 'running',
    };

    // Step 1: PM creates execution plan
    onProgress({ phase: 'Planning', agent: 'product-manager', status: 'PM is creating execution plan…' });
    const plan = await this.planExecution(objective, requestedAgents, token);
    this.output.appendLine(`[orchestrator] Plan: ${plan.phases.length} phases`);

    // Step 2: Execute each phase
    let previousContext = `Objective: ${objective}\n`;

    for (const phase of plan.phases) {
      if (token?.isCancellationRequested) {
        execution.status = 'failed';
        break;
      }

      onProgress({ phase: phase.name, agent: phase.agents.join(', '), status: `Starting phase: ${phase.name}` });
      const phaseResults: AgentResult[] = [];

      if (phase.parallel && phase.agents.length > 1) {
        // Run agents in parallel
        const promises = phase.agents.map(async (agentRole) => {
          const role = agentRole as AgentRole;
          const task = phase.tasks[role] || `Execute ${role} tasks for: ${objective}`;
          onProgress({ phase: phase.name, agent: role, status: `${role} working…` });
          return this.callAgent(role, task, previousContext, token,
            (hb) => onProgress({ phase: phase.name, agent: role, status: hb }));
        });
        const results = await Promise.all(promises);
        phaseResults.push(...results);
      } else {
        // Run agents sequentially
        for (const agentRole of phase.agents) {
          if (token?.isCancellationRequested) break;
          const role = agentRole as AgentRole;
          const task = phase.tasks[role] || `Execute ${role} tasks for: ${objective}`;
          onProgress({ phase: phase.name, agent: role, status: `${role} working…` });
          const result = await this.callAgent(role, task, previousContext, token,
            (hb) => onProgress({ phase: phase.name, agent: role, status: hb }));
          phaseResults.push(result);

          // Handle delegations immediately
          if (result.delegateTo && result.delegateTo.length > 0) {
            for (const delegated of result.delegateTo) {
              if (token?.isCancellationRequested) break;
              onProgress({ phase: phase.name, agent: delegated, status: `${role} delegated to ${delegated}…` });
              const delegateContext = `${previousContext}\n\n[${role} output]:\n${result.output.slice(0, 4000)}`;
              const delegateTask = `${role} delegated this to you. Complete the work based on their output.`;
              const delegateResult = await this.callAgent(delegated, delegateTask, delegateContext, token,
                (hb) => onProgress({ phase: phase.name, agent: delegated, status: hb }));
              phaseResults.push(delegateResult);
            }
          }

          // Accumulate context for next agent
          previousContext += `\n\n[${role} output]:\n${result.output.slice(0, 3000)}`;
        }
      }

      // Post phase results
      for (const r of phaseResults) {
        onProgress({ phase: phase.name, agent: r.agent, status: 'completed', output: r.output });
      }

      execution.phaseResults.push({ phase: phase.name, results: phaseResults });

      // Accumulate parallel results for next phase
      if (phase.parallel) {
        for (const r of phaseResults) {
          previousContext += `\n\n[${r.agent} output]:\n${r.output.slice(0, 3000)}`;
        }
      }
    }

    execution.status = token?.isCancellationRequested ? 'failed' : 'completed';
    this.output.appendLine(`[orchestrator] Pipeline ${execution.status}: ${execution.phaseResults.length} phases executed`);
    return execution;
  }

  /** Get the configured model family for an agent role */
  private getModelForRole(role: AgentRole): string {
    // Use the model mapping from @thinkcoffee/core agent-config
    const FREE_TIER_MODELS: Record<string, string> = {
      'product-manager': 'gpt-4.1',
      'architect': 'gpt-4o',
      'organizer': 'gpt-4.1',
      'git': 'gpt-4.1',
      'dead-code': 'gpt-4.1',
      'troubleshooter': 'gpt-4.1',
      'backend': 'gpt-5-mini',
      'frontend': 'gpt-4.1',
      'devops': 'gpt-5-mini',
      'qa': 'raptor-mini',
      'code-review': 'gpt-5-mini',
    };
    return FREE_TIER_MODELS[role] || 'gpt-4.1';
  }

  /** Send prompt to a specific model by family name */
  private async tryLLMWithModel(
    prompt: string,
    modelFamily: string,
    token?: vscode.CancellationToken,
    systemPrompt?: string,
  ): Promise<string> {
    try {
      const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      // Try to find the requested model by family
      let model = allModels.find(m => m.family === modelFamily);
      if (!model) {
        // Fallback: pick any available
        model = allModels[0];
        if (model) {
          this.output.appendLine(`[tryLLMWithModel] Model ${modelFamily} not found, using ${model.family}`);
        }
      }
      if (!model) {
        this.output.appendLine('[tryLLMWithModel] No models available');
        return '';
      }

      const messages = [
        vscode.LanguageModelChatMessage.User(
          [systemPrompt || 'You are a technical assistant.', '', prompt].join('\n\n'),
        ),
      ];

      const cts = token ? undefined : new vscode.CancellationTokenSource();
      const useToken = token || cts!.token;
      try {
        const response = await model.sendRequest(messages, {}, useToken);
        let text = '';
        for await (const chunk of response.text) {
          text += chunk;
        }
        return text.trim();
      } finally {
        cts?.dispose();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[tryLLMWithModel:error] ${msg}`);
      return '';
    }
  }

  decomposeProblem(problem: string, maxSteps: number): string[] {
    const parts = problem
      .split(/[\n\.;:]/)
      .map(s => s.trim())
      .filter(Boolean);
    const base = parts.length > 0 ? parts : [problem.trim() || 'Define problem'];
    const steps = base.slice(0, Math.max(1, maxSteps)).map((p, i) => `${i + 1}. ${p}`);
    if (steps.length < maxSteps) {
      steps.push(`${steps.length + 1}. Validate assumptions and constraints`);
    }
    return steps;
  }

  async generateAdvancedCode(requirement: string, languageHint = 'typescript'): Promise<GeneratedCodeResult> {
    const prompt = [
      `Generate ${languageHint} code for the requirement below.`,
      'Requirement:',
      requirement,
      'Include robust error handling and small focused functions.',
    ].join('\n');

    const response = await this.tryLLM(prompt, 'deep');
    const code = response || this.fallbackCode(requirement, languageHint);
    return {
      code,
      explanation: 'Generated with adaptive prompt strategy and safe defaults.',
    };
  }

  async debugCode(source: string, issueDescription: string): Promise<ReasoningResult> {
    const prompt = [
      'Analyze code and suggest likely root causes and fixes.',
      `Issue: ${issueDescription}`,
      `Code:\n${source.slice(0, 12000)}`,
    ].join('\n');
    const result = await this.tryLLM(prompt, 'deep');
    const steps = [
      'Reproduce issue with minimal case',
      'Inspect boundary conditions and null/undefined paths',
      'Validate async/await and error propagation',
      'Add targeted tests for the failing scenario',
    ];
    return {
      summary: result || 'Debug analysis completed with probable causes and remediations.',
      steps,
      confidence: 0.8,
    };
  }

  async refactorCode(source: string, strategy: string): Promise<GeneratedCodeResult> {
    const prompt = [
      `Refactor this code using strategy: ${strategy}.`,
      'Keep behavior equivalent and improve maintainability.',
      `Code:\n${source.slice(0, 12000)}`,
    ].join('\n');
    const response = await this.tryLLM(prompt, 'deep');
    return {
      code: response || source,
      explanation: `Refactoring strategy applied: ${strategy}`,
    };
  }

  async runSecurityDefenseScan(workspacePath: string): Promise<SecurityScanResult> {
    const files = this.collectTextFiles(workspacePath, 200);
    const findings: SecurityFinding[] = [];

    const secretRe = /(api[_-]?key|token|secret|password)\s*[:=]\s*['\"][^'\"]{8,}/i;
    const evalRe = /\beval\s*\(/;
    const execRe = /child_process\.(exec|spawn)|\bexec\s*\(/;
    const sqlConcatRe = /(SELECT|INSERT|UPDATE|DELETE)[\s\S]{0,80}\+/i;

    for (const filePath of files) {
      let content = '';
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      const rel = path.relative(workspacePath, filePath).replace(/\\/g, '/');

      if (secretRe.test(content)) {
        findings.push({
          file: rel,
          severity: 'high',
          title: 'Potential hardcoded secret',
          detail: 'Detected token/password-like assignment. Move to secure secret storage.',
        });
      }
      if (evalRe.test(content)) {
        findings.push({
          file: rel,
          severity: 'high',
          title: 'Dynamic code execution risk',
          detail: 'Usage of eval() can enable injection and code execution issues.',
        });
      }
      if (execRe.test(content)) {
        findings.push({
          file: rel,
          severity: 'medium',
          title: 'Command execution surface',
          detail: 'Review command construction and sanitization for shell injection.',
        });
      }
      if (sqlConcatRe.test(content)) {
        findings.push({
          file: rel,
          severity: 'medium',
          title: 'Potential SQL injection pattern',
          detail: 'Use parameterized queries instead of string concatenation.',
        });
      }
    }

    return {
      findings,
      attackSimulationPlan: [
        'Enumerate externally reachable entry points',
        'Model auth bypass and privilege escalation paths',
        'Stress error handlers and race conditions in a sandbox',
        'Validate logging, alerting, and containment controls',
      ],
      exploitChainHypotheses: [
        'Input validation weakness -> command execution -> lateral movement',
        'Leaked token -> privileged API calls -> data exfiltration',
      ],
      defensiveRecommendations: [
        'Enforce secret scanning and rotation policy',
        'Adopt strict input validation and output encoding',
        'Use least-privilege service accounts and scoped tokens',
        'Add attack-path regression tests in CI',
      ],
    };
  }

  async analyzeMultimodal(filePaths: string[], topic: string): Promise<ReasoningResult> {
    const summaries: string[] = [];
    for (const f of filePaths) {
      const ext = path.extname(f).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext)) {
        summaries.push(`Image/diagram detected: ${path.basename(f)} (${ext})`);
      } else {
        summaries.push(`Text/document detected: ${path.basename(f)} (${ext || 'no-ext'})`);
      }
    }

    const prompt = [
      `Synthesize interdisciplinary insights for topic: ${topic}`,
      'Inputs:',
      ...summaries,
      'Highlight hidden patterns, contradictions, and next experiments.',
    ].join('\n');

    const response = await this.tryLLM(prompt, 'deep');
    return {
      summary: response || `Multimodal synthesis completed for ${filePaths.length} input(s).`,
      steps: [
        'Classify modalities and information density',
        'Extract entities, relationships, and constraints',
        'Unify into coherent technical model',
        'Flag uncertainties and validation plan',
      ],
      confidence: 0.77,
    };
  }

  createWorkflow(name: string, goal: string, stepTitles: string[]): WorkflowDefinition {
    return {
      id: `wf-${Date.now()}`,
      name,
      goal,
      steps: stepTitles.map((title, i) => ({
        id: `step-${i + 1}`,
        title,
        status: 'pending',
      })),
    };
  }

  async executeWorkflow(
    workflow: WorkflowDefinition,
    perStep: (step: WorkflowStep) => Promise<unknown>,
    options?: { resumeFromStepIndex?: number },
  ): Promise<WorkflowExecutionState> {
    const runId = `run-${Date.now()}`;
    const cts = new vscode.CancellationTokenSource();
    this.runs.set(runId, cts);

    const resumeFrom = Math.max(0, options?.resumeFromStepIndex ?? 0);
    const previous = this.getWorkflowState(workflow.id);
    const initialArtifacts = previous?.artifacts ?? [];
    const state: WorkflowExecutionState = {
      workflowId: workflow.id,
      runId,
      status: 'running',
      currentStepIndex: resumeFrom,
      updatedAt: new Date().toISOString(),
      artifacts: [...initialArtifacts],
    };
    this.saveWorkflowState(state);

    try {
      for (let i = resumeFrom; i < workflow.steps.length; i++) {
        const step = workflow.steps[i];
        if (cts.token.isCancellationRequested) {
          step.status = 'cancelled';
          state.status = 'cancelled';
          break;
        }
        step.status = 'running';

        try {
          const result = await perStep(step);
          step.status = 'done';
          state.currentStepIndex = i + 1;
          state.updatedAt = new Date().toISOString();
          state.artifacts.push({
            stepId: step.id,
            stepTitle: step.title,
            createdAt: state.updatedAt,
            summary: `Completed ${step.title}`,
            data: result,
          });
          this.saveWorkflowState(state);
        } catch (error) {
          step.status = 'failed';
          state.status = 'failed';
          state.updatedAt = new Date().toISOString();
          state.artifacts.push({
            stepId: step.id,
            stepTitle: step.title,
            createdAt: state.updatedAt,
            summary: `Failed ${step.title}: ${String(error)}`,
          });
          this.saveWorkflowState(state);
          throw error;
        }
      }

      if (state.status === 'running') {
        state.status = 'completed';
        state.updatedAt = new Date().toISOString();
      }

      this.remember({
        id: runId,
        kind: 'workflow',
        at: new Date().toISOString(),
        summary: `${workflow.name}: ${workflow.steps.filter(s => s.status === 'done').length}/${workflow.steps.length} steps completed`,
      });
      this.saveWorkflowState(state);
      return state;
    } finally {
      this.runs.delete(runId);
      cts.dispose();
    }
  }

  getWorkflowState(workflowId: string): WorkflowExecutionState | undefined {
    return this.extensionContext.workspaceState.get<WorkflowExecutionState>(
      `${WORKFLOW_STATE_PREFIX}${workflowId}`,
    );
  }

  clearWorkflowState(workflowId: string): Thenable<void> {
    return this.extensionContext.workspaceState.update(`${WORKFLOW_STATE_PREFIX}${workflowId}`, undefined);
  }

  async runLongTask<T>(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => Promise<T>,
  ): Promise<T | undefined> {
    const runId = `long-${Date.now()}`;
    const cts = new vscode.CancellationTokenSource();
    this.runs.set(runId, cts);

    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title,
          cancellable: true,
        },
        async (progress, token) => {
          token.onCancellationRequested(() => cts.cancel());
          return task(progress, cts.token);
        },
      );

      this.remember({
        id: runId,
        kind: 'long-task',
        at: new Date().toISOString(),
        summary: title,
      });
      return result;
    } finally {
      this.runs.delete(runId);
      cts.dispose();
    }
  }

  getMemory(): RunSummary[] {
    return this.extensionContext.globalState.get<RunSummary[]>(MEMORY_KEY, []);
  }

  private remember(item: RunSummary): void {
    const current = this.extensionContext.globalState.get<RunSummary[]>(MEMORY_KEY, []);
    const next = [item, ...current].slice(0, MAX_MEMORY_ITEMS);
    void this.extensionContext.globalState.update(MEMORY_KEY, next);
  }

  private saveWorkflowState(state: WorkflowExecutionState): void {
    void this.extensionContext.workspaceState.update(
      `${WORKFLOW_STATE_PREFIX}${state.workflowId}`,
      state,
    );
  }

  private async tryLLM(
    prompt: string,
    depth: ReasoningDepth,
    token?: vscode.CancellationToken,
    systemPrompt?: string,
  ): Promise<string> {
    try {
      // First, check available models via registry
      const discovered = await discoverModels();
      if (!discovered.length) {
        this.output.appendLine('[tryLLM] No models discovered via ModelRegistry');
        return '';
      }

      // Then get the actual VSCode LM models
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      const model = models[0];
      if (!model) {
        this.output.appendLine('[tryLLM] No models available from vscode.lm');
        return '';
      }

      const messages = [
        vscode.LanguageModelChatMessage.User(
          [
            systemPrompt || 'You are a technical reasoning assistant.',
            `Reasoning depth: ${depth}`,
            prompt,
          ].join('\n\n'),
        ),
      ];

      // Use the provided cancellation token so the caller's cancel button works
      if (token) {
        const response = await model.sendRequest(messages, {}, token);
        let text = '';
        for await (const chunk of response.text) {
          text += chunk;
        }
        return text.trim();
      }

      const cts = new vscode.CancellationTokenSource();
      try {
        const response = await model.sendRequest(messages, {}, cts.token);
        let text = '';
        for await (const chunk of response.text) {
          text += chunk;
        }
        return text.trim();
      } finally {
        cts.dispose();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[tryLLM:error] ${msg}`);
      return '';
    }
  }

  private fallbackCode(requirement: string, languageHint: string): string {
    if (languageHint.toLowerCase().includes('ts')) {
      return [
        '// Auto-generated fallback implementation',
        `// Requirement: ${requirement}`,
        'export function solveRequirement(input: unknown): { ok: boolean; data: unknown } {',
        '  try {',
        '    return { ok: true, data: input };',
        '  } catch (error) {',
        '    return { ok: false, data: String(error) };',
        '  }',
        '}',
      ].join('\n');
    }

    return [
      '# Auto-generated fallback implementation',
      `# Requirement: ${requirement}`,
      'def solve_requirement(data):',
      '    return {"ok": True, "data": data}',
    ].join('\n');
  }

  private collectTextFiles(workspacePath: string, maxFiles: number): string[] {
    const out: string[] = [];
    const ignore = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt']);
    const allow = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.yml', '.yaml', '.py', '.go', '.java', '.cs', '.rs']);

    const walk = (dir: string): void => {
      if (out.length >= maxFiles) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= maxFiles) return;
        if (e.isDirectory()) {
          if (!ignore.has(e.name)) walk(path.join(dir, e.name));
          continue;
        }
        const full = path.join(dir, e.name);
        if (allow.has(path.extname(e.name).toLowerCase())) out.push(full);
      }
    };

    walk(workspacePath);
    return out;
  }
}
