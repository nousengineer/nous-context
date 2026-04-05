import * as vscode from 'vscode';
import type { ActionLogEntry } from '@thinkcoffee/core/src/types/safety-net';

/**
 * Gerencia o modo Dry-Run para pipelines.
 *
 * Em modo dry-run:
 * - read_file, list_files, search_code executam normalmente
 * - write_file NAO grava -- registra no action log com dryRun: true
 * - run_command NAO executa -- registra e retorna simulacao
 * - delete_file NAO deleta -- registra e retorna simulacao
 *
 * REQ-04 do PM-BACKLOG-V3.
 */
export class DryRunManager {
  private _isDryRunEnabled = false;
  private _plannedActions: PlannedAction[] = [];
  private _onStateChange = new vscode.EventEmitter<boolean>();
  readonly onStateChange = this._onStateChange.event;

  get isDryRunEnabled(): boolean {
    return this._isDryRunEnabled;
  }

  set isDryRunEnabled(value: boolean) {
    const changed = this._isDryRunEnabled !== value;
    this._isDryRunEnabled = value;
    if (changed) {
      if (value) {
        this._plannedActions = [];
      }
      this._onStateChange.fire(value);
      vscode.window.showInformationMessage(
        `Dry-Run mode ${value ? 'ATIVADO' : 'DESATIVADO'}. ${value ? 'Nenhuma acao de escrita sera executada.' : 'Acoes de escrita serao executadas normalmente.'}`
      );
    }
  }

  /**
   * Alterna o estado do dry-run.
   */
  toggleDryRun(): void {
    this.isDryRunEnabled = !this.isDryRunEnabled;
  }

  /**
   * Registra uma acao planejada durante dry-run.
   */
  recordPlannedAction(action: PlannedAction): void {
    this._plannedActions.push(action);
  }

  /**
   * Retorna todas as acoes planejadas durante a sessao dry-run.
   */
  getPlannedActions(): readonly PlannedAction[] {
    return this._plannedActions;
  }

  /**
   * Gera um resumo de todas as acoes planejadas.
   */
  getSummary(): DryRunSummary {
    const filesWritten = this._plannedActions.filter(a => a.type === 'write_file');
    const filesDeleted = this._plannedActions.filter(a => a.type === 'delete_file');
    const commandsExecuted = this._plannedActions.filter(a => a.type === 'run_command');

    return {
      totalActions: this._plannedActions.length,
      filesWouldBeWritten: filesWritten.length,
      filesWouldBeDeleted: filesDeleted.length,
      commandsWouldBeExecuted: commandsExecuted.length,
      actions: [...this._plannedActions],
    };
  }

  /**
   * Gera mensagem de resumo formatada para o chat.
   */
  getSummaryMessage(): string {
    const summary = this.getSummary();

    if (summary.totalActions === 0) {
      return '[DRY-RUN] Nenhuma acao de escrita foi planejada.';
    }

    const lines: string[] = [
      `[DRY-RUN] Resumo -- ${summary.totalActions} acoes planejadas:`,
      '',
    ];

    if (summary.filesWouldBeWritten > 0) {
      lines.push(`**Arquivos que seriam escritos** (${summary.filesWouldBeWritten}):`);
      for (const action of this._plannedActions.filter(a => a.type === 'write_file')) {
        const size = action.details?.contentSize || 0;
        lines.push(`  - \`${action.path}\` (${this._formatBytes(size)})`);
      }
      lines.push('');
    }

    if (summary.filesWouldBeDeleted > 0) {
      lines.push(`**Arquivos que seriam deletados** (${summary.filesWouldBeDeleted}):`);
      for (const action of this._plannedActions.filter(a => a.type === 'delete_file')) {
        lines.push(`  - \`${action.path}\``);
      }
      lines.push('');
    }

    if (summary.commandsWouldBeExecuted > 0) {
      lines.push(`**Comandos que seriam executados** (${summary.commandsWouldBeExecuted}):`);
      for (const action of this._plannedActions.filter(a => a.type === 'run_command')) {
        lines.push(`  - \`${action.details?.command || action.path}\``);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Reseta as acoes planejadas.
   */
  reset(): void {
    this._plannedActions = [];
  }

  /**
   * Simula o resultado de uma tool call de escrita.
   * Retorna a string que sera devolvida ao agente no lugar da execucao real.
   */
  simulateWriteFile(relativePath: string, contentSize: number): string {
    this.recordPlannedAction({
      type: 'write_file',
      path: relativePath,
      timestamp: new Date().toISOString(),
      details: { contentSize },
    });
    return `DRY-RUN: Would write to ${relativePath} (${this._formatBytes(contentSize)})`;
  }

  /**
   * Simula o resultado de um run_command.
   */
  simulateRunCommand(command: string): string {
    this.recordPlannedAction({
      type: 'run_command',
      path: command,
      timestamp: new Date().toISOString(),
      details: { command },
    });
    return `DRY-RUN: Would execute: ${command}`;
  }

  /**
   * Simula o resultado de um delete_file.
   */
  simulateDeleteFile(relativePath: string): string {
    this.recordPlannedAction({
      type: 'delete_file',
      path: relativePath,
      timestamp: new Date().toISOString(),
    });
    return `DRY-RUN: Would delete: ${relativePath}`;
  }

  private _formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

// ---- Types ----

export interface PlannedAction {
  type: 'write_file' | 'delete_file' | 'run_command';
  path: string;
  timestamp: string;
  details?: {
    contentSize?: number;
    command?: string;
  };
}

export interface DryRunSummary {
  totalActions: number;
  filesWouldBeWritten: number;
  filesWouldBeDeleted: number;
  commandsWouldBeExecuted: number;
  actions: PlannedAction[];
}
