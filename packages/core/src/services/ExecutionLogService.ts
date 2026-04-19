import { DataSource, Repository } from 'typeorm';
import { ExecutionLog, ExecutionLogLevel, ExecutionPhase } from '../entities/ExecutionLog';

export interface CreateExecutionLogInput {
  workspaceId: string;
  taskId: string;
  agentId?: string;
  level: ExecutionLogLevel;
  phase: ExecutionPhase;
  message: string;
  data?: Record<string, any>;
  reasoning?: string;
  duration?: number;
  status?: string;
}

export class ExecutionLogService {
  private repo: Repository<ExecutionLog>;

  constructor(private db: DataSource) {
    this.repo = db.getRepository(ExecutionLog);
  }

  async log(input: CreateExecutionLogInput): Promise<ExecutionLog> {
    const log = this.repo.create(input);
    return this.repo.save(log);
  }

  async getTaskLogs(
    taskId: string,
    level?: ExecutionLogLevel,
    phase?: ExecutionPhase
  ): Promise<ExecutionLog[]> {
    return this.repo.find({
      where: level && phase
        ? { taskId, level, phase }
        : level
          ? { taskId, level }
          : phase
            ? { taskId, phase }
            : { taskId },
      order: { timestamp: 'ASC' },
    });
  }

  async getAgentLogs(
    agentId: string,
    limit: number = 100
  ): Promise<ExecutionLog[]> {
    return this.repo.find({
      where: { agentId },
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  async getWorkspaceLogs(
    workspaceId: string,
    level?: ExecutionLogLevel,
    limit: number = 100
  ): Promise<ExecutionLog[]> {
    return this.repo.find({
      where: level
        ? { workspaceId, level }
        : { workspaceId },
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  async getErrors(workspaceId: string, limit: number = 50): Promise<ExecutionLog[]> {
    return this.repo.find({
      where: { workspaceId, level: 'error' },
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  async getPhaseStats(taskId: string): Promise<Record<ExecutionPhase, number>> {
    const logs = await this.getTaskLogs(taskId);
    return {
      planning: logs.filter((l) => l.phase === 'planning').length,
      reasoning: logs.filter((l) => l.phase === 'reasoning').length,
      execution: logs.filter((l) => l.phase === 'execution').length,
      validation: logs.filter((l) => l.phase === 'validation').length,
      completion: logs.filter((l) => l.phase === 'completion').length,
    };
  }

  async getTotalDuration(taskId: string): Promise<number> {
    const logs = await this.getTaskLogs(taskId);
    return logs.reduce((sum, log) => sum + (log.duration || 0), 0);
  }

  async deleteOldLogs(olderThanDays: number): Promise<number> {
    const date = new Date();
    date.setDate(date.getDate() - olderThanDays);

    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .where('timestamp < :date', { date })
      .execute();

    return result.affected || 0;
  }
}
