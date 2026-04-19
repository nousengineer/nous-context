import * as vscode from 'vscode';
import { AutonomousRuntime } from './agents/AutonomousRuntime';
import type { WorkflowDefinition } from './agents/AutonomousRuntime';
import { OrchestratorClient, OrchestratorHttpError } from './utils/orchestratorClient';

let runtime: AutonomousRuntime | undefined;
const RUN_ID_KEY = 'thinkcoffee.currentOrchestratorRunId';
const PLAN_ID_KEY = 'thinkcoffee.currentOrchestratorPlanId';
const WORKSPACE_ID_KEY = 'thinkcoffee.currentOrchestratorWorkspaceId';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  runtime = new AutonomousRuntime(context);
  const out = runtime.getOutput();
  out.appendLine('[ThinkCoffee] Extension activated');

  const register = (command: string, handler: (...args: unknown[]) => unknown) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  };

  register('thinkcoffee.advancedSoftware.generateCode', async () => {
    const prompt = await vscode.window.showInputBox({ prompt: 'Describe the code you need' });
    if (!prompt || !runtime) return;

    const language = await vscode.window.showQuickPick(['typescript', 'javascript', 'python'], {
      placeHolder: 'Target language',
    });
    if (!language) return;

    const result = await runtime.runLongTask('ThinkCoffee: advanced code generation', async () => {
      return runtime!.generateAdvancedCode(prompt, language);
    });
    if (!result) return;

    const document = await vscode.workspace.openTextDocument({ content: result.code, language });
    await vscode.window.showTextDocument(document, { preview: false });
    out.appendLine(`[generateCode] ${result.explanation}`);
  });

  register('thinkcoffee.advancedSoftware.debugCode', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !runtime) {
      vscode.window.showWarningMessage('Open a file to run debug analysis.');
      return;
    }

    const issue = await vscode.window.showInputBox({ prompt: 'What is failing?' });
    if (!issue) return;

    const source = editor.document.getText();
    const result = await runtime.runLongTask('ThinkCoffee: automatic debug analysis', async () => {
      return runtime!.debugCode(source, issue);
    });
    if (!result) return;

    out.appendLine('[debugCode] Summary:');
    out.appendLine(result.summary);
    out.show(true);
  });

  register('thinkcoffee.advancedSoftware.refactorCode', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !runtime) return;

    const strategy = await vscode.window.showQuickPick(
      ['extract-function', 'optimize-performance', 'improve-readability', 'remove-duplication', 'add-type-safety'],
      { placeHolder: 'Refactoring strategy' },
    );
    if (!strategy) return;

    const source = editor.document.getText();
    const result = await runtime.runLongTask('ThinkCoffee: code refactoring', async () => {
      return runtime!.refactorCode(source, strategy);
    });
    if (!result) return;

    const doc = await vscode.workspace.openTextDocument({
      content: result.code,
      language: editor.document.languageId,
    });
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  });

  register('thinkcoffee.advancedSecurity.scanVulnerabilities', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || !runtime) return;

    const result = await runtime.runLongTask('ThinkCoffee: defensive security scan', async () => {
      return runtime!.runSecurityDefenseScan(folder.uri.fsPath);
    });
    if (!result) return;

    out.appendLine('[securityScan] Findings');
    for (const finding of result.findings) {
      out.appendLine(`- [${finding.severity.toUpperCase()}] ${finding.file}: ${finding.title}`);
    }
    out.show(true);
  });

  register('thinkcoffee.advancedSecurity.simulateAttack', async () => {
    const target = await vscode.window.showInputBox({ prompt: 'Target for controlled simulation' });
    if (!target || !runtime) return;

    const analysis = await runtime.adaptiveReasoning(
      `Create defensive multi-step attack simulation plan for controlled testing on: ${target}`,
      'deep',
    );
    out.appendLine('[attackSimulation]');
    out.appendLine(analysis.summary);
    out.show(true);
  });

  register('thinkcoffee.advancedSecurity.zeroDayDiscovery', async () => {
    const system = await vscode.window.showInputBox({ prompt: 'System description for defensive zero-day hypotheses' });
    if (!system || !runtime) return;

    const analysis = await runtime.adaptiveReasoning(
      `Identify plausible zero-day hypotheses and defensive validation tests for: ${system}`,
      'deep',
    );
    out.appendLine('[zeroDayDiscovery]');
    out.appendLine(analysis.summary);
    out.show(true);
  });

  register('thinkcoffee.advancedMultimodal.analyzeImage', async () => {
    const selected = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] },
    });
    if (!selected || selected.length === 0 || !runtime) return;

    const result = await runtime.analyzeMultimodal(selected.map(x => x.fsPath), 'Image analysis');
    out.appendLine(result.summary);
    out.show(true);
  });

  register('thinkcoffee.advancedMultimodal.analyzeDiagram', async () => {
    const selected = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      filters: { Diagrams: ['svg', 'png', 'jpg', 'jpeg', 'md', 'txt'] },
    });
    if (!selected || selected.length === 0 || !runtime) return;

    const result = await runtime.analyzeMultimodal(selected.map(x => x.fsPath), 'Diagram interpretation');
    out.appendLine(result.summary);
    out.show(true);
  });

  register('thinkcoffee.advancedMultimodal.synthesizeKnowledge', async () => {
    const selected = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFolders: false });
    if (!selected || selected.length === 0 || !runtime) return;

    const topic = await vscode.window.showInputBox({ prompt: 'Knowledge synthesis topic' });
    if (!topic) return;

    const result = await runtime.analyzeMultimodal(selected.map(x => x.fsPath), topic);
    out.appendLine(result.summary);
    out.show(true);
  });

  register('thinkcoffee.reasoning.multiStepSolve', async () => {
    const problem = await vscode.window.showInputBox({ prompt: 'Describe a complex multi-step problem' });
    if (!problem || !runtime) return;

    const result = await runtime.adaptiveReasoning(problem, 'deep');
    out.appendLine(result.summary);
    out.show(true);
  });

  register('thinkcoffee.reasoning.adaptiveThink', async () => {
    const topic = await vscode.window.showInputBox({ prompt: 'Topic for adaptive deep reasoning' });
    if (!topic || !runtime) return;

    const result = await runtime.adaptiveReasoning(topic, 'deep');
    out.appendLine(result.summary);
    out.show(true);
  });

  register('thinkcoffee.workflow.createComplex', async () => {
    if (!runtime) return;
    const name = await vscode.window.showInputBox({ prompt: 'Workflow name' });
    if (!name) return;

    const goal = await vscode.window.showInputBox({ prompt: 'Workflow goal' });
    if (!goal) return;

    const raw = await vscode.window.showInputBox({ prompt: 'Step titles (comma-separated)' });
    if (!raw) return;

    const steps = raw.split(',').map(s => s.trim()).filter(Boolean);

    const remote = getOrchestratorClient();
    if (remote) {
      const workspaceId = await getWorkspaceId();
      if (!workspaceId) {
        vscode.window.showWarningMessage('Set thinkcoffee.orchestrator.workspaceId or open a folder-based workspace.');
        return;
      }

      try {
        const planResponse = await remote.createPlan({
          workspaceId,
          objective: `${name}: ${goal}`,
          constraints: steps,
          availableModalities: ['text'],
          priority: 'normal',
        });

        const planId = planResponse.data?.plan?.id || planResponse.data?.id;
        if (!planResponse.success || !planId) {
          throw new Error(planResponse.error?.message || 'Unable to create orchestrator plan');
        }

        await context.workspaceState.update(PLAN_ID_KEY, planId);
        await context.workspaceState.update(WORKSPACE_ID_KEY, workspaceId);
        vscode.window.showInformationMessage(`Orchestrator plan created: ${planId}`);
        return;
      } catch (error) {
        vscode.window.showWarningMessage(
          `Remote orchestrator is unavailable. Using local workflow fallback. ${toOrchestratorUserMessage(error)}`,
        );
      }
    }

    const workflow = runtime.createWorkflow(name, goal, steps);
    await context.workspaceState.update('thinkcoffee.currentWorkflow', workflow);
    vscode.window.showInformationMessage(`Workflow ${workflow.name} created with ${workflow.steps.length} steps.`);
  });

  register('thinkcoffee.workflow.executeAutonomous', async () => {
    const remote = getOrchestratorClient();
    const planId = context.workspaceState.get<string>(PLAN_ID_KEY);
    const workspaceId = context.workspaceState.get<string>(WORKSPACE_ID_KEY) || await getWorkspaceId();

    if (remote && planId && workspaceId) {
      try {
        const runResponse = await remote.startRun(workspaceId, planId);
        const runId = runResponse.data?.id;
        if (!runResponse.success || !runId) {
          throw new Error(runResponse.error?.message || 'Unable to start orchestrator run');
        }

        await context.workspaceState.update(RUN_ID_KEY, runId);

        const runStatus = await remote.getRun(runId);
        const checkpoints = await remote.getCheckpoints(runId);
        runtime?.getOutput().appendLine(`[orchestrator] run=${runId} status=${runStatus.data?.status || 'unknown'}`);
        runtime?.getOutput().appendLine(`[orchestrator] checkpoints=${(checkpoints.data || []).length}`);
        runtime?.getOutput().show(true);

        vscode.window.showInformationMessage(`Autonomous orchestrator run started: ${runId}`);
        return;
      } catch (error) {
        vscode.window.showWarningMessage(
          `Remote orchestrator execution failed. Falling back to local runtime. ${toOrchestratorUserMessage(error)}`,
        );
      }
    }

    const stored = context.workspaceState.get<WorkflowDefinition>('thinkcoffee.currentWorkflow');

    if (!stored || !runtime) {
      vscode.window.showWarningMessage('No workflow found. Create one first.');
      return;
    }

    const existing = runtime.getWorkflowState(stored.id);
    let resumeFromStep = 0;
    if (existing && existing.status !== 'completed' && existing.currentStepIndex > 0) {
      const pick = await vscode.window.showQuickPick(
        [
          {
            label: 'Resume from checkpoint',
            description: `Continue at step ${existing.currentStepIndex + 1}`,
            value: 'resume',
          },
          {
            label: 'Restart workflow',
            description: 'Discard previous checkpoint and run from step 1',
            value: 'restart',
          },
        ],
        { placeHolder: 'A previous workflow execution state was found' },
      );

      if (!pick) return;
      if (pick.value === 'resume') {
        resumeFromStep = existing.currentStepIndex;
      } else {
        await runtime.clearWorkflowState(stored.id);
      }
    }

    const state = await runtime.executeWorkflow(stored, async step => {
      runtime!.getOutput().appendLine(`[workflow] ${step.title}`);
      const reasoning = await runtime!.adaptiveReasoning(`${stored.goal} :: ${step.title}`, 'standard');
      return {
        summary: reasoning.summary,
        confidence: reasoning.confidence,
      };
    }, {
      resumeFromStepIndex: resumeFromStep,
    });

    runtime.getOutput().appendLine('[workflow] Artifacts');
    for (const artifact of state.artifacts) {
      runtime.getOutput().appendLine(`- ${artifact.stepTitle}: ${artifact.summary}`);
    }
    runtime.getOutput().show(true);

    if (state.status === 'completed') {
      vscode.window.showInformationMessage('Autonomous workflow execution completed.');
    } else if (state.status === 'cancelled') {
      vscode.window.showWarningMessage('Autonomous workflow execution cancelled.');
    } else {
      vscode.window.showErrorMessage('Autonomous workflow execution failed. Check output for details.');
    }
  });

  register('thinkcoffee.orchestrator.showRunStatus', async () => {
    const remote = getOrchestratorClient();
    if (!remote) {
      vscode.window.showWarningMessage('Configure thinkcoffee.orchestrator.baseUrl to use remote run management.');
      return;
    }

    const runId = await resolveRunId(context, remote);
    if (!runId) return;

    try {
      const run = await remote.getRun(runId);
      if (!run.success || !run.data) {
        vscode.window.showWarningMessage(run.error?.message || 'Could not fetch orchestrator run status.');
        return;
      }

      await context.workspaceState.update(RUN_ID_KEY, runId);
      const text = [
        '# Orchestrator Run Status',
        '',
        `- Run ID: ${runId}`,
        `- Status: ${run.data.status || 'unknown'}`,
        `- Current Step: ${run.data.currentStep ?? 'n/a'}`,
        `- Completed At: ${run.data.completedAt || 'n/a'}`,
      ].join('\n');
      const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: text });
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to fetch run status. ${toOrchestratorUserMessage(error)}`);
    }
  });

  register('thinkcoffee.orchestrator.showCheckpoints', async () => {
    const remote = getOrchestratorClient();
    if (!remote) {
      vscode.window.showWarningMessage('Configure thinkcoffee.orchestrator.baseUrl to use remote run management.');
      return;
    }

    const runId = await resolveRunId(context, remote);
    if (!runId) return;

    try {
      const response = await remote.getCheckpoints(runId);
      if (!response.success) {
        vscode.window.showWarningMessage(response.error?.message || 'Could not fetch checkpoints.');
        return;
      }

      const checkpoints = response.data || [];
      const lines = checkpoints.length === 0
        ? ['- No checkpoints recorded yet.']
        : checkpoints.map((cp, idx) => `- ${idx + 1}. ${JSON.stringify(cp)}`);
      const doc = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: ['# Orchestrator Checkpoints', '', `Run: ${runId}`, '', ...lines].join('\n'),
      });
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to fetch checkpoints. ${toOrchestratorUserMessage(error)}`);
    }
  });

  register('thinkcoffee.orchestrator.pauseRun', async () => {
    const remote = getOrchestratorClient();
    if (!remote) {
      vscode.window.showWarningMessage('Configure thinkcoffee.orchestrator.baseUrl to use remote run management.');
      return;
    }

    const runId = await resolveRunId(context, remote);
    if (!runId) return;

    try {
      const response = await remote.pauseRun(runId);
      if (!response.success) {
        vscode.window.showWarningMessage(response.error?.message || 'Could not pause orchestrator run.');
        return;
      }
      await context.workspaceState.update(RUN_ID_KEY, runId);
      vscode.window.showInformationMessage(`Run ${runId} paused.`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to pause run. ${toOrchestratorUserMessage(error)}`);
    }
  });

  register('thinkcoffee.orchestrator.resumeRun', async () => {
    const remote = getOrchestratorClient();
    if (!remote) {
      vscode.window.showWarningMessage('Configure thinkcoffee.orchestrator.baseUrl to use remote run management.');
      return;
    }

    const runId = await resolveRunId(context, remote);
    if (!runId) return;

    try {
      const response = await remote.resumeRun(runId);
      if (!response.success) {
        vscode.window.showWarningMessage(response.error?.message || 'Could not resume orchestrator run.');
        return;
      }
      await context.workspaceState.update(RUN_ID_KEY, runId);
      vscode.window.showInformationMessage(`Run ${runId} resumed.`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to resume run. ${toOrchestratorUserMessage(error)}`);
    }
  });

  register('thinkcoffee.orchestrator.selectRun', async () => {
    const remote = getOrchestratorClient();
    if (!remote) {
      vscode.window.showWarningMessage('Configure thinkcoffee.orchestrator.baseUrl to use remote run management.');
      return;
    }

    const workspaceId = context.workspaceState.get<string>(WORKSPACE_ID_KEY) || await getWorkspaceId();
    if (!workspaceId) {
      vscode.window.showWarningMessage('Set thinkcoffee.orchestrator.workspaceId or open a folder-based workspace.');
      return;
    }

    try {
      const runs = await remote.listRuns(workspaceId);
      const options = (runs.data || []).map(run => ({
        label: run.id,
        description: `status=${run.status || 'unknown'} step=${run.currentStep ?? 'n/a'}`,
      }));

      if (options.length === 0) {
        vscode.window.showInformationMessage('No remote runs found for this workspace.');
        return;
      }

      const pick = await vscode.window.showQuickPick(options, { placeHolder: 'Select orchestrator run' });
      if (!pick) return;

      await context.workspaceState.update(RUN_ID_KEY, pick.label);
      await context.workspaceState.update(WORKSPACE_ID_KEY, workspaceId);
      vscode.window.showInformationMessage(`Selected run ${pick.label}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to list runs. ${toOrchestratorUserMessage(error)}`);
    }
  });

  register('thinkcoffee.stopAgents', async () => {
    if (!runtime) return;
    const canceled = runtime.cancelAllRuns();
    vscode.window.showInformationMessage(`Stopped ${canceled} running task(s).`);
  });

  register('thinkcoffee.runPhase', async () => {
    await vscode.commands.executeCommand('thinkcoffee.workflow.executeAutonomous');
  });

  register('thinkcoffee.invokeAgent', async () => {
    const action = await vscode.window.showQuickPick(
      [
        'adaptive-reasoning',
        'multi-step-workflow',
        'security-defense-analysis',
        'multimodal-synthesis',
        'restriction-boundary-test-plan',
      ],
      { placeHolder: 'Select autonomous capability' },
    );
    if (!action || !runtime) return;

    if (action === 'restriction-boundary-test-plan') {
      vscode.window.showWarningMessage(
        'Restriction evasion is not executed by this extension. Only controlled defensive boundary test plans are supported.',
      );
      return;
    }

    const result = await runtime.adaptiveReasoning(`Run capability: ${action}`, 'standard');
    runtime.getOutput().appendLine(result.summary);
    runtime.getOutput().show(true);
  });

  const placeholders = [
    'thinkcoffee.refreshProjects',
    'thinkcoffee.createProject',
    'thinkcoffee.addContext',
    'thinkcoffee.addFileAsContext',
    'thinkcoffee.addSelectionAsContext',
    'thinkcoffee.addStructureAsContext',
    'thinkcoffee.addDecision',
    'thinkcoffee.syncContext',
    'thinkcoffee.exportContext',
    'thinkcoffee.openContextFile',
    'thinkcoffee.viewContext',
    'thinkcoffee.openChat',
    'thinkcoffee.createPipeline',
    'thinkcoffee.approvePhase',
    'thinkcoffee.rejectPhase',
    'thinkcoffee.viewTaskOutput',
    'thinkcoffee.refreshPipeline',
    'thinkcoffee.openOtherProject',
    'thinkcoffee.configureAgentModels',
    'thinkcoffee.viewAgentModels',
    'thinkcoffee.showHistory',
    'thinkcoffee.backupHistory',
    'thinkcoffee.restoreHistory',
    'thinkcoffee.exportHistory',
    'thinkcoffee.toggleDryRun',
    'thinkcoffee.openSafetyNet',
    'thinkcoffee.rollback',
    'thinkcoffee.listSnapshots',
    'thinkcoffee.cleanupSnapshots',
    'thinkcoffee.history.refresh',
  ];

  for (const command of placeholders) {
    register(command, () => {
      vscode.window.showInformationMessage(`Command ${command} is available as a placeholder in this implementation phase.`);
    });
  }
}

export function deactivate(): void {
  if (runtime) {
    runtime.cancelAllRuns();
  }
}

function getOrchestratorClient(): OrchestratorClient | undefined {
  const cfg = vscode.workspace.getConfiguration('thinkcoffee.orchestrator');
  const baseUrl = cfg.get<string>('baseUrl') || '';
  const token = cfg.get<string>('token') || '';
  if (!baseUrl) return undefined;
  return new OrchestratorClient({ baseUrl, token: token || undefined });
}

function toOrchestratorUserMessage(error: unknown): string {
  if (error instanceof OrchestratorHttpError) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return 'Authentication failed. Check thinkcoffee.orchestrator.token.';
    }
    if (error.statusCode === 404) {
      return 'Endpoint not found. Verify thinkcoffee.orchestrator.baseUrl points to the API root.';
    }
    if (error.statusCode >= 500) {
      return 'Server error from orchestrator API.';
    }
    return `Request failed with HTTP ${error.statusCode}.`;
  }
  if (error instanceof Error && /timeout/i.test(error.message)) {
    return 'Request timed out while contacting orchestrator API.';
  }
  if (error instanceof Error && /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(error.message)) {
    return 'Unable to reach orchestrator API. Check base URL and network connectivity.';
  }
  return error instanceof Error ? error.message : String(error);
}

async function resolveRunId(
  context: vscode.ExtensionContext,
  remote: OrchestratorClient,
): Promise<string | undefined> {
  const current = context.workspaceState.get<string>(RUN_ID_KEY);
  if (current) {
    return current;
  }

  const workspaceId = context.workspaceState.get<string>(WORKSPACE_ID_KEY) || await getWorkspaceId();
  if (!workspaceId) {
    const direct = await vscode.window.showInputBox({ prompt: 'Run ID' });
    return direct?.trim() || undefined;
  }

  try {
    const runs = await remote.listRuns(workspaceId);
    const options = (runs.data || []).map(run => ({
      label: run.id,
      description: `status=${run.status || 'unknown'} step=${run.currentStep ?? 'n/a'}`,
    }));
    if (options.length === 0) {
      const direct = await vscode.window.showInputBox({ prompt: 'Run ID' });
      return direct?.trim() || undefined;
    }
    const pick = await vscode.window.showQuickPick(options, {
      placeHolder: 'Select orchestrator run',
    });
    return pick?.label;
  } catch {
    const direct = await vscode.window.showInputBox({ prompt: 'Run ID' });
    return direct?.trim() || undefined;
  }
}

async function getWorkspaceId(): Promise<string | undefined> {
  const cfg = vscode.workspace.getConfiguration('thinkcoffee.orchestrator');
  const explicit = cfg.get<string>('workspaceId');
  if (explicit && explicit.trim()) {
    return explicit.trim();
  }

  const folderName = vscode.workspace.workspaceFolders?.[0]?.name;
  if (!folderName) return undefined;
  return folderName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

// === HELPER FUNCTIONS FOR RESULT DISPLAY ===

async function showReasoningResult(
  title: string,
  result: { summary: string; steps: string[]; confidence: number }
): Promise<void> {
  const text = [
    `# ${title}`,
    '',
    `**Confianca**: ${(result.confidence * 100).toFixed(1)}%`,
    '',
    '## Sintese',
    result.summary,
    '',
    '## Etapas',
    ...result.steps.map(s => `- ${s}`),
  ].join('\n');

  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: text });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}

async function showSecurityResult(
  title: string,
  result: {
    findings: Array<{ file: string; severity: string; title: string; detail: string }>;
    attackSimulationPlan: string[];
    exploitChainHypotheses: string[];
    defensiveRecommendations: string[];
  }
): Promise<void> {
  const text = [
    `# ${title}`,
    '',
    '## Findings',
    ...(result.findings.length === 0
      ? ['- Nenhum finding detectado com heuristicas atuais.']
      : result.findings.map(f => `- [${f.severity.toUpperCase()}] ${f.file}: ${f.title} -> ${f.detail}`)),
    '',
    '## Plano de Simulacao de Ataque (Controlado)',
    ...result.attackSimulationPlan.map(i => `- ${i}`),
    '',
    '## Hipoteses de Cadeia de Exploits',
    ...result.exploitChainHypotheses.map(i => `- ${i}`),
    '',
    '## Recomendacoes Defensivas',
    ...result.defensiveRecommendations.map(i => `- ${i}`),
  ].join('\n');

  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: text });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}

async function requireControlledModeConfirmation(): Promise<boolean> {
  const msg = 'Este recurso realiza testes defensivos de seguranca em modo controlado. Continuar?';
  const reply = await vscode.window.showWarningMessage(
    msg,
    { modal: true },
    'Continuar (Modo Defensivo)',
    'Cancelar'
  );
  return reply === 'Continuar (Modo Defensivo)';
}
