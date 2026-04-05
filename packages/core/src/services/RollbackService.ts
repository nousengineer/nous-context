import fs from 'fs';
import path from 'path';
import { SnapshotService } from './SnapshotService';
import { ActionLogService } from './ActionLogService';
import { safePath } from '../utils/safe-path';
import { RollbackResult, SnapshotMetadata } from '../types/safety-net';

/**
 * Service for rolling back workspace changes using snapshots.
 * 
 * Rollback process:
 * 1. Retrieve snapshot metadata for the specified phase
 * 2. For 'modified' or 'deleted' files: restore from snapshot backup
 * 3. For 'created' files: delete them from workspace
 * 4. Log the rollback action
 */
export class RollbackService {
  private readonly snapshotService: SnapshotService;
  private readonly actionLogService: ActionLogService;

  constructor(private readonly workspaceRoot: string) {
    this.snapshotService = new SnapshotService(workspaceRoot);
    this.actionLogService = new ActionLogService(workspaceRoot);
  }

  /**
   * Reverts the workspace to the state captured in a snapshot for a specific phase.
   * 
   * @param pipelineId - The ID of the pipeline.
   * @param phaseIndex - The index of the phase to roll back.
   * @returns A summary of the rollback actions.
   * @throws Error if no snapshot exists for the specified phase.
   */
  public async rollback(pipelineId: string, phaseIndex: number): Promise<RollbackResult> {
    const snapshot = await this.snapshotService.getSnapshot(pipelineId, phaseIndex);

    if (!snapshot) {
      throw new Error(`No snapshot found for pipeline "${pipelineId}" phase ${phaseIndex}`);
    }

    const result: RollbackResult = {
      restored: 0,
      deleted: 0,
      errors: [],
    };

    const snapshotFilesDir = this.snapshotService.getSnapshotFilesDir(pipelineId, phaseIndex);

    for (const file of snapshot.files) {
      try {
        const targetPath = safePath(this.workspaceRoot, file.path);

        if (file.action === 'created') {
          // File was created by agent - delete it
          await this.deleteFile(targetPath, file.path, result);
        } else {
          // File was modified or deleted - restore from snapshot
          await this.restoreFile(snapshotFilesDir, file.path, targetPath, result);
        }
      } catch (err) {
        const errorMsg = `Failed to rollback ${file.path}: ${(err as Error).message}`;
        result.errors.push(errorMsg);
        console.error(`[RollbackService] ${errorMsg}`);
      }
    }

    // Log the rollback action
    await this.logRollbackAction(pipelineId, phaseIndex, snapshot, result);

    return result;
  }

  /**
   * Performs a dry-run rollback, returning what would happen without making changes.
   * 
   * @param pipelineId - The ID of the pipeline.
   * @param phaseIndex - The index of the phase.
   * @returns Preview of rollback actions.
   */
  public async previewRollback(pipelineId: string, phaseIndex: number): Promise<{
    wouldRestore: string[];
    wouldDelete: string[];
    snapshotTimestamp: string;
    phaseName: string;
  }> {
    const snapshot = await this.snapshotService.getSnapshot(pipelineId, phaseIndex);

    if (!snapshot) {
      throw new Error(`No snapshot found for pipeline "${pipelineId}" phase ${phaseIndex}`);
    }

    const wouldRestore: string[] = [];
    const wouldDelete: string[] = [];

    for (const file of snapshot.files) {
      if (file.action === 'created') {
        wouldDelete.push(file.path);
      } else {
        wouldRestore.push(file.path);
      }
    }

    return {
      wouldRestore,
      wouldDelete,
      snapshotTimestamp: snapshot.timestamp,
      phaseName: snapshot.phaseName,
    };
  }

  /**
   * Rolls back all phases of a pipeline in reverse order.
   * 
   * @param pipelineId - The ID of the pipeline.
   * @returns Combined result of all rollbacks.
   */
  public async rollbackAll(pipelineId: string): Promise<RollbackResult> {
    const snapshots = await this.snapshotService.listSnapshots(pipelineId);

    if (snapshots.length === 0) {
      throw new Error(`No snapshots found for pipeline "${pipelineId}"`);
    }

    // Sort by phase index descending (rollback in reverse order)
    const sortedSnapshots = snapshots.sort((a, b) => b.phaseIndex - a.phaseIndex);

    const combinedResult: RollbackResult = {
      restored: 0,
      deleted: 0,
      errors: [],
    };

    for (const snapshot of sortedSnapshots) {
      try {
        const result = await this.rollback(pipelineId, snapshot.phaseIndex);
        combinedResult.restored += result.restored;
        combinedResult.deleted += result.deleted;
        combinedResult.errors.push(...result.errors);
      } catch (err) {
        combinedResult.errors.push(
          `Phase ${snapshot.phaseIndex} (${snapshot.phaseName}): ${(err as Error).message}`
        );
      }
    }

    return combinedResult;
  }

  /**
   * Rolls back to a specific phase, reverting all phases after it.
   * 
   * @param pipelineId - The ID of the pipeline.
   * @param targetPhaseIndex - The phase to rollback TO (all phases after this will be reverted).
   * @returns Combined result.
   */
  public async rollbackTo(pipelineId: string, targetPhaseIndex: number): Promise<RollbackResult> {
    const snapshots = await this.snapshotService.listSnapshots(pipelineId);

    // Filter to only phases AFTER the target (those we want to undo)
    const phasesToUndo = snapshots
      .filter(s => s.phaseIndex > targetPhaseIndex)
      .sort((a, b) => b.phaseIndex - a.phaseIndex); // Reverse order

    if (phasesToUndo.length === 0) {
      return { restored: 0, deleted: 0, errors: [] };
    }

    const combinedResult: RollbackResult = {
      restored: 0,
      deleted: 0,
      errors: [],
    };

    for (const snapshot of phasesToUndo) {
      try {
        const result = await this.rollback(pipelineId, snapshot.phaseIndex);
        combinedResult.restored += result.restored;
        combinedResult.deleted += result.deleted;
        combinedResult.errors.push(...result.errors);
      } catch (err) {
        combinedResult.errors.push(
          `Phase ${snapshot.phaseIndex}: ${(err as Error).message}`
        );
      }
    }

    return combinedResult;
  }

  // ─── Private helpers ─────────────────────────────────────────

  private async deleteFile(
    targetPath: string,
    relativePath: string,
    result: RollbackResult
  ): Promise<void> {
    if (!fs.existsSync(targetPath)) {
      // File already doesn't exist - consider it a success
      result.deleted++;
      return;
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      // Remove directory recursively
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(targetPath);
    }

    result.deleted++;
    console.log(`[RollbackService] Deleted: ${relativePath}`);
  }

  private async restoreFile(
    snapshotFilesDir: string,
    relativePath: string,
    targetPath: string,
    result: RollbackResult
  ): Promise<void> {
    const sourcePath = path.join(snapshotFilesDir, relativePath);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Snapshot file missing: ${relativePath}`);
    }

    // Ensure target directory exists
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Copy file from snapshot to workspace
    fs.copyFileSync(sourcePath, targetPath);

    result.restored++;
    console.log(`[RollbackService] Restored: ${relativePath}`);
  }

  private async logRollbackAction(
    pipelineId: string,
    phaseIndex: number,
    snapshot: SnapshotMetadata,
    result: RollbackResult
  ): Promise<void> {
    await this.actionLogService.log({
      pipelineId,
      phaseIndex,
      taskId: 'rollback',
      agentRole: 'system',
      toolName: 'write_file', // Using write_file as closest match
      input: {
        action: 'rollback',
        targetPhase: phaseIndex,
        phaseName: snapshot.phaseName,
      },
      output: JSON.stringify({
        restored: result.restored,
        deleted: result.deleted,
        errors: result.errors,
      }),
      result: result.errors.length > 0 ? 'error' : 'success',
      durationMs: 0,
      dryRun: false,
      filesAffected: snapshot.files.map(f => ({
        path: f.path,
        action: f.action === 'created' ? 'delete' : 'write',
      })),
    });
  }
}
