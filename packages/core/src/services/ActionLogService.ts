import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { ActionLogEntry } from '../types/safety-net';

/**
 * Service for logging agent tool actions.
 *
 * Stores logs in JSONL format (one JSON object per line) for efficient append operations.
 * Log files are located at: ~/.thinkcoffee/logs/<pipelineId>.jsonl
 *
 * The log is append-only -- entries are never modified or deleted.
 */
export class ActionLogService {
  private readonly logsDir: string;

  constructor(private readonly workspaceRoot: string) {
    this.logsDir = path.join(os.homedir(), '.thinkcoffee', 'logs');
    this.ensureDir(this.logsDir);
  }

  /**
   * Logs a new tool action entry.
   * Generates an id (UUID v4) and timestamp automatically.
   *
   * @param entry - The log entry without id and timestamp (auto-generated).
   */
  public async log(entry: Omit<ActionLogEntry, 'id' | 'timestamp'>): Promise<ActionLogEntry> {
    const fullEntry: ActionLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    const logFilePath = this.getLogFilePath(entry.pipelineId);
    this.ensureDir(path.dirname(logFilePath));

    const line = JSON.stringify(fullEntry) + '\n';
    fs.appendFileSync(logFilePath, line, 'utf-8');

    return fullEntry;
  }

  /**
   * Retrieves all log entries for a given pipeline.
   *
   * @param pipelineId - The ID of the pipeline.
   * @returns Array of ActionLogEntry objects, ordered chronologically.
   */
  public async getByPipeline(pipelineId: string): Promise<ActionLogEntry[]> {
    const logFilePath = this.getLogFilePath(pipelineId);

    if (!fs.existsSync(logFilePath)) {
      return [];
    }

    return this.readLogFile(logFilePath);
  }

  /**
   * Retrieves log entries for a specific phase of a pipeline.
   *
   * @param pipelineId - The ID of the pipeline.
   * @param phaseIndex - The index of the phase.
   * @returns Array of ActionLogEntry objects for that phase.
   */
  public async getByPhase(pipelineId: string, phaseIndex: number): Promise<ActionLogEntry[]> {
    const all = await this.getByPipeline(pipelineId);
    return all.filter(entry => entry.phaseIndex === phaseIndex);
  }

  /**
   * Retrieves file-related actions for a specific pipeline phase.
   * Returns only entries that have filesAffected with write/delete/create actions.
   *
   * @param pipelineId - The ID of the pipeline.
   * @param phaseIndex - The index of the phase.
   * @returns Array of ActionLogEntry objects with file actions.
   */
  public async getFileActions(pipelineId: string, phaseIndex: number): Promise<ActionLogEntry[]> {
    const phaseEntries = await this.getByPhase(pipelineId, phaseIndex);
    return phaseEntries.filter(entry =>
      entry.filesAffected && entry.filesAffected.length > 0
    );
  }

  /**
   * Returns a summary of actions for a pipeline.
   *
   * @param pipelineId - The ID of the pipeline.
   * @returns Summary object with counts by tool, result, and files affected.
   */
  public async getSummary(pipelineId: string): Promise<{
    totalActions: number;
    byTool: Record<string, number>;
    byResult: Record<string, number>;
    totalFilesAffected: number;
    totalDurationMs: number;
    dryRunCount: number;
  }> {
    const entries = await this.getByPipeline(pipelineId);

    const byTool: Record<string, number> = {};
    const byResult: Record<string, number> = {};
    let totalFilesAffected = 0;
    let totalDurationMs = 0;
    let dryRunCount = 0;

    for (const entry of entries) {
      byTool[entry.toolName] = (byTool[entry.toolName] || 0) + 1;
      byResult[entry.result] = (byResult[entry.result] || 0) + 1;
      totalFilesAffected += entry.filesAffected?.length || 0;
      totalDurationMs += entry.durationMs;
      if (entry.dryRun) dryRunCount++;
    }

    return {
      totalActions: entries.length,
      byTool,
      byResult,
      totalFilesAffected,
      totalDurationMs,
      dryRunCount,
    };
  }

  /**
   * Returns a dry-run summary for a pipeline -- only dry-run entries.
   */
  public async getDryRunSummary(pipelineId: string): Promise<{
    totalActions: number;
    writesPlanned: number;
    deletesPlanned: number;
    commandsPlanned: number;
    filesAffected: string[];
  }> {
    const entries = await this.getByPipeline(pipelineId);
    const dryRunEntries = entries.filter(e => e.dryRun);

    let writesPlanned = 0;
    let deletesPlanned = 0;
    let commandsPlanned = 0;
    const filesAffected = new Set<string>();

    for (const entry of dryRunEntries) {
      if (entry.toolName === 'write_file') writesPlanned++;
      if (entry.toolName === 'delete_file') deletesPlanned++;
      if (entry.toolName === 'run_command') commandsPlanned++;
      if (entry.filesAffected) {
        for (const f of entry.filesAffected) {
          filesAffected.add(f.path);
        }
      }
    }

    return {
      totalActions: dryRunEntries.length,
      writesPlanned,
      deletesPlanned,
      commandsPlanned,
      filesAffected: Array.from(filesAffected),
    };
  }

  // -- Private helpers --

  private getLogFilePath(pipelineId: string): string {
    return path.join(this.logsDir, `${pipelineId}.jsonl`);
  }

  private readLogFile(filePath: string): ActionLogEntry[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    const entries: ActionLogEntry[] = [];

    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines silently
        console.error(`[ActionLogService] Skipping malformed log line: ${line.substring(0, 100)}`);
      }
    }

    return entries;
  }

  private ensureDir(dir: string): void {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      console.error(`[ActionLogService] Cannot create directory ${dir}: ${(err as Error).message}`);
    }
  }
}
