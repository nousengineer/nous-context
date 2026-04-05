import type { ChatMessage } from '@thinkcoffee/core';

/**
 * Interface para resposta de historico
 */
export interface ChatHistoryData {
  id: string;
  projectId?: string;
  pipelineId?: string;
  channel: string;
  workspace: string;
  messages: ChatMessage[];
  messageCount: number;
  lastBackup?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Interface para informacoes de backup
 */
export interface BackupInfo {
  id: string;
  file: string;
  path: string;
  timestamp: string;
  messageCount: number;
  channel: string;
  pipelineId?: string;
}

/**
 * Interface para resultado de recovery
 */
export interface RecoveryResult {
  success: boolean;
  messagesRestored: number;
  error?: string;
}

/**
 * Cliente para a API de Chat History do ThinkCoffee
 * 
 * Permite a extensao VSCode persistir e recuperar o historico de chat
 * atraves de chamadas HTTP para o servidor de API.
 */
export class ChatHistoryApiClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl: string = 'http://localhost:3456', timeout: number = 10000) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = timeout;
  }

  /**
   * Verifica se o servidor esta disponivel
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetch('/health');
      return response.status === 'ok' && response.dbConnected === true;
    } catch {
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HISTORICO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista historicos com filtros opcionais
   */
  async listHistories(filter?: {
    projectId?: string;
    pipelineId?: string;
    channel?: string;
    workspace?: string;
    limit?: number;
    offset?: number;
  }): Promise<ChatHistoryData[]> {
    const params = new URLSearchParams();
    if (filter) {
      Object.entries(filter).forEach(([key, value]) => {
        if (value !== undefined) {
          params.append(key, String(value));
        }
      });
    }

    const query = params.toString();
    const url = `/api/chat/history${query ? `?${query}` : ''}`;
    const response = await this.fetch(url);
    return response.data || [];
  }

  /**
   * Recupera historico por ID
   */
  async getHistoryById(id: string): Promise<ChatHistoryData | null> {
    try {
      const response = await this.fetch(`/api/chat/history/${encodeURIComponent(id)}`);
      return response.data || null;
    } catch (err: any) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Recupera historico por canal
   */
  async getHistoryByChannel(channel: string): Promise<ChatHistoryData | null> {
    try {
      const response = await this.fetch(`/api/chat/history/channel/${encodeURIComponent(channel)}`);
      return response.data || null;
    } catch (err: any) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Recupera historico por pipeline
   */
  async getHistoryByPipeline(pipelineId: string): Promise<ChatHistoryData | null> {
    try {
      const response = await this.fetch(`/api/chat/history/pipeline/${encodeURIComponent(pipelineId)}`);
      return response.data || null;
    } catch (err: any) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Salva historico completo
   */
  async saveHistory(input: {
    projectId?: string;
    pipelineId?: string;
    channel: string;
    workspace?: string;
    messages: ChatMessage[];
  }): Promise<ChatHistoryData> {
    const response = await this.fetch('/api/chat/history', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return response.data;
  }

  /**
   * Adiciona uma mensagem a um historico existente
   */
  async appendMessage(
    historyId: string,
    message: Omit<ChatMessage, 'id' | 'timestamp'>
  ): Promise<ChatHistoryData> {
    const response = await this.fetch(`/api/chat/history/${encodeURIComponent(historyId)}/message`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    return response.data;
  }

  /**
   * Deleta historico
   */
  async deleteHistory(id: string): Promise<boolean> {
    try {
      await this.fetch(`/api/chat/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return true;
    } catch (err: any) {
      if (err.status === 404) return false;
      throw err;
    }
  }

  /**
   * Limpa mensagens de um historico
   */
  async clearMessages(historyId: string): Promise<ChatHistoryData | null> {
    try {
      const response = await this.fetch(`/api/chat/history/${encodeURIComponent(historyId)}/clear`, {
        method: 'POST',
      });
      return response.data;
    } catch (err: any) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BACKUP & RECOVERY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista todos os backups disponiveis
   */
  async listBackups(pipelineId?: string): Promise<BackupInfo[]> {
    const query = pipelineId ? `?pipelineId=${encodeURIComponent(pipelineId)}` : '';
    const response = await this.fetch(`/api/chat/backups${query}`);
    return response.data || [];
  }

  /**
   * Cria backup de um historico especifico
   */
  async createBackup(historyId: string): Promise<BackupInfo | null> {
    try {
      const response = await this.fetch(`/api/chat/history/${encodeURIComponent(historyId)}/backup`, {
        method: 'POST',
      });
      return response.data;
    } catch (err: any) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Cria backup de todos os historicos
   */
  async createFullBackup(): Promise<BackupInfo[]> {
    const response = await this.fetch('/api/chat/backups/full', { method: 'POST' });
    return response.data || [];
  }

  /**
   * Restaura historico de um backup
   */
  async restoreFromBackup(backupPath: string): Promise<RecoveryResult> {
    const response = await this.fetch('/api/chat/backups/restore', {
      method: 'POST',
      body: JSON.stringify({ backupPath }),
    });
    return {
      success: response.success === true,
      messagesRestored: response.messagesRestored || 0,
      error: response.error,
    };
  }

  /**
   * Restaura do backup mais recente
   */
  async restoreLatestBackup(pipelineId?: string): Promise<RecoveryResult> {
    const response = await this.fetch('/api/chat/backups/restore', {
      method: 'POST',
      body: JSON.stringify({ latest: true, pipelineId }),
    });
    return {
      success: response.success === true,
      messagesRestored: response.messagesRestored || 0,
      error: response.error,
    };
  }

  /**
   * Remove backups antigos
   */
  async cleanupOldBackups(daysOld: number = 30): Promise<number> {
    const response = await this.fetch(`/api/chat/backups/cleanup?daysOld=${daysOld}`, {
      method: 'DELETE',
    });
    return response.deleted || 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNC
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sincroniza historico do arquivo JSONL com o banco de dados
   */
  async sync(channel: string, pipelineId?: string): Promise<RecoveryResult> {
    const response = await this.fetch('/api/chat/sync', {
      method: 'POST',
      body: JSON.stringify({ channel, pipelineId }),
    });
    return {
      success: response.success === true,
      messagesRestored: response.messagesRestored || 0,
      error: response.error,
    };
  }

  /**
   * Escaneia e recupera historicos de arquivos JSONL existentes
   */
  async scanAndRecover(channels?: string[]): Promise<{
    results: Array<{ channel: string; success: boolean; messages: number; error?: string }>;
    summary: { channelsScanned: number; channelsRecovered: number; totalMessagesRecovered: number };
  }> {
    const response = await this.fetch('/api/chat/recovery/scan', {
      method: 'POST',
      body: JSON.stringify({ channels }),
    });
    return {
      results: response.results || [],
      summary: response.summary || { channelsScanned: 0, channelsRecovered: 0, totalMessagesRecovered: 0 },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIVE CHAT (compatibilidade com ChatService)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Recupera mensagens do chat em tempo real
   */
  async getLiveMessages(channel: string, limit?: number): Promise<ChatMessage[]> {
    const query = limit ? `?limit=${limit}` : '';
    const response = await this.fetch(`/api/chat/live/${encodeURIComponent(channel)}${query}`);
    return response.data || [];
  }

  /**
   * Envia uma mensagem no chat em tempo real
   */
  async sendLiveMessage(
    channel: string,
    message: Omit<ChatMessage, 'id' | 'timestamp'>
  ): Promise<ChatMessage> {
    const response = await this.fetch(`/api/chat/live/${encodeURIComponent(channel)}/send`, {
      method: 'POST',
      body: JSON.stringify(message),
    });
    return response.data;
  }

  /**
   * Limpa o chat em tempo real
   */
  async clearLiveChat(channel: string): Promise<void> {
    await this.fetch(`/api/chat/live/${encodeURIComponent(channel)}/clear`, { method: 'POST' });
  }

  /**
   * Faz backup do chat em tempo real
   */
  async backupLiveChat(channel: string): Promise<void> {
    await this.fetch(`/api/chat/live/${encodeURIComponent(channel)}/backup`, { method: 'POST' });
  }

  /**
   * Restaura backup do chat em tempo real
   */
  async restoreLiveChat(channel: string): Promise<number> {
    const response = await this.fetch(`/api/chat/live/${encodeURIComponent(channel)}/restore`, {
      method: 'POST',
    });
    return response.messagesRestored || 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-BACKUP
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Inicia o backup automatico
   */
  async startAutoBackup(intervalMinutes: number = 30): Promise<void> {
    await this.fetch('/api/chat/auto-backup/start', {
      method: 'POST',
      body: JSON.stringify({ intervalMinutes }),
    });
  }

  /**
   * Para o backup automatico
   */
  async stopAutoBackup(): Promise<void> {
    await this.fetch('/api/chat/auto-backup/stop', { method: 'POST' });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async fetch(path: string, options: RequestInit = {}): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await globalThis.fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        const error: any = new Error(data.error || `HTTP ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        const error: any = new Error('Request timeout');
        error.status = 408;
        throw error;
      }

      throw err;
    }
  }
}

/**
 * Instancia padrao do cliente
 */
let defaultClient: ChatHistoryApiClient | null = null;

export function getChatHistoryApiClient(baseUrl?: string): ChatHistoryApiClient {
  if (!defaultClient || baseUrl) {
    defaultClient = new ChatHistoryApiClient(baseUrl);
  }
  return defaultClient;
}
