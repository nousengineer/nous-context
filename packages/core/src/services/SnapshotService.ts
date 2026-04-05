import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  SnapshotMetadata,
  SnapshotFileMetadata,
  SnapshotConfig,
  DEFAULT_SNAPSHOT_CONFIG,
} from '../types/safety-net';
import { safePath } from '../utils/safe-path';

/**
 * Service for creating and managing file snapshots before agent modifications.
 *
 * Snapshots are stored in ~/.thinkcoffee/snapshots/<pipelineId>/<phaseIndex>/
 * Each snapshot directory contains:
 *   - snapshot.json: metadata about which files were snapshotted
 *   - files/: copies of original files preserving relative directory structure
 *
 * Snapshot is **lazy**: files are backed up one-by-one before each write/delete,
 * not all at once at phase start. Each file is snapshotted only ONCE per phase.
 */
export class SnapshotService {
  private readonly snapshotsBaseDir: string;

  constructor(private readonly workspaceRoot: string) {
    this.snapshotsBaseDir = path.join(os.homedir(), '.thinkcoffee', 'snapshots');
    this.ensureDir(this.snapshotsBaseDir);
  }

  /**
   * Creates a snapshot of a file before it's modified or deleted.
   * This should be called BEFORE the file operation.
   * If a snapshot for this file in this phase already exists, it's a no-op.
   *
   * @param pipelineId - The ID of the pipeline.
   * @param phaseIndex - The index of the current phase.
   * @param phaseName - The name of the current phase.
   * @param relativePath - The workspace-relative path to the file.
   * @param action - The action being performed ('modified' or 'deleted').
   */
  public async createSnapshot(
    pipelineId: string,
    phaseIndex: number,
    phaseName: string,
    relativePath: string,
    action: 'modified' | 'deleted',
  ): Promise<void> {
    const snapshotDir = this.getSnapshotDir(pipelineId, phaseIndex);
    const metadata = await this.getSnapshot(pipelineId, phaseIndex);

    // Check if file already snapshotted in this phase
    if (metadata && metadata.files.some(f => f.path === relativePath)) {
      return; // Already snapshotted, no-op
    }

    // Resolve and validate source file path
    const absSourcePath = safePath(this.workspaceRoot, relativePath);

    if (!fs.existsSync(absSourcePath)) {
      // File doesn't exist -- nothing to snapshot (might be a new file)
      return;
    }

    const stat = fs.statSync(absSourcePath);
    if (stat.isDirectory()) {
      return; // Don't snapshot directories
    }

    // Warn if file is large (>10MB)
    if (stat.size > 10 * 1024 * 1024) {
      console.warn(`[SnapshotService] Large file snapshot (${(stat.size / 1024 / 1024).toFixed(1)}MB): ${relativePath}`);
    }

    // Create snapshot files directory and copy the original file
    const filesDir = path.join(snapshotDir, 'files');
    const destPath = path.join(filesDir, relativePath);
    this.ensureDir(path.dirname(destPath));
    fs.copyFileSync(absSourcePath, destPath);

    // Calculate hash of original content
    const content = fs.readFileSync(absSourcePath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    // Update metadata
    const fileMetadata: SnapshotFileMetadata = {
      path: relativePath,
      action,
      originalHash: hash,
      originalSize: stat.size,
    };

    await this.updateMetadata(pipelineId, phaseIndex, phaseName, fileMetadata);
  }

  /**
   * Records that a new file was created by an agent. No file is copied.
   * This is used during rollback to know which files to DELETE.
   *
   * @param pipelineId - The ID of the pipeline.
   * @param phaseIndex - The index of the current phase.
   * @param phaseName - The name of the current phase.
   * @param relativePath - The workspace-relative path to the new file.
   */
  public async recordFileCreation(
    pipelineId: string,
    phaseIndex: number,
    phaseName: string,
    relativePath: string,
  ): Promise<void> {
    const metadata = await this.getSnapshot(pipelineId, phaseIndex);

    // Check if already recorded
    if (metadata && metadata.files.some(f => f.path === relativePath)) {
      return;
    }

    const fileMetadata: SnapshotFileMetadata = {
      path: relativePath,
      action: 'created',
      originalHash: '',
      originalSize: 0,
    };

    await this.updateMetadata(pipelineId, phaseIndex, phaseName, fileMetadata);
  }

  /**
   * Retrieves the metadata for a specific snapshot.
   *
   * @param pipelineId - The ID of the pipeline.
   * @param phaseIndex - The index of the phase.
   * @returns SnapshotMetadata or null if no snapshot exists.
   */
  public async getSnapshot(pipelineId: string, phaseIndex: number): Promise<SnapshotMetadata | null> {
    const metadataPath = this.getMetadataPath(pipelineId, phaseIndex);

    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(metadataPath, 'utf-8');
      return JSON.parse(content) as SnapshotMetadata;
    } catch (err) {
      console.error(`[SnapshotService] Failed to parse snapshot metadata: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Lists all snapshots for a pipeline.
   *
   * @param pipelineId - The ID of the pipeline.
   * @returns Array of SnapshotMetadata.
   */
  public async listSnapshots(pipelineId: string): Promise<SnapshotMetadata[]> {
    const pipelineDir = path.join(this.snapshotsBaseDir, pipelineId);

    if (!fs.existsSync(pipelineDir)) {
      return [];
    }

    const entries = fs.readdirSync(pipelineDir, { withFileTypes: true });
    const snapshots: SnapshotMetadata[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const phaseIndex = parseInt(entry.name, 10);
        if (!isNaN(phaseIndex)) {
          const metadata = await this.getSnapshot(pipelineId, phaseIndex);
          if (metadata) {
            snapshots.push(metadata);
          }
        }
      }
    }

    return snapshots.sort((a, b) => a.phaseIndex - b.phaseIndex);
  }

  /**
   * Deletes a specific snapshot.
   *
   * @param pipelineId - The ID of the pipeline.
   * @param phaseIndex - The index of the phase.
   */
  public async deleteSnapshot(pipelineId: string, phaseIndex: number): Promise<void> {
    const snapshotDir = this.getSnapshotDir(pipelineId, phaseIndex);

    if (fs.existsSync(snapshotDir)) {
      fs.rmSync(snapshotDir, { recursive: true, force: true });
    }
  }

  /**
   * Returns the path to the snapshot files directory for restoring.
   *
   * @param pipelineId - The ID of the pipeline.
   * @param phaseIndex - The index of the phase.
   * @returns Path to the files directory inside the snapshot.
   */
  public getSnapshotFilesDir(pipelineId: string, phaseIndex: number): string {
    return path.join(this.getSnapshotDir(pipelineId, phaseIndex), 'files');
  }

  /**
   * Executes garbage collection of old snapshots based on retention policies.
   *
   * Policy:
   * - Snapshots older than retentionDays are removed
   * - Total snapshot size per pipeline capped at maxSizeMB
   * - Never removes snapshots from active pipelines (caller must provide active IDs)
   *
   * @param activePipelineIds - Set of pipeline IDs that are currently active (protected from GC).
   * @returns Count of removed snapshots and freed space.
   */
  public async cleanup(activePipelineIds: Set<string> = new Set()): Promise<{ removedCount: number; freedSizeMb: number }> {
    const config = this.loadConfig();
    const now = Date.now();
    const retentionMs = config.retentionDays * 24 * 60 * 60 * 1000;
    let removedCount = 0;
    let freedBytes = 0;

    if (!fs.existsSync(this.snapshotsBaseDir)) {
      return { removedCount: 0, freedSizeMb: 0 };
    }

    const pipelineDirs = fs.readdirSync(this.snapshotsBaseDir, { withFileTypes: true });

    for (const pipelineEntry of pipelineDirs) {
      if (!pipelineEntry.isDirectory()) continue;

      const pipelineId = pipelineEntry.name;

      // Skip active pipelines
      if (activePipelineIds.has(pipelineId)) continue;

      const pipelineDir = path.join(this.snapshotsBaseDir, pipelineId);
      const phaseDirs = fs.readdirSync(pipelineDir, { withFileTypes: true });

      for (const phaseEntry of phaseDirs) {
        if (!phaseEntry.isDirectory()) continue;

        const phaseIndex = parseInt(phaseEntry.name, 10);
        if (isNaN(phaseIndex)) continue;

        const metadata = await this.getSnapshot(pipelineId, phaseIndex);
        if (!metadata) continue;

        const snapshotAge = now - new Date(metadata.timestamp).getTime();

        if (snapshotAge > retentionMs) {
          const snapshotDir = this.getSnapshotDir(pipelineId, phaseIndex);
          const dirSize = this.getDirSize(snapshotDir);
          fs.rmSync(snapshotDir, { recursive: true, force: true });
          freedBytes += dirSize;
          removedCount++;
        }
      }

      // Clean up empty pipeline directories
      try {
        const remaining = fs.readdirSync(pipelineDir);
        if (remaining.length === 0) {
          fs.rmdirSync(pipelineDir);
        }
      } catch {
        // Ignore -- directory might have been removed
      }
    }

    const freedSizeMb = parseFloat((freedBytes / (1024 * 1024)).toFixed(2));
    console.log(`[SnapshotService] Cleanup: removed ${removedCount} snapshots (${freedSizeMb} MB freed)`);

    return { removedCount, freedSizeMb };
  }

  // ─── Private helpers ─────────────────────────────────────────

  private getSnapshotDir(pipelineId: string, phaseIndex: number): string {
    return path.join(this.snapshotsBaseDir, pipelineId, String(phaseIndex));
  }

  private getMetadataPath(pipelineId: string, phaseIndex: number): string {
    return path.join(this.getSnapshotDir(pipelineId, phaseIndex), 'snapshot.json');
  }

  private async updateMetadata(
    pipelineId: string,
    phaseIndex: number,
    phaseName: string,
    newFile: SnapshotFileMetadata,
  ): Promise<void> {
    const existing = await this.getSnapshot(pipelineId, phaseIndex);

    const metadata: SnapshotMetadata = existing || {
      pipelineId,
      phaseIndex,
      phaseName,
      timestamp: new Date().toISOString(),
      files: [],
    };

    metadata.files.push(newFile);

    const snapshotDir = this.getSnapshotDir(pipelineId, phaseIndex);
    this.ensureDir(snapshotDir);

    const metadataPath = this.getMetadataPath(pipelineId, phaseIndex);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  private loadConfig(): SnapshotConfig {
    const configPath = path.join(os.homedir(), '.thinkcoffee', 'snapshot-config.json');

    if (!fs.existsSync(configPath)) {
      return { ...DEFAULT_SNAPSHOT_CONFIG };
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      return {
        retentionDays: parsed.retentionDays ?? DEFAULT_SNAPSHOT_CONFIG.retentionDays,
        maxSizeMB: parsed.maxSizeMB ?? DEFAULT_SNAPSHOT_CONFIG.maxSizeMB,
      };
    } catch {
      return { ...DEFAULT_SNAPSHOT_CONFIG };
    }
  }

  private getDirSize(dirPath: string): number {
    let totalSize = 0;

    if (!fs.existsSync(dirPath)) return 0;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += this.getDirSize(fullPath);
      } else {
        try {
          totalSize += fs.statSync(fullPath).size;
        } catch {
          // Skip inaccessible files
        }
      }
    }

    return totalSize;
  }

  private ensureDir(dir: string): void {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      console.error(`[SnapshotService] Cannot create directory ${dir}: ${(err as Error).message}`);
    }
  }
}
