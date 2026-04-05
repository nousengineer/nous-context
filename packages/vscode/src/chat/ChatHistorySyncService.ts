import * as vscode from 'vscode';
import { ChatService } from '@thinkcoffee/core';
import type { ChatMessage } from '@thinkcoffee/core';
import { ChatHistoryApiClient } from './ChatHistoryApiClient';

/**
 * Opcoes de configuracao para o servico de sincronizacao
 */
export interface SyncServiceOptions {
  /** URL base da API (default: http://localhost:3456) */
  apiUrl?: string;
  /** Intervalo de sincronizacao em segundos (default: 60) */
  syncIntervalSeconds?: number;
  /** Habilita sincronizacao automatica (default: true) */
  autoSync?: boolean;
  /** Habilita logs de debug (default: false) */
  debug?: boolean;
}

/**
 * Status da sincronizacao
 */
export interface SyncStatus {
  isConnected: boolean;
  lastSyncTime: Date | null;
  lastSyncSuccess: boolean;
  pendingMessages: number;
  error?: string;
}

/**
 * ChatHistorySyncService
 * 
 * Servico que sincroniza o historico de chat local (JSONL via ChatService)
 * com a API de persistencia (SQLite via ChatHistoryService).
 * 
 * Garante que o historico seja preservado mesmo quando a extensao e reiniciada.
 */
export class ChatHistorySyncService {
  private chatService: ChatService;
  private apiClient: ChatHistoryApiClient;
  private channel: string;
  private pipelineId?: string;
  private workspace: string;

  private syncInterval: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;
  private lastSyncTime: Date | null = null;
  private lastSyncSuccess: boolean = false;
  private lastError?: string;
  private pendingMessages: ChatMessage[] = [];
  private debug: boolean;

  private disposables: vscode.Disposable[] = [];
  private statusBarItem: vscode.StatusBarItem | null = null;

  constructor(channel: string, pipelineId?: string, options: SyncServiceOptions = {}) {
    this.channel = channel;
    this.pipelineId = pipelineId;
    this.workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    this.debug = options.debug || false;

    this.chatService = new ChatService(channel);
    this.apiClient = new ChatHistoryApiClient(options.apiUrl || 'http://localhost:3456');

    // Cria status bar item para mostrar status da sincronizacao
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'thinkcoffee.showSyncStatus';
    this.updateStatusBar();
    this.statusBarItem.show();

    // Registra comando para mostrar status
    this.disposables.push(
      vscode.commands.registerCommand('thinkcoffee.showSyncStatus', () => this.showSyncStatus())
    );

    // Inicia sincronizacao automatica se habilitada
    if (options.autoSync !== false) {
      this.startAutoSync(options.syncIntervalSeconds || 60);
    }

    // Tenta recuperar historico da API ao iniciar
    this.recoverFromApi();
  }

  /**
   * Loga mensagem de debug
   */
  private log(message: string, ...args: any[]): void {
    if (this.debug) {
      console.log(`[ChatHistorySyncService] ${message}`, ...args);
    }
  }

  /**
   * Atualiza o status bar
   */
  private updateStatusBar(): void {
    if (!this.statusBarItem) return;

    if (this.isConnected) {
      this.statusBarItem.text = '$(cloud) Chat Sync';
      this.statusBarItem.tooltip = `Chat sincronizado - Ultimo sync: ${this.lastSyncTime?.toLocaleTimeString() || 'nunca'}`;
      this.statusBarItem.backgroundColor = undefined;
    } else {
      this.statusBarItem.text = '$(cloud-offline) Chat Offline';
      this.statusBarItem.tooltip = `Chat desconectado - ${this.lastError || 'API nao disponivel'}`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
  }

  /**
   * Mostra status detalhado da sincronizacao
   */
  private async showSyncStatus(): Promise<void> {
    const status = this.getStatus();

    const items: vscode.QuickPickItem[] = [
      {
        label: status.isConnected ? '$(check) Conectado' : '$(x) Desconectado',
        description: status.isConnected ? 'API disponivel' : status.error,
      },
      {
        label: '$(clock) Ultimo sync',
        description: status.lastSyncTime?.toLocaleString() || 'Nunca',
      },
      {
        label: '$(list-unordered) Mensagens pendentes',
        description: String(status.pendingMessages),
      },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(sync) Sincronizar agora', description: 'Força sincronizacao manual' },
      { label: '$(history) Recuperar do backup', description: 'Restaura historico do servidor' },
      { label: '$(database) Criar backup', description: 'Salva historico no servidor' },
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: 'ThinkCoffee - Status de Sincronizacao',
      placeHolder: 'Selecione uma acao',
    });

    if (!selected) return;

    switch (selected.label) {
      case '$(sync) Sincronizar agora':
        await this.sync();
        vscode.window.showInformationMessage('Sincronizacao concluida');
        break;
      case '$(history) Recuperar do backup':
        await this.recoverFromApi();
        vscode.window.showInformationMessage('Historico recuperado do servidor');
        break;
      case '$(database) Criar backup':
        await this.backupToApi();
        vscode.window.showInformationMessage('Backup criado no servidor');
        break;
    }
  }

  /**
   * Retorna status atual da sincronizacao
   */
  getStatus(): SyncStatus {
    return {
      isConnected: this.isConnected,
      lastSyncTime: this.lastSyncTime,
      lastSyncSuccess: this.lastSyncSuccess,
      pendingMessages: this.pendingMessages.length,
      error: this.lastError,
    };
  }

  /**
   * Retorna o ChatService subjacente
   */
  getChatService(): ChatService {
    return this.chatService;
  }

  /**
   * Envia uma mensagem (salva localmente e agenda para sync)
   */
  send(message: Omit<ChatMessage, 'id' | 'timestamp'>): ChatMessage {
    const fullMessage = this.chatService.send(message);
    this.pendingMessages.push(fullMessage);
    this.log('Mensagem enviada, pendentes:', this.pendingMessages.length);
    return fullMessage;
  }

  /**
   * Obtem historico local
   */
  getHistory(limit?: number): ChatMessage[] {
    return this.chatService.getHistory(limit);
  }

  /**
   * Limpa historico local (e agenda limpeza no servidor)
   */
  clear(): void {
    this.chatService.backup(); // Backup local antes de limpar
    this.chatService.clear();
    this.pendingMessages = [];

    // Limpa no servidor tambem
    this.clearOnApi().catch(err => {
      this.log('Erro ao limpar no servidor:', err);
    });
  }

  /**
   * Watch para mudancas no historico
   */
  watch(callback: (msgs: ChatMessage[]) => void): () => void {
    return this.chatService.watch(callback);
  }

  /**
   * Inicia sincronizacao automatica
   */
  startAutoSync(intervalSeconds: number = 60): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(() => {
      this.sync().catch(err => {
        this.log('Erro no auto-sync:', err);
      });
    }, intervalSeconds * 1000);

    this.log('Auto-sync iniciado com intervalo de', intervalSeconds, 'segundos');
  }

  /**
   * Para sincronizacao automatica
   */
  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      this.log('Auto-sync parado');
    }
  }

  /**
   * Sincroniza com a API
   */
  async sync(): Promise<boolean> {
    try {
      // Verifica conexao
      this.isConnected = await this.apiClient.healthCheck();

      if (!this.isConnected) {
        this.lastError = 'API nao disponivel';
        this.updateStatusBar();
        return false;
      }

      // Envia historico local para o servidor
      const history = this.chatService.getHistory();

      if (history.length > 0) {
        await this.apiClient.saveHistory({
          channel: this.channel,
          pipelineId: this.pipelineId,
          workspace: this.workspace,
          messages: history,
        });
      }

      this.pendingMessages = [];
      this.lastSyncTime = new Date();
      this.lastSyncSuccess = true;
      this.lastError = undefined;
      this.updateStatusBar();

      this.log('Sync concluido com sucesso');
      return true;
    } catch (err: any) {
      this.lastSyncSuccess = false;
      this.lastError = err.message;
      this.isConnected = false;
      this.updateStatusBar();

      this.log('Erro no sync:', err);
      return false;
    }
  }

  /**
   * Recupera historico do servidor
   */
  async recoverFromApi(): Promise<boolean> {
    try {
      this.isConnected = await this.apiClient.healthCheck();

      if (!this.isConnected) {
        this.log('API nao disponivel para recovery');
        this.updateStatusBar();
        return false;
      }

      // Busca historico por canal
      const serverHistory = await this.apiClient.getHistoryByChannel(this.channel);

      if (serverHistory && serverHistory.messages.length > 0) {
        const localHistory = this.chatService.getHistory();

        // Se servidor tem mais mensagens, sincroniza
        if (serverHistory.messages.length > localHistory.length) {
          this.log(
            'Recuperando',
            serverHistory.messages.length - localHistory.length,
            'mensagens do servidor'
          );

          // Faz backup do local antes de sobrescrever
          this.chatService.backup();

          // Limpa e restaura do servidor
          this.chatService.clear();
          serverHistory.messages.forEach(m => {
            this.chatService.addMessageDirectly(m);
          });

          this.log('Historico recuperado do servidor');
        }
      }

      this.lastSyncTime = new Date();
      this.lastSyncSuccess = true;
      this.lastError = undefined;
      this.updateStatusBar();

      return true;
    } catch (err: any) {
      this.lastError = err.message;
      this.isConnected = false;
      this.updateStatusBar();

      this.log('Erro no recovery:', err);
      return false;
    }
  }

  /**
   * Faz backup para a API
   */
  async backupToApi(): Promise<boolean> {
    try {
      this.isConnected = await this.apiClient.healthCheck();

      if (!this.isConnected) {
        this.lastError = 'API nao disponivel para backup';
        this.updateStatusBar();
        return false;
      }

      // Salva historico atual
      const history = this.chatService.getHistory();

      if (history.length === 0) {
        this.log('Nenhuma mensagem para backup');
        return true;
      }

      // Salva no banco
      const saved = await this.apiClient.saveHistory({
        channel: this.channel,
        pipelineId: this.pipelineId,
        workspace: this.workspace,
        messages: history,
      });

      // Cria backup
      if (saved && saved.id) {
        await this.apiClient.createBackup(saved.id);
      }

      this.lastSyncTime = new Date();
      this.lastSyncSuccess = true;
      this.lastError = undefined;
      this.updateStatusBar();

      this.log('Backup criado com sucesso');
      return true;
    } catch (err: any) {
      this.lastError = err.message;
      this.updateStatusBar();

      this.log('Erro no backup:', err);
      return false;
    }
  }

  /**
   * Limpa historico na API
   */
  private async clearOnApi(): Promise<void> {
    if (!this.isConnected) return;

    const historyId = this.pipelineId
      ? `history-pipeline-${this.pipelineId}`
      : `history-${this.channel}`;

    await this.apiClient.clearMessages(historyId);
  }

  /**
   * Restaura do backup mais recente no servidor
   */
  async restoreFromLatestBackup(): Promise<boolean> {
    try {
      this.isConnected = await this.apiClient.healthCheck();

      if (!this.isConnected) {
        this.lastError = 'API nao disponivel';
        return false;
      }

      const result = await this.apiClient.restoreLatestBackup(this.pipelineId);

      if (result.success) {
        // Recupera do servidor para o local
        await this.recoverFromApi();
        this.log('Restaurado', result.messagesRestored, 'mensagens do backup');
        return true;
      } else {
        this.lastError = result.error;
        return false;
      }
    } catch (err: any) {
      this.lastError = err.message;
      this.log('Erro ao restaurar backup:', err);
      return false;
    }
  }

  /**
   * Lista backups disponiveis
   */
  async listBackups(): Promise<Array<{ file: string; timestamp: string; messageCount: number }>> {
    try {
      if (!await this.apiClient.healthCheck()) {
        return [];
      }

      return await this.apiClient.listBackups(this.pipelineId);
    } catch {
      return [];
    }
  }

  /**
   * Dispose: limpa recursos
   */
  dispose(): void {
    this.stopAutoSync();

    if (this.statusBarItem) {
      this.statusBarItem.dispose();
      this.statusBarItem = null;
    }

    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLETON MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

const syncServices = new Map<string, ChatHistorySyncService>();

/**
 * Obtem ou cria um servico de sincronizacao para um canal
 */
export function getChatHistorySyncService(
  channel: string,
  pipelineId?: string,
  options?: SyncServiceOptions
): ChatHistorySyncService {
  const key = pipelineId ? `pipeline-${pipelineId}` : channel;

  if (!syncServices.has(key)) {
    syncServices.set(key, new ChatHistorySyncService(channel, pipelineId, options));
  }

  return syncServices.get(key)!;
}

/**
 * Remove um servico de sincronizacao
 */
export function disposeChatHistorySyncService(channel: string, pipelineId?: string): void {
  const key = pipelineId ? `pipeline-${pipelineId}` : channel;
  const service = syncServices.get(key);

  if (service) {
    service.dispose();
    syncServices.delete(key);
  }
}

/**
 * Dispose de todos os servicos
 */
export function disposeAllChatHistorySyncServices(): void {
  syncServices.forEach(service => service.dispose());
  syncServices.clear();
}
