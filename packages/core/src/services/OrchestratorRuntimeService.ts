import { DataSource, Repository } from 'typeorm';
import {
  AdaptiveOrchestratorService,
  OrchestratorPlan,
  OrchestratorPolicy,
  OrchestratorRequest,
  ContinuousOperationState,
} from './AdaptiveOrchestratorService';
import { OrchestratorPlanRecord } from '../entities/OrchestratorPlan';
import { OrchestratorRunRecord } from '../entities/OrchestratorRun';
import { PolicyDecisionAudit } from '../entities/PolicyDecisionAudit';
import { TaskService } from './TaskService';
import { WorkflowService } from './WorkflowService';
import { AgentService } from './AgentService';
import { ExecutionLogService } from './ExecutionLogService';
import type { TaskType } from '../entities/Task';

export interface CreateOrchestratorPlanInput {
  workspaceId: string;
  projectId?: string;
  createdByUserId?: string;
  request: OrchestratorRequest;
  policy?: Partial<OrchestratorPolicy>;
  policyApproval?: {
    approvedByUserId?: string;
    reason?: string;
    approvedTestScope?: string[];
  };
}

export interface StartOrchestratorRunInput {
  workspaceId: string;
  planId: string;
  requestedByUserId?: string;
  executionAgentId?: string;
  autoExecute?: boolean;
}

export class OrchestratorRuntimeService {
  private planRepo: Repository<OrchestratorPlanRecord>;
  private runRepo: Repository<OrchestratorRunRecord>;
  private auditRepo: Repository<PolicyDecisionAudit>;

  private orchestrator = new AdaptiveOrchestratorService();
  private tasks: TaskService;
  private workflows: WorkflowService;
  private agents: AgentService;
  private logs: ExecutionLogService;

  constructor(private db: DataSource) {
    this.planRepo = db.getRepository(OrchestratorPlanRecord);
    this.runRepo = db.getRepository(OrchestratorRunRecord);
    this.auditRepo = db.getRepository(PolicyDecisionAudit);

    this.tasks = new TaskService(db);
    this.workflows = new WorkflowService(db);
    this.agents = new AgentService(db);
    this.logs = new ExecutionLogService(db);
  }

  async createPlan(input: CreateOrchestratorPlanInput): Promise<{ plan: OrchestratorPlanRecord; warnings: string[] }> {
    const built = this.orchestrator.buildPlan(input.request);
    const evaluated = this.orchestrator.enforcePolicy(built, {
      ...(input.policy || {}),
      approvedTestScope: input.policyApproval?.approvedTestScope || input.policy?.approvedTestScope,
    });

    const persisted = this.planRepo.create({
      workspaceId: input.workspaceId,
      projectId: input.projectId || null,
      createdByUserId: input.createdByUserId || null,
      objective: input.request.objective,
      requestPayload: input.request as unknown as Record<string, any>,
      planPayload: evaluated.plan as unknown as Record<string, any>,
      complexityScore: evaluated.plan.complexityScore,
      reasoningMode: evaluated.plan.reasoningMode,
      status: 'ready',
    });

    const saved = await this.planRepo.save(persisted);

    await this.auditRepo.save(this.auditRepo.create({
      workspaceId: input.workspaceId,
      planId: saved.id,
      runId: null,
      requestedByUserId: input.createdByUserId || null,
      approvedByUserId: input.policyApproval?.approvedByUserId || null,
      mode: (input.policy?.mode || 'defensive') as 'defensive' | 'controlled-red-team',
      allowedCapabilities: this.extractAllowedCapabilities(evaluated.plan),
      blockedCapabilities: evaluated.blockedCapabilities,
      approvedTestScope: input.policyApproval?.approvedTestScope || input.policy?.approvedTestScope || null,
      decision: evaluated.blockedCapabilities.length > 0 ? 'auto-blocked' : 'approved',
      reason: input.policyApproval?.reason || (evaluated.warnings.join(' | ') || null),
    }));

    return { plan: saved, warnings: evaluated.warnings };
  }

  async getPlan(planId: string): Promise<OrchestratorPlanRecord | null> {
    return this.planRepo.findOne({ where: { id: planId } });
  }

  async listPlans(workspaceId: string): Promise<OrchestratorPlanRecord[]> {
    return this.planRepo.find({ where: { workspaceId }, order: { createdAt: 'DESC' } });
  }

  async startRun(input: StartOrchestratorRunInput): Promise<OrchestratorRunRecord> {
    const plan = await this.getPlan(input.planId);
    if (!plan || plan.workspaceId !== input.workspaceId) {
      throw new Error('Plan not found in workspace');
    }

    const typedPlan = plan.planPayload as unknown as OrchestratorPlan;
    const workflow = await this.workflows.create({
      workspaceId: input.workspaceId,
      name: `orchestrator-${plan.id.slice(0, 8)}`,
      description: `Workflow generated from adaptive orchestrator plan ${plan.id}`,
      steps: typedPlan.steps.map((step, idx) => ({
        id: step.id,
        name: step.title,
        description: step.goal,
        agentId: input.executionAgentId || 'system-agent',
        taskType: this.mapTaskType(step.capabilities),
        input: {
          stepId: step.id,
          capabilities: step.capabilities,
          reasoningMode: step.reasoningMode,
          timeoutMs: step.timeoutMs,
        },
        dependsOn: idx === 0 ? [] : [typedPlan.steps[idx - 1].id],
        timeout: step.timeoutMs,
      })),
      triggers: [{ type: 'manual', config: { origin: 'adaptive-orchestrator' } }],
    });

    const state = this.orchestrator.startContinuousOperation(typedPlan, {
      checkpointEverySteps: 1,
    });

    const run = await this.runRepo.save(this.runRepo.create({
      planId: plan.id,
      workspaceId: input.workspaceId,
      workflowId: workflow.id,
      executionAgentId: input.executionAgentId || null,
      requestedByUserId: input.requestedByUserId || null,
      status: 'running',
      currentStep: 0,
      checkpointEverySteps: state.checkpointEverySteps,
      maxRuntimeMs: state.maxRuntimeMs,
      statePayload: state as unknown as Record<string, any>,
      stepTaskMap: [],
      checkpoints: [],
      resumeCount: 0,
      failureReason: null,
      completedAt: null,
    }));

    if (input.autoExecute !== false) {
      await this.executeRun(run.id);
    }

    return (await this.getRun(run.id))!;
  }

  async getRun(runId: string): Promise<OrchestratorRunRecord | null> {
    return this.runRepo.findOne({ where: { id: runId } });
  }

  async listRuns(workspaceId: string, status?: string): Promise<OrchestratorRunRecord[]> {
    return this.runRepo.find({
      where: status ? ({ workspaceId, status } as any) : { workspaceId },
      order: { createdAt: 'DESC' },
    });
  }

  async pauseRun(runId: string): Promise<OrchestratorRunRecord> {
    const run = await this.getRun(runId);
    if (!run) throw new Error('Run not found');
    run.status = 'paused';
    run.statePayload = { ...run.statePayload, status: 'paused', lastHeartbeatAt: new Date().toISOString() };
    return this.runRepo.save(run);
  }

  async resumeRun(runId: string): Promise<OrchestratorRunRecord> {
    const run = await this.getRun(runId);
    if (!run) throw new Error('Run not found');
    run.status = 'running';
    run.resumeCount += 1;
    run.statePayload = { ...run.statePayload, status: 'running', lastHeartbeatAt: new Date().toISOString() };
    await this.runRepo.save(run);
    await this.executeRun(runId);
    return (await this.getRun(runId))!;
  }

  async executeRun(runId: string): Promise<OrchestratorRunRecord> {
    const run = await this.getRun(runId);
    if (!run) throw new Error('Run not found');
    if (run.status === 'completed') return run;

    const plan = await this.getPlan(run.planId);
    if (!plan) throw new Error('Plan not found for run');
    const typedPlan = plan.planPayload as unknown as OrchestratorPlan;

    const agentId = run.executionAgentId || await this.selectExecutionAgent(run.workspaceId);
    if (!agentId) throw new Error('No active agent available for orchestrated execution');

    try {
      for (let idx = run.currentStep; idx < typedPlan.steps.length; idx++) {
        if (run.status === 'paused') break;

        const step = typedPlan.steps[idx];
        const task = await this.tasks.create({
          workspaceId: run.workspaceId,
          agentId,
          type: this.mapTaskType(step.capabilities),
          description: `${step.title}: ${step.goal}`,
          input: {
            planId: plan.id,
            runId: run.id,
            stepId: step.id,
            dependsOn: step.dependsOn,
            capabilities: step.capabilities,
            reasoningMode: step.reasoningMode,
          },
        });

        await this.tasks.start(task.id);
        await this.logs.log({
          workspaceId: run.workspaceId,
          taskId: task.id,
          agentId,
          level: 'info',
          phase: 'execution',
          message: `Executing orchestrator step ${idx + 1}/${typedPlan.steps.length}`,
          data: { runId: run.id, planId: plan.id, stepId: step.id },
          status: 'running',
        });

        await this.tasks.complete(task.id, {
          status: 'executed',
          stepId: step.id,
          title: step.title,
          capabilities: step.capabilities,
        });

        const updatedState = this.orchestrator.applyStepFeedback(
          run.statePayload as unknown as ContinuousOperationState,
          { success: true, stepId: step.id, note: `Step ${step.title} completed` }
        );

        run.statePayload = updatedState as unknown as Record<string, any>;
        run.currentStep = idx + 1;
        run.stepTaskMap = [
          ...(run.stepTaskMap || []),
          { stepId: step.id, taskId: task.id, status: 'completed' },
        ];

        run.checkpoints = [
          ...(run.checkpoints || []),
          {
            step: run.currentStep,
            at: new Date().toISOString(),
            note: `Checkpoint after ${step.title}`,
            state: run.statePayload,
          },
        ];

        await this.runRepo.save(run);
      }

      if (run.currentStep >= typedPlan.steps.length) {
        run.status = 'completed';
        run.completedAt = new Date();
        run.statePayload = {
          ...run.statePayload,
          status: 'completed',
          lastHeartbeatAt: new Date().toISOString(),
        };

        if (run.workflowId) {
          await this.workflows.recordExecution(run.workflowId, {
            id: `exec-${run.id}`,
            startedAt: run.createdAt,
            completedAt: new Date(),
            status: 'completed',
            tasksRun: run.stepTaskMap.length,
            tasksFailed: 0,
          });
        }

        await this.runRepo.save(run);
      }

      return run;
    } catch (error: any) {
      run.status = 'failed';
      run.failureReason = error?.message || 'Unknown execution error';
      run.statePayload = {
        ...run.statePayload,
        status: 'failed',
        lastHeartbeatAt: new Date().toISOString(),
      };
      await this.runRepo.save(run);
      return run;
    }
  }

  async getCheckpoints(runId: string): Promise<Array<{ step: number; at: string; note: string; state: Record<string, any> }>> {
    const run = await this.getRun(runId);
    if (!run) throw new Error('Run not found');
    return run.checkpoints || [];
  }

  async listPolicyAudits(planId: string): Promise<PolicyDecisionAudit[]> {
    return this.auditRepo.find({ where: { planId }, order: { createdAt: 'ASC' } });
  }

  private extractAllowedCapabilities(plan: OrchestratorPlan): string[] {
    const allowed = new Set<string>();
    for (const step of plan.steps) {
      for (const capability of step.capabilities) {
        allowed.add(capability);
      }
    }
    return Array.from(allowed);
  }

  private mapTaskType(capabilities: string[]): TaskType {
    if (capabilities.includes('multimodal-analysis')) return 'multimodal-analysis';
    if (capabilities.includes('attack-simulation')) return 'attack-simulation';
    if (capabilities.includes('vulnerability-discovery')) return 'vulnerability-scan';
    if (capabilities.includes('advanced-code-generation')) return 'advanced-code-generation';
    if (capabilities.includes('auto-debugging')) return 'auto-debugging';
    if (capabilities.includes('advanced-scientific-analysis')) return 'scientific-analysis';
    return 'multi-step-problem-solving';
  }

  private async selectExecutionAgent(workspaceId: string): Promise<string | null> {
    const available = await this.agents.listByWorkspace(workspaceId, true);
    if (available.length === 0) return null;
    return available[0].id;
  }
}
