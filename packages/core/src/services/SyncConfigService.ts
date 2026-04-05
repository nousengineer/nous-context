import { DataSource, Repository } from 'typeorm';
import { SyncConfig, SyncTarget, SyncTrigger } from '../entities/SyncConfig';
import { Project } from '../entities/Project';
import { exportProject, getExportFilename, ExportFormat } from '../export';
import fs from 'fs';
import path from 'path';

export interface CreateSyncConfigInput {
  projectId: string;
  target: SyncTarget;
  trigger?: SyncTrigger;
  cronSchedule?: string | null;
  workspacePath: string;
  customOutputPath?: string | null;
  enabled?: boolean;
}

export interface UpdateSyncConfigInput {
  trigger?: SyncTrigger;
  cronSchedule?: string | null;
  workspacePath?: string;
  customOutputPath?: string | null;
  enabled?: boolean;
}

export interface SyncResult {
  success: boolean;
  syncConfigId: string;
  target: SyncTarget;
  outputPath: string;
  error?: string;
  syncedAt: Date;
}

export class SyncConfigService {
  private repo: Repository<SyncConfig>;
  private projectRepo: Repository<Project>;

  constructor(private db: DataSource) {
    this.repo = db.getRepository(SyncConfig);
    this.projectRepo = db.getRepository(Project);
  }

  async list(projectId?: string): Promise<SyncConfig[]> {
    const where = projectId ? { projectId } : {};
    return this.repo.find({
      where,
      relations: ['project'],
      order: { createdAt: 'DESC' },
    });
  }

  async get(id: string): Promise<SyncConfig | null> {
    return this.repo.findOne({
      where: { id },
      relations: ['project'],
    });
  }

  async getByProjectAndTarget(projectId: string, target: SyncTarget): Promise<SyncConfig | null> {
    return this.repo.findOne({
      where: { projectId, target },
      relations: ['project'],
    });
  }

  async getEnabledByProject(projectId: string): Promise<SyncConfig[]> {
    return this.repo.find({
      where: { projectId, enabled: true },
      relations: ['project'],
    });
  }

  async getScheduled(): Promise<SyncConfig[]> {
    return this.repo.find({
      where: { trigger: 'scheduled', enabled: true },
      relations: ['project'],
    });
  }

  async getOnChange(): Promise<SyncConfig[]> {
    return this.repo.find({
      where: { trigger: 'on-change', enabled: true },
      relations: ['project'],
    });
  }

  async create(input: CreateSyncConfigInput): Promise<SyncConfig> {
    const project = await this.projectRepo.findOne({ where: { id: input.projectId } });
    if (!project) {
      throw new Error('Project not found: ' + input.projectId);
    }

    const existing = await this.getByProjectAndTarget(input.projectId, input.target);
    if (existing) {
      throw new Error('Sync config already exists for project ' + input.projectId + ' and target ' + input.target);
    }

    if (input.trigger === 'scheduled' && !input.cronSchedule) {
      throw new Error('cronSchedule is required when trigger is scheduled');
    }

    if (!fs.existsSync(input.workspacePath)) {
      throw new Error('Workspace path does not exist: ' + input.workspacePath);
    }

    const config = this.repo.create({
      ...input,
      trigger: input.trigger || 'manual',
      enabled: input.enabled ?? true,
      lastSyncStatus: 'pending',
      failureCount: 0,
    });

    return this.repo.save(config);
  }

  async update(id: string, input: UpdateSyncConfigInput): Promise<SyncConfig> {
    const config = await this.get(id);
    if (!config) {
      throw new Error('SyncConfig not found: ' + id);
    }

    if (input.trigger === 'scheduled' && !input.cronSchedule && !config.cronSchedule) {
      throw new Error('cronSchedule is required when trigger is scheduled');
    }

    if (input.workspacePath && !fs.existsSync(input.workspacePath)) {
      throw new Error('Workspace path does not exist: ' + input.workspacePath);
    }

    Object.assign(config, input);
    return this.repo.save(config);
  }

  async delete(id: string): Promise<boolean> {
    const config = await this.get(id);
    if (!config) {
      throw new Error('SyncConfig not found: ' + id);
    }
    await this.repo.remove(config);
    return true;
  }

  async executeSync(id: string): Promise<SyncResult> {
    const config = await this.get(id);
    if (!config) {
      throw new Error('SyncConfig not found: ' + id);
    }
    return this.executeSyncForConfig(config);
  }

  async executeSyncForConfig(config: SyncConfig): Promise<SyncResult> {
    const syncedAt = new Date();

    try {
      const project = await this.projectRepo.findOne({
        where: { id: config.projectId },
        relations: ['contextEntries', 'decisions'],
      });

      if (!project) {
        throw new Error('Project not found: ' + config.projectId);
      }

      const format = config.target as ExportFormat;
      const content = exportProject(project, format);

      const outputPath = config.customOutputPath
        || path.join(config.workspacePath, getExportFilename(format, project.name));

      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(outputPath, content, 'utf-8');

      config.lastSyncAt = syncedAt;
      config.lastSyncStatus = 'success';
      config.lastSyncError = null;
      config.failureCount = 0;
      await this.repo.save(config);

      return {
        success: true,
        syncConfigId: config.id,
        target: config.target,
        outputPath,
        syncedAt,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      config.lastSyncAt = syncedAt;
      config.lastSyncStatus = 'failed';
      config.lastSyncError = errorMessage;
      config.failureCount = (config.failureCount || 0) + 1;
      await this.repo.save(config);

      return {
        success: false,
        syncConfigId: config.id,
        target: config.target,
        outputPath: config.customOutputPath || '',
        error: errorMessage,
        syncedAt,
      };
    }
  }

  async markSyncSuccess(id: string): Promise<void> {
    const config = await this.get(id);
    if (!config) {
      throw new Error('SyncConfig not found: ' + id);
    }
    config.lastSyncStatus = 'success';
    config.lastSyncError = null;
    config.failureCount = 0;
    config.lastSyncAt = new Date();
    await this.repo.save(config);
  }

  async markSyncFailure(id: string, error: string): Promise<void> {
    const config = await this.get(id);
    if (!config) {
      throw new Error('SyncConfig not found: ' + id);
    }
    config.lastSyncStatus = 'failed';
    config.lastSyncError = error;
    config.failureCount = (config.failureCount || 0) + 1;
    config.lastSyncAt = new Date();
    await this.repo.save(config);
  }

  async syncProject(projectId: string): Promise<SyncResult[]> {
    const configs = await this.getEnabledByProject(projectId);
    const results: SyncResult[] = [];
    for (const config of configs) {
      const result = await this.executeSyncForConfig(config);
      results.push(result);
    }
    return results;
  }

  async syncByTrigger(trigger: SyncTrigger): Promise<SyncResult[]> {
    const configs = await this.repo.find({
      where: { trigger, enabled: true },
      relations: ['project'],
    });
    const results: SyncResult[] = [];
    for (const config of configs) {
      const result = await this.executeSyncForConfig(config);
      results.push(result);
    }
    return results;
  }

  async quickSetup(
    projectId: string,
    workspacePath: string,
    trigger: SyncTrigger = 'on-change',
    targets: SyncTarget[] = ['copilot', 'claude', 'cursor']
  ): Promise<SyncConfig[]> {
    const created: SyncConfig[] = [];
    for (const target of targets) {
      try {
        const config = await this.create({ projectId, target, trigger, workspacePath });
        created.push(config);
      } catch (error) {
        const existing = await this.getByProjectAndTarget(projectId, target);
        if (existing) created.push(existing);
      }
    }
    return created;
  }
}