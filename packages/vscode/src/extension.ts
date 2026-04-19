import * as vscode from 'vscode';
import { AutonomousRuntime } from './agents/AutonomousRuntime';
import type { WorkflowDefinition } from './agents/AutonomousRuntime';
import { OrchestratorClient, OrchestratorHttpError } from './utils/orchestratorClient';
import { ChatSidebarProvider } from './views';

let runtime: AutonomousRuntime | undefined;
const RUN_ID_KEY = 'thinkcoffee.currentOrchestratorRunId';
const PLAN_ID_KEY = 'thinkcoffee.currentOrchestratorPlanId';
const WORKSPACE_ID_KEY = 'thinkcoffee.currentOrchestratorWorkspaceId';
type PmDelegateMode = 'create-workflow' | 'resume-run' | 'pause-run' | 'show-run' | 'toggle-dry-run' | 'safety-scan' | 'stop-runs';
interface PmDelegatedCommand {
  command: string;
  goal: string;
  ask?: string;
  delegate?: PmDelegateMode;
}

interface ChatImageAttachment {
  name: string;
  mimeType: string;
  dataUrl: string;
}

interface ChatAskPayload {
  type?: string;
  prompt?: string;
  includeActiveEditor?: boolean;
  images?: ChatImageAttachment[];
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  runtime = new AutonomousRuntime(context);
  const out = runtime.getOutput();
  out.appendLine('[ThinkCoffee] Extension activated');
  const chatProvider = new ChatSidebarProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatSidebarProvider.viewType, chatProvider),
  );

  const register = (command: string, handler: (...args: unknown[]) => unknown) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  };

  register('thinkcoffee.chat.ask', async (promptArg?: unknown) => {
    out.appendLine('[thinkcoffee.chat.ask] Command received');
    console.log('[thinkcoffee.chat.ask] Raw payload:', promptArg);

    if (!runtime) {
      out.appendLine('[thinkcoffee.chat.ask] Runtime not available');
      chatProvider.postError('PM runtime not available');
      return;
    }

    const payload = normalizeChatPayload(promptArg);
    out.appendLine(`[thinkcoffee.chat.ask] Normalized payload: prompt="${payload.prompt.slice(0, 50)}...", includeEditor=${payload.includeActiveEditor}, images=${payload.images.length}`);

    if (!payload.prompt && !payload.includeActiveEditor && payload.images.length === 0) {
      out.appendLine('[thinkcoffee.chat.ask] No content to process, skipping');
      return;
    }

    chatProvider.postStatus('PM is analyzing request...');

    const editorContext = payload.includeActiveEditor ? buildActiveEditorContext() : undefined;

    const imageContext = payload.images.length > 0
      ? payload.images.map((image, index) => {
        const dataPreview = image.dataUrl.slice(0, 8000);
        return [
          `Image ${index + 1}: ${image.name} (${image.mimeType})`,
          `Data URL preview: ${dataPreview}`,
        ].join('\n');
      }).join('\n\n')
      : undefined;

    try {
      const summary = await runtime.runLongTask('ThinkCoffee PM chat request', async (_progress, _token) => {
        return runtime!.adaptiveReasoning(
          [
            'PM chat request from sidebar composer.',
            `User prompt: ${payload.prompt || 'none'}`,
            editorContext ? `Attached active editor context:\n${editorContext}` : 'Attached active editor context: none',
            imageContext ? `Attached pasted images:\n${imageContext}` : 'Attached pasted images: none',
            'Decide whether to use single-agent or multi-agent internally and provide concise next action.',
          ].join('\n'),
          'standard',
        );
      });
      if (!summary) {
        chatProvider.postError('PM request was canceled.');
        return;
      }

      out.appendLine(`[pm:chat] ${summary.summary}`);
      chatProvider.postAssistant(summary.summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      out.appendLine(`[pm:chat:error] ${message}`);
      chatProvider.postError(`PM failed to process request: ${message}`);
    }
  });

  register('thinkcoffee.advancedSoftware.generateCode', async () => {
    const prompt = await vscode.window.showInputBox({ prompt: 'Describe the code you need' });
    if (!prompt || !runtime) return;

    const language = await vscode.window.showQuickPick(['typescript', 'javascript', 'python'], {
      placeHolder: 'Target language',
    });
    if (!language) return;

    const result = await runtime.runLongTask('ThinkCoffee: advanced code generation', async (_progress, _token) => {
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
    const result = await runtime.runLongTask('ThinkCoffee: automatic debug analysis', async (_progress, _token) => {
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
    const result = await runtime.runLongTask('ThinkCoffee: code refactoring', async (_progress, _token) => {
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

    const result = await runtime.runLongTask('ThinkCoffee: defensive security scan', async (_progress, _token) => {
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

  const pmDelegated: PmDelegatedCommand[] = [
    { command: 'thinkcoffee.refreshProjects', goal: 'Refresh project context graph and dependencies' },
    { command: 'thinkcoffee.createProject', goal: 'Create a new project context and baseline plan', ask: 'Project name or objective' },
    { command: 'thinkcoffee.addContext', goal: 'Add context entry for PM planning', ask: 'Context to add' },
    { command: 'thinkcoffee.addFileAsContext', goal: 'Summarize selected file as context for PM and agents' },
    { command: 'thinkcoffee.addSelectionAsContext', goal: 'Summarize editor selection as context for PM and agents' },
    { command: 'thinkcoffee.addStructureAsContext', goal: 'Capture workspace structure as context for PM and agents' },
    { command: 'thinkcoffee.addDecision', goal: 'Record a technical decision with rationale', ask: 'Decision statement' },
    { command: 'thinkcoffee.syncContext', goal: 'Sync managed context to configured AI tools' },
    { command: 'thinkcoffee.exportContext', goal: 'Export consolidated context package' },
    { command: 'thinkcoffee.openContextFile', goal: 'Open context artifact selected by PM' },
    { command: 'thinkcoffee.viewContext', goal: 'Inspect a context entry and decision links' },
    { command: 'thinkcoffee.openChat', goal: 'Open PM chat session and route next actions' },
    { command: 'thinkcoffee.createPipeline', goal: 'Create phased delivery pipeline', delegate: 'create-workflow' },
    { command: 'thinkcoffee.approvePhase', goal: 'Approve current phase and move to next', delegate: 'resume-run' },
    { command: 'thinkcoffee.rejectPhase', goal: 'Reject current phase and pause for rework', delegate: 'pause-run' },
    { command: 'thinkcoffee.viewTaskOutput', goal: 'Show output from latest delegated PM task' },
    { command: 'thinkcoffee.refreshPipeline', goal: 'Refresh pipeline execution status', delegate: 'show-run' },
    { command: 'thinkcoffee.openOtherProject', goal: 'Switch PM context to another project', ask: 'Project identifier' },
    { command: 'thinkcoffee.configureAgentModels', goal: 'Configure model strategy by role and budget' },
    { command: 'thinkcoffee.viewAgentModels', goal: 'Display active model assignments by role' },
    { command: 'thinkcoffee.toggleDryRun', goal: 'Toggle PM dry-run mode without applying changes', delegate: 'toggle-dry-run' },
    { command: 'thinkcoffee.openSafetyNet', goal: 'Run safety-net checks and defensive scan', delegate: 'safety-scan' },
    { command: 'thinkcoffee.rollback', goal: 'Rollback current phase to previous stable checkpoint', delegate: 'stop-runs' },
    { command: 'thinkcoffee.listSnapshots', goal: 'List snapshots available for rollback' },
    { command: 'thinkcoffee.cleanupSnapshots', goal: 'Cleanup stale snapshots based on retention policy' },
  ];

  const delegateToPm = async (
    command: string,
    goal: string,
    ask?: string,
    delegate?: PmDelegateMode,
  ): Promise<void> => {
    if (!runtime) return;

    if (delegate === 'create-workflow') {
      await vscode.commands.executeCommand('thinkcoffee.workflow.createComplex');
      return;
    }
    if (delegate === 'resume-run') {
      await vscode.commands.executeCommand('thinkcoffee.orchestrator.resumeRun');
      return;
    }
    if (delegate === 'pause-run') {
      await vscode.commands.executeCommand('thinkcoffee.orchestrator.pauseRun');
      return;
    }
    if (delegate === 'show-run') {
      await vscode.commands.executeCommand('thinkcoffee.orchestrator.showRunStatus');
      return;
    }
    if (delegate === 'safety-scan') {
      await vscode.commands.executeCommand('thinkcoffee.advancedSecurity.scanVulnerabilities');
      return;
    }
    if (delegate === 'stop-runs') {
      await vscode.commands.executeCommand('thinkcoffee.stopAgents');
      return;
    }
    if (delegate === 'toggle-dry-run') {
      const key = 'thinkcoffee.pmDryRun';
      const current = context.workspaceState.get<boolean>(key) ?? true;
      const next = !current;
      await context.workspaceState.update(key, next);
      vscode.window.showInformationMessage(`ThinkCoffee PM dry-run: ${next ? 'ON' : 'OFF'}`);
      return;
    }

    const mode = await vscode.window.showQuickPick(['single-agent', 'multi-agent'], {
      placeHolder: 'PM delegation mode',
    });
    if (!mode) return;

    const detail = ask
      ? await vscode.window.showInputBox({ prompt: ask, placeHolder: 'Optional details to refine PM orchestration' })
      : undefined;

    const summary = await runtime.runLongTask(`ThinkCoffee PM delegation: ${command}`, async (_progress, _token) => {
      return runtime!.adaptiveReasoning(
        [
          `PM command: ${command}`,
          `Goal: ${goal}`,
          `Delegation mode: ${mode}`,
          `Details: ${detail?.trim() || 'none'}`,
          'Return concise execution summary and the next recommended action.',
        ].join('\n'),
        mode === 'multi-agent' ? 'deep' : 'standard',
      );
    });
    if (!summary) return;

    out.appendLine(`[pm:${command}] ${summary.summary}`);
    out.show(true);
  };

  for (const item of pmDelegated) {
    register(item.command, async () => {
      await delegateToPm(item.command, item.goal, item.ask, item.delegate);
    });
  }
}

function normalizeChatPayload(input: unknown): { prompt: string; includeActiveEditor: boolean; images: ChatImageAttachment[] } {
  if (typeof input === 'string') {
    return {
      prompt: input.trim(),
      includeActiveEditor: false,
      images: [],
    };
  }

  if (!input || typeof input !== 'object') {
    return {
      prompt: '',
      includeActiveEditor: false,
      images: [],
    };
  }

  const candidate = input as ChatAskPayload;
  const prompt = typeof candidate.prompt === 'string' ? candidate.prompt.trim() : '';
  const includeActiveEditor = candidate.includeActiveEditor === true;
  const images = Array.isArray(candidate.images)
    ? candidate.images
      .filter((item): item is ChatImageAttachment => {
        return !!item
          && typeof item.name === 'string'
          && typeof item.mimeType === 'string'
          && typeof item.dataUrl === 'string';
      })
      .slice(0, 5)
    : [];

  return { prompt, includeActiveEditor, images };
}

function buildActiveEditorContext(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const document = editor.document;
  const fullText = document.getText();
  const content = fullText.length > 12000 ? `${fullText.slice(0, 12000)}\n... [truncated]` : fullText;

  return [
    `Path: ${document.uri.fsPath}`,
    `Language: ${document.languageId}`,
    'Content:',
    content,
  ].join('\n');
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
  const timeoutMs = cfg.get<number>('timeoutMs') || 30_000;
  if (!baseUrl) return undefined;
  return new OrchestratorClient({ baseUrl, token: token || undefined, timeoutMs });
}

function toOrchestratorUserMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
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
  if (code === 'ETIMEDOUT' || (error instanceof Error && /timeout/i.test(error.message))) {
    return 'Request timed out while contacting orchestrator API.';
  }
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    (error instanceof Error && /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(error.message))
  ) {
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
