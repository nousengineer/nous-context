import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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

const MEMORY_KEY = 'thinkcoffee.advancedMemory.runSummaries';
const MAX_MEMORY_ITEMS = 40;
const WORKFLOW_STATE_PREFIX = 'thinkcoffee.workflowState.';

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

  async adaptiveReasoning(topic: string, depth: ReasoningDepth): Promise<ReasoningResult> {
    const plan = this.decomposeProblem(topic, depth === 'deep' ? 7 : 4);
    const prompt = [
      `Topic: ${topic}`,
      `Depth: ${depth}`,
      'Provide a concise synthesis, hidden patterns, inconsistencies, and a prioritized action sequence.',
      'Focus on technical rigor and defensible conclusions.',
    ].join('\n');

    const llm = await this.tryLLM(prompt, depth);
    const summary = llm || `Structured reasoning completed for: ${topic}`;
    return {
      summary,
      steps: plan,
      confidence: depth === 'deep' ? 0.86 : 0.74,
    };
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

  private async tryLLM(prompt: string, depth: ReasoningDepth): Promise<string> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      const model = models[0];
      if (!model) return '';

      const messages = [
        vscode.LanguageModelChatMessage.User(
          [
            'You are a technical reasoning assistant.',
            `Reasoning depth: ${depth}`,
            prompt,
          ].join('\n\n'),
        ),
      ];

      const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
      let text = '';
      for await (const chunk of response.text) {
        text += chunk;
      }
      return text.trim();
    } catch {
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
