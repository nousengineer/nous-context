import * as vscode from 'vscode';
import { getPipelineChatHistoryService } from './PipelineChatHistoryService';

/**
 * Manages the webview for displaying pipeline chat history backups.
 */
export class ChatHistoryView {
  private static readonly viewType = 'thinkcoffee.chatHistory';
  private static panel: vscode.WebviewPanel | undefined;

  public static show(extensionUri: vscode.Uri, pipelineId: string) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ChatHistoryView.panel) {
      ChatHistoryView.panel.reveal(column);
      ChatHistoryView.updateContent(pipelineId);
      return;
    }

    ChatHistoryView.panel = vscode.window.createWebviewPanel(
      ChatHistoryView.viewType,
      `Histórico: ${pipelineId}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')]
      }
    );

    ChatHistoryView.panel.onDidDispose(() => {
      ChatHistoryView.panel = undefined;
    }, null, []);

    ChatHistoryView.panel.webview.onDidReceiveMessage(async (message) => {
        const historyService = getPipelineChatHistoryService();
        switch (message.command) {
          case 'restore':
            try {
              historyService.restorePipelineHistory(message.pipelineId, message.backupFile);
              vscode.window.showInformationMessage(`Histórico do pipeline ${message.pipelineId} restaurado com sucesso.`);
              // Maybe refresh the chat view
            } catch (e: any) {
              vscode.window.showErrorMessage(`Erro ao restaurar histórico: ${e.message}`);
            }
            return;
        }
      });

    ChatHistoryView.updateContent(pipelineId);
  }

  private static updateContent(pipelineId: string) {
    if (!ChatHistoryView.panel) {
      return;
    }
    const historyService = getPipelineChatHistoryService();
    const backups = historyService.listBackups(pipelineId);
    ChatHistoryView.panel.webview.html = this.getHtmlForWebview(pipelineId, backups);
  }

  private static getHtmlForWebview(pipelineId: string, backups: Array<{ file: string; path: string; timestamp: string }>): string {
    const backupListHtml = backups.length > 0
      ? backups.map(b => `
        <div class="backup-item">
          <span>${b.file} (Data: ${new Date(b.timestamp).toLocaleString('pt-BR')})</span>
          <button class="restore-button" data-pipeline-id="${pipelineId}" data-backup-file="${b.path}">Restaurar</button>
        </div>
      `).join('')
      : '<p>Nenhum backup de histórico encontrado para este pipeline.</p>';

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Histórico do Pipeline</title>
        <style>
          body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); }
          .backup-item { display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid var(--vscode-side-bar-border); }
          .restore-button { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 5px 10px; cursor: pointer; }
          .restore-button:hover { background-color: var(--vscode-button-hover-background); }
        </style>
      </head>
      <body>
        <h1>Histórico para ${pipelineId}</h1>
        ${backupListHtml}
        <script>
          const vscode = acquireVsCodeApi();
          document.addEventListener('click', event => {
            if (event.target.classList.contains('restore-button')) {
              const pipelineId = event.target.dataset.pipelineId;
              const backupFile = event.target.dataset.backupFile;
              vscode.postMessage({ command: 'restore', pipelineId, backupFile });
            }
          });
        </script>
      </body>
      </html>`;
  }
}
