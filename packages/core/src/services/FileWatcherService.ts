/**
 * FileWatcherService - Detecta mudancas em arquivos de contexto
 * 
 * Monitora o banco de dados ou arquivos de projeto e dispara syncs automaticos
 * quando detecta alteracoes nos context entries ou decisions.
 */

import { DataSource } from 'typeorm';
import { EventEmitter } from 'events';
import { AutoSyncService } from './AutoSyncService';
import { ContextEntry } from '../entities/ContextEntry';
import { Decision } from '../entities/Decision';
import { Project } from '../entities/Project';

export interface FileWatcherOptions {
  /** Polling interval in milliseconds (default: 5000 = 5 seconds) */
  pollIntervalMs?: number;
  /** Debounce time for triggering sync after change (default: 2000 = 2 seconds) */
  debounceMs?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

export interface ChangeEvent {
  projectId: string;
  projectName: string;
  changeType: 'context' | 'decision' | 'project';
  entityId: string;
  action: 'create' | 'update' | 'delete';
  timestamp: Date;
}

interface ProjectSnapshot {
  contextCount: number;
  decisionCount: number;
  lastContextUpdate: Date | null;
  lastDecisionUpdate: Date | null;
  projectUpdatedAt: Date;
}

/**
 * Monitora mudancas no banco de dados e dispara eventos para auto-sync
 */
export class FileWatcherService extends EventEmitter {
  private db: DataSource;
  private autoSyncService: AutoSyncService | null = null;
  private options: Required<FileWatcherOptions>;
  private isWatching = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private projectSnapshots: Map<string, ProjectSnapshot> = new Map();
  private pendingSyncs: Map<string, NodeJS.Timeout> = new Map();

  constructor(db: DataSource, options: FileWatcherOptions = {}) {
    super();
    this.db = db;
    this.options = {
      pollIntervalMs: options.pollIntervalMs ?? 5000,
      debounceMs: options.debounceMs ?? 2000,
      verbose: options.verbose ?? false,
    };
  }

  /**
   * Conecta com o AutoSyncService para disparar syncs automaticos
   */
  setAutoSyncService(autoSyncService: AutoSyncService): void {
    this.autoSyncService = autoSyncService;
  }

  /**
   * Inicia o monitoramento de mudancas
   */
  async start(): Promise<void> {
    if (this.isWatching) {
      this.log('FileWatcher already running');
      return;
    }

    this.isWatching = true;
    await this.takeSnapshots();

    this.pollInterval = setInterval(async () => {
      await this.checkForChanges();
    }, this.options.pollIntervalMs);

    this.log('FileWatcher started (poll: ' + this.options.pollIntervalMs + 'ms, debounce: ' + this.options.debounceMs + 'ms)');
    this.emit('started');
  }

  /**
   * Para o monitoramento
   */
  stop(): void {
    if (!this.isWatching) return;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Cancel pending syncs
    for (const timeout of this.pendingSyncs.values()) {
      clearTimeout(timeout);
    }
    this.pendingSyncs.clear();
    this.projectSnapshots.clear();

    this.isWatching = false;
    this.log('FileWatcher stopped');
    this.emit('stopped');
  }

  /**
   * Retorna status atual do watcher
   */
  getStatus(): {
    isWatching: boolean;
    watchedProjects: number;
    pendingSyncs: string[];
    options: FileWatcherOptions;
  } {
    return {
      isWatching: this.isWatching,
      watchedProjects: this.projectSnapshots.size,
      pendingSyncs: Array.from(this.pendingSyncs.keys()),
      options: this.options,
    };
  }

  /**
   * Forca uma verificacao imediata de mudancas
   */
  async forceCheck(): Promise<ChangeEvent[]> {
    return this.checkForChanges();
  }

  /**
   * Registra um projeto para monitoramento (se ainda nao estiver)
   */
  async watchProject(projectId: string): Promise<void> {
    if (this.projectSnapshots.has(projectId)) return;

    const snapshot = await this.getProjectSnapshot(projectId);
    if (snapshot) {
      this.projectSnapshots.set(projectId, snapshot);
      this.log('Now watching project: ' + projectId);
    }
  }

  /**
   * Remove um projeto do monitoramento
   */
  unwatchProject(projectId: string): void {
    this.projectSnapshots.delete(projectId);
    const pending = this.pendingSyncs.get(projectId);
    if (pending) {
      clearTimeout(pending);
      this.pendingSyncs.delete(projectId);
    }
    this.log('Stopped watching project: ' + projectId);
  }

  // -------------------------------------------------------------------
  // Private Methods
  // -------------------------------------------------------------------

  private log(message: string): void {
    if (this.options.verbose) {
      console.log('[FileWatcher] ' + message);
    }
  }

  private async takeSnapshots(): Promise<void> {
    const projectRepo = this.db.getRepository(Project);
    const projects = await projectRepo.find();

    for (const project of projects) {
      const snapshot = await this.getProjectSnapshot(project.id);
      if (snapshot) {
        this.projectSnapshots.set(project.id, snapshot);
      }
    }

    this.log('Took snapshots for ' + this.projectSnapshots.size + ' projects');
  }

  private async getProjectSnapshot(projectId: string): Promise<ProjectSnapshot | null> {
    const projectRepo = this.db.getRepository(Project);
    const contextRepo = this.db.getRepository(ContextEntry);
    const decisionRepo = this.db.getRepository(Decision);

    const project = await projectRepo.findOne({ where: { id: projectId } });
    if (!project) return null;

    const [contextCount, decisionCount] = await Promise.all([
      contextRepo.count({ where: { projectId } }),
      decisionRepo.count({ where: { projectId } }),
    ]);

    const lastContext = await contextRepo.findOne({
      where: { projectId },
      order: { updatedAt: 'DESC' },
    });

    const lastDecision = await decisionRepo.findOne({
      where: { projectId },
      order: { updatedAt: 'DESC' },
    });

    return {
      contextCount,
      decisionCount,
      lastContextUpdate: lastContext?.updatedAt ?? null,
      lastDecisionUpdate: lastDecision?.updatedAt ?? null,
      projectUpdatedAt: project.updatedAt,
    };
  }

  private async checkForChanges(): Promise<ChangeEvent[]> {
    const changes: ChangeEvent[] = [];
    const projectRepo = this.db.getRepository(Project);
    const projects = await projectRepo.find();

    // Check for new projects
    for (const project of projects) {
      if (!this.projectSnapshots.has(project.id)) {
        const snapshot = await this.getProjectSnapshot(project.id);
        if (snapshot) {
          this.projectSnapshots.set(project.id, snapshot);
          changes.push({
            projectId: project.id,
            projectName: project.name,
            changeType: 'project',
            entityId: project.id,
            action: 'create',
            timestamp: new Date(),
          });
        }
        continue;
      }

      const oldSnapshot = this.projectSnapshots.get(project.id)!;
      const newSnapshot = await this.getProjectSnapshot(project.id);

      if (!newSnapshot) {
        // Project was deleted
        this.projectSnapshots.delete(project.id);
        changes.push({
          projectId: project.id,
          projectName: project.name,
          changeType: 'project',
          entityId: project.id,
          action: 'delete',
          timestamp: new Date(),
        });
        continue;
      }

      // Check for context changes
      if (
        newSnapshot.contextCount !== oldSnapshot.contextCount ||
        (newSnapshot.lastContextUpdate && 
         (!oldSnapshot.lastContextUpdate || 
          newSnapshot.lastContextUpdate > oldSnapshot.lastContextUpdate))
      ) {
        const action = newSnapshot.contextCount > oldSnapshot.contextCount ? 'create' :
                       newSnapshot.contextCount < oldSnapshot.contextCount ? 'delete' : 'update';
        changes.push({
          projectId: project.id,
          projectName: project.name,
          changeType: 'context',
          entityId: project.id,
          action,
          timestamp: new Date(),
        });
      }

      // Check for decision changes
      if (
        newSnapshot.decisionCount !== oldSnapshot.decisionCount ||
        (newSnapshot.lastDecisionUpdate && 
         (!oldSnapshot.lastDecisionUpdate || 
          newSnapshot.lastDecisionUpdate > oldSnapshot.lastDecisionUpdate))
      ) {
        const action = newSnapshot.decisionCount > oldSnapshot.decisionCount ? 'create' :
                       newSnapshot.decisionCount < oldSnapshot.decisionCount ? 'delete' : 'update';
        changes.push({
          projectId: project.id,
          projectName: project.name,
          changeType: 'decision',
          entityId: project.id,
          action,
          timestamp: new Date(),
        });
      }

      // Check for project metadata changes
      if (newSnapshot.projectUpdatedAt > oldSnapshot.projectUpdatedAt) {
        const hasOtherChanges = changes.some(c => c.projectId === project.id);
        if (!hasOtherChanges) {
          changes.push({
            projectId: project.id,
            projectName: project.name,
            changeType: 'project',
            entityId: project.id,
            action: 'update',
            timestamp: new Date(),
          });
        }
      }

      // Update snapshot
      this.projectSnapshots.set(project.id, newSnapshot);
    }

    // Handle detected changes
    for (const change of changes) {
      this.emit('change', change);
      this.log('Detected ' + change.action + ' in ' + change.changeType + ' for project ' + change.projectName);
      this.scheduleSyncForProject(change.projectId);
    }

    if (changes.length > 0) {
      this.emit('changes', changes);
    }

    return changes;
  }

  private scheduleSyncForProject(projectId: string): void {
    // Cancel existing pending sync for this project
    const existing = this.pendingSyncs.get(projectId);
    if (existing) {
      clearTimeout(existing);
    }

    // Schedule new sync with debounce
    const timeout = setTimeout(async () => {
      this.pendingSyncs.delete(projectId);
      await this.triggerSync(projectId);
    }, this.options.debounceMs);

    this.pendingSyncs.set(projectId, timeout);
    this.log('Scheduled sync for project ' + projectId + ' in ' + this.options.debounceMs + 'ms');
  }

  private async triggerSync(projectId: string): Promise<void> {
    if (!this.autoSyncService) {
      this.log('No AutoSyncService connected, skipping sync for ' + projectId);
      this.emit('sync-skipped', { projectId, reason: 'no-autosync-service' });
      return;
    }

    try {
      this.log('Triggering on-change sync for project ' + projectId);
      const results = await this.autoSyncService.triggerOnChange(projectId);
      this.emit('sync-complete', { projectId, results });
      this.log('Sync complete for ' + projectId + ': ' + results.length + ' configs synced');
    } catch (error) {
      this.log('Sync failed for ' + projectId + ': ' + error);
      this.emit('sync-error', { projectId, error });
    }
  }
}
