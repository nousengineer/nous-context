import * as vscode from 'vscode';
import { RollbackService } from '@thinkcoffee/core/src/services/RollbackService';
import { SnapshotService } from '@thinkcoffee/core/src/services/SnapshotService';
import type { SnapshotMetadata } from '@thinkcoffee/core/src/types/safety-net';
import type { ChatService, PipelineService } from '@thinkcoffee/core';

/**
 * Handler para o comando de rollback.
 *
 * Integra o RollbackService e SnapshotService do core
 * com a UI do VS Code (confirmacao, feedback no chat).
 *
 * REQ-03 do PM-BACKLOG-V3.
 */
export class RollbackCommandHandler {
  private readonly _rollbackService: RollbackService;
  private readonly _snapshotService: SnapshotService;

  constructor(private readonly _workspaceRoot: string) {
    this._rollbackService = new RollbackService(_workspaceRoot);
    this._snapshotService = new SnapshotService(_workspaceRoot);
  }

  /**
   * Executa o rollback de uma fase de pipeline.
   *
   * Fluxo:
   * 1. Busca snapshot da fase
   * 2. Se nao existe, retorna erro
   * 3. Exibe resumo das acoes e pede confirmacao
   * 4. Executa rollback
   * 5. Exibe resultado no chat
   *
   * @param pipelineId - ID do pipeline
   * @param phaseIndex - Indice da fase a reverter
   * @param chat - ChatService para enviar mensagens
   * @param pipelineService - PipelineService para atualizar status
   * @param projectId - ID do projeto
   * @returns true se o rollback foi executado com sucesso
   */
  async executeRollback(
    pipelineId: string,
    phaseIndex: number,
    chat: ChatService,
    pipelineService?: PipelineService,
    projectId?: string,
  ): Promise<boolean> {
    // 1. Buscar snapshot
    const snapshot = await this._snapshotService.getSnapshot(pipelineId, phaseIndex);

    if (!snapshot) {
      chat.send({
        sender: 'system',
        senderLabel: 'Safety Net',
        content: `Nenhum snapshot encontrado para a fase ${phaseIndex} do pipeline \`${pipelineId.substring(0, 8)}...\`. Rollback nao pode ser executado.`,
        type: 'error',
      });
      return false;
    }

    // 2. Exibir resumo
    const summaryMsg = this._buildSummary(snapshot);

    chat.send({
      sender: 'system',
      senderLabel: 'Safety Net',
      content: summaryMsg,
      type: 'info',
    });

    // 3. Pedir confirmacao
    const confirmed = await this._confirmRollback(snapshot);
    if (!confirmed) {
      chat.send({
        sender: 'system',
        senderLabel: 'Safety Net',
        content: 'Rollback cancelado pelo usuario.',
        type: 'info',
      });
      return false;
    }

    // 4. Executar rollback
    try {
      const result = await this._rollbackService.rollback(pipelineId, phaseIndex);

      // 5. Atualizar pipeline se disponivel
      if (pipelineService && projectId) {
        const pipeline = pipelineService.get(projectId, pipelineId);
        if (pipeline) {
          const phase = pipeline.phases[phaseIndex];
          if (phase) {
            phase.status = 'in-progress';
            for (const task of phase.tasks) {
              task.status = 'pending';
              task.output = undefined;
              task.completedAt = undefined;
            }
            pipeline.currentPhase = phaseIndex;
            pipeline.updatedAt = new Date().toISOString();
            pipelineService.save(pipeline);
          }
        }
      }

      // 6. Enviar resultado no chat
      chat.send({
        sender: 'system',
        senderLabel: 'Safety Net',
        content: this._buildResultMessage(snapshot, result),
        type: 'info',
      });

      vscode.window.showInformationMessage(
        `Rollback da fase ${phaseIndex} concluido: ${result.restored} restaurados, ${result.deleted} deletados.`
      );

      return true;
    } catch (error: any) {
      chat.send({
        sender: 'system',
        senderLabel: 'Safety Net',
        content: `Erro ao executar rollback: ${error.message}`,
        type: 'error',
      });
      return false;
    }
  }

  /**
   * Exibe a lista de snapshots disponiveis para um pipeline.
   */
  async listSnapshots(pipelineId: string, chat: ChatService): Promise<void> {
    // Tentar carregar snapshots para varias fases (0..9)
    const snapshots: SnapshotMetadata[] = [];
    for (let i = 0; i < 10; i++) {
      const snap = await this._snapshotService.getSnapshot(pipelineId, i);
      if (snap) {
        snapshots.push(snap);
      }
    }

    if (snapshots.length === 0) {
      chat.send({
        sender: 'system',
        senderLabel: 'Safety Net',
        content: `Nenhum snapshot encontrado para o pipeline \`${pipelineId.substring(0, 8)}...\`.`,
        type: 'info',
      });
      return;
    }

    const lines = snapshots.map(s => {
      const fileCount = s.files.length;
      const modifiedCount = s.files.filter(f => f.action === 'modified').length;
      const createdCount = s.files.filter(f => f.action === 'created').length;
      const deletedCount = s.files.filter(f => f.action === 'deleted').length;

      return `- **Fase ${s.phaseIndex}** (${s.phaseName}) -- ${new Date(s.timestamp).toLocaleString()}\n  ${fileCount} arquivos: ${modifiedCount} modificados, ${createdCount} criados, ${deletedCount} deletados`;
    });

    chat.send({
      sender: 'system',
      senderLabel: 'Safety Net',
      content: `**Snapshots disponiveis:**\n\n${lines.join('\n\n')}\n\nUse \`/rollback <phaseIndex>\` para reverter.`,
      type: 'info',
    });
  }

  /**
   * Constroi mensagem de resumo do snapshot.
   */
  private _buildSummary(snapshot: SnapshotMetadata): string {
    const modifiedFiles = snapshot.files.filter(f => f.action === 'modified');
    const createdFiles = snapshot.files.filter(f => f.action === 'created');
    const deletedFiles = snapshot.files.filter(f => f.action === 'deleted');

    const lines: string[] = [
      `**Rollback da Fase ${snapshot.phaseIndex} (${snapshot.phaseName})**`,
      `Snapshot de: ${new Date(snapshot.timestamp).toLocaleString()}`,
      '',
    ];

    if (modifiedFiles.length > 0) {
      lines.push(`Arquivos que serao restaurados (${modifiedFiles.length}):`);
      for (const f of modifiedFiles) {
        lines.push(`  - \`${f.path}\``);
      }
    }

    if (createdFiles.length > 0) {
      lines.push(`Arquivos criados pelo agente que serao deletados (${createdFiles.length}):`);
      for (const f of createdFiles) {
        lines.push(`  - \`${f.path}\``);
      }
    }

    if (deletedFiles.length > 0) {
      lines.push(`Arquivos deletados pelo agente que serao restaurados (${deletedFiles.length}):`);
      for (const f of deletedFiles) {
        lines.push(`  - \`${f.path}\``);
      }
    }

    return lines.join('\n');
  }

  /**
   * Constroi mensagem de resultado do rollback.
   */
  private _buildResultMessage(
    snapshot: SnapshotMetadata,
    result: { restored: number; deleted: number },
  ): string {
    return [
      `**Rollback da Fase ${snapshot.phaseIndex} concluido**`,
      `- ${result.restored} arquivo(s) restaurado(s)`,
      `- ${result.deleted} arquivo(s) deletado(s)`,
      `- Fase resetada para \`in-progress\``,
      `- Tasks resetadas para \`pending\``,
    ].join('\n');
  }

  /**
   * Exibe confirmacao modal para rollback.
   */
  private async _confirmRollback(snapshot: SnapshotMetadata): Promise<boolean> {
    const totalFiles = snapshot.files.length;
    const message = `Tem certeza que deseja reverter a fase ${snapshot.phaseIndex} (${snapshot.phaseName})? ${totalFiles} arquivo(s) serao afetados. Esta acao nao pode ser desfeita.`;

    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      'Sim, Reverter',
      'Cancelar',
    );

    return choice === 'Sim, Reverter';
  }
}
