import { ChatService } from '@thinkcoffee/core';
import type { ChatMessage } from '@thinkcoffee/core';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * PipelineChatHistoryService
 * 
 * Gerencia o historico de chat para cada pipeline.
 * Oferece persistencia, recuperacao, backup e sincronizacao.
 * 
 * Armazena dados em: ~/.thinkcoffee/pipeline-chat/
 */
export class PipelineChatHistoryService {
  private _chats = new Map<string, ChatService>();
  private _historyDir: string;
  private _watchers = new Map<string, () => void>();

  constructor() {
    this._historyDir = path.join(os.homedir(), '.thinkcoffee', 'pipeline-chat');
    this._ensureDirectory(this._historyDir);
  }

  /**
   * Garante que o diretorio existe
   */
  private _ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Obtem ou cria um ChatService para um pipeline especifico
   */
  getChatForPipeline(pipelineId: string): ChatService {
    if (this._chats.has(pipelineId)) {
      return this._chats.get(pipelineId)!;
    }

    const chat = new ChatService(`pipeline-${pipelineId}`);
    this._chats.set(pipelineId, chat);
    return chat;
  }

  /**
   * Verifica se existe historico para um pipeline
   */
  hasPipelineHistory(pipelineId: string): boolean {
    const chat = this.getChatForPipeline(pipelineId);
    return chat.getHistory().length > 0;
  }

  /**
   * Obtem o historico de um pipeline
   */
  getPipelineHistory(pipelineId: string, limit?: number): ChatMessage[] {
    const chat = this.getChatForPipeline(pipelineId);
    return chat.getHistory(limit);
  }

  /**
   * Adiciona uma mensagem ao historico de um pipeline
   */
  addMessage(pipelineId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>): ChatMessage {
    const chat = this.getChatForPipeline(pipelineId);
    return chat.send(message);
  }

  /**
   * Limpa o historico de um pipeline
   */
  clearPipelineHistory(pipelineId: string): void {
    const chat = this.getChatForPipeline(pipelineId);
    chat.clear();
  }

  /**
   * Salva o historico de um pipeline em um arquivo de backup
   * Retorna o caminho do arquivo criado
   */
  backupPipelineHistory(pipelineId: string): string {
    const chat = this.getChatForPipeline(pipelineId);
    const history = chat.getHistory();

    if (history.length === 0) {
      throw new Error('Nenhuma mensagem para fazer backup');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(
      this._historyDir,
      `backup_${pipelineId}_${timestamp}.jsonl`
    );

    const content = history.map(m => JSON.stringify(m)).join('\n');
    fs.writeFileSync(backupFile, content, 'utf-8');

    return backupFile;
  }

  /**
   * Restaura historico de um arquivo de backup
   */
  restorePipelineHistory(pipelineId: string, backupFile: string): void {
    if (!fs.existsSync(backupFile)) {
      throw new Error(`Arquivo de backup nao encontrado: ${backupFile}`);
    }

    const chat = this.getChatForPipeline(pipelineId);
    const content = fs.readFileSync(backupFile, 'utf-8').trim();

    if (!content) {
      throw new Error('Arquivo de backup esta vazio');
    }

    const messages: ChatMessage[] = [];
    const lines = content.split('\n');

    lines.forEach((line, i) => {
      if (!line.trim()) return;
      try {
        messages.push(JSON.parse(line) as ChatMessage);
      } catch (err) {
        console.error(`[PipelineChatHistoryService] Erro ao restaurar linha ${i + 1}: ${err}`);
      }
    });

    if (messages.length === 0) {
      throw new Error('Nenhuma mensagem valida encontrada no backup');
    }

    // Faz backup do atual antes de sobrescrever
    const currentHistory = chat.getHistory();
    if (currentHistory.length > 0) {
      try {
        this.backupPipelineHistory(pipelineId);
      } catch {
        // Ignora se falhar (historico vazio)
      }
    }

    // Limpar e restaurar
    chat.clear();
    messages.forEach(m => {
      chat.addMessageDirectly(m);
    });
  }

  /**
   * Lista todos os backups disponiveis para um pipeline
   */
  listBackups(pipelineId: string): Array<{ file: string; path: string; timestamp: string }> {
    if (!fs.existsSync(this._historyDir)) {
      return [];
    }

    const files = fs.readdirSync(this._historyDir);
    const pattern = new RegExp(`^backup_${pipelineId}_`);

    return files
      .filter(f => pattern.test(f))
      .map(f => {
        const match = f.match(/_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
        return {
          file: f,
          path: path.join(this._historyDir, f),
          timestamp: match ? match[1] : 'unknown',
        };
      })
      .sort((a, b) => b.file.localeCompare(a.file));
  }

  /**
   * Lista todos os pipelines com backups
   */
  listAllPipelinesWithBackups(): string[] {
    if (!fs.existsSync(this._historyDir)) {
      return [];
    }

    const files = fs.readdirSync(this._historyDir);
    const pipelineIds = new Set<string>();

    files.forEach(f => {
      const match = f.match(/^backup_([^_]+)_/);
      if (match) {
        pipelineIds.add(match[1]);
      }
    });

    return Array.from(pipelineIds);
  }

  /**
   * Deleta backups antigos (mais de `daysOld` dias)
   */
  cleanupOldBackups(daysOld: number = 30): number {
    if (!fs.existsSync(this._historyDir)) {
      return 0;
    }

    const files = fs.readdirSync(this._historyDir);
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    let deleted = 0;

    files.forEach(f => {
      const fullPath = path.join(this._historyDir, f);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(fullPath);
          deleted++;
        }
      } catch (err) {
        console.error(`[PipelineChatHistoryService] Erro ao limpar ${f}: ${err}`);
      }
    });

    return deleted;
  }

  /**
   * Exporta historico de um pipeline em diferentes formatos
   */
  exportHistory(
    pipelineId: string,
    format: 'json' | 'jsonl' | 'markdown' | 'csv' = 'json'
  ): string {
    const chat = this.getChatForPipeline(pipelineId);
    const history = chat.getHistory();

    if (history.length === 0) {
      throw new Error('Nenhuma mensagem para exportar');
    }

    switch (format) {
      case 'jsonl':
        return history.map(m => JSON.stringify(m)).join('\n');

      case 'markdown': {
        const mdLines = history.map(m => {
          const time = new Date(m.timestamp).toLocaleString('pt-BR');
          const lines = [
            `### ${m.senderLabel || m.sender} (${m.type})`,
            `*${time}*`,
            '',
            m.content,
          ];
          return lines.join('\n');
        });
        return [
          `# Historico do Pipeline: ${pipelineId}`,
          `Exportado em: ${new Date().toLocaleString('pt-BR')}`,
          `Total de mensagens: ${history.length}`,
          '',
          '---',
          '',
          mdLines.join('\n\n---\n\n'),
        ].join('\n');
      }

      case 'csv': {
        const headers = ['timestamp', 'sender', 'senderLabel', 'type', 'content'];
        const escapeCSV = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
        const rows = history.map(m => [
          escapeCSV(m.timestamp),
          escapeCSV(m.sender),
          escapeCSV(m.senderLabel || ''),
          escapeCSV(m.type),
          escapeCSV(m.content),
        ]);
        return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      }

      default: // json
        return JSON.stringify(
          {
            pipelineId,
            exportedAt: new Date().toISOString(),
            count: history.length,
            messages: history,
          },
          null,
          2
        );
    }
  }

  /**
   * Importa historico de um arquivo JSON ou JSONL
   */
  importHistory(pipelineId: string, content: string, merge: boolean = false): number {
    const chat = this.getChatForPipeline(pipelineId);

    let messages: ChatMessage[];

    // Detecta formato
    if (content.trim().startsWith('{')) {
      // JSON
      const parsed = JSON.parse(content);
      messages = parsed.messages || parsed;
    } else {
      // JSONL
      messages = content
        .trim()
        .split('\n')
        .filter(l => l.trim())
        .map(l => JSON.parse(l));
    }

    if (!merge) {
      // Backup e limpa
      const currentHistory = chat.getHistory();
      if (currentHistory.length > 0) {
        this.backupPipelineHistory(pipelineId);
      }
      chat.clear();
    }

    // Adiciona mensagens
    const existing = new Set(chat.getHistory().map(m => m.id));
    let added = 0;

    messages.forEach(m => {
      if (!existing.has(m.id)) {
        chat.addMessageDirectly(m);
        added++;
      }
    });

    return added;
  }

  /**
   * Sincroniza historico entre multiplos chats (merge com deduplicacao por ID)
   */
  syncHistories(pipelineId: string, otherHistories: ChatMessage[][]): ChatMessage[] {
    const chat = this.getChatForPipeline(pipelineId);
    const current = chat.getHistory();

    const merged = new Map<string, ChatMessage>();

    // Adicionar mensagens atuais
    current.forEach(m => merged.set(m.id, m));

    // Mesclar com historias de outros chats
    otherHistories.forEach(history => {
      history.forEach(m => {
        if (!merged.has(m.id)) {
          merged.set(m.id, m);
        }
      });
    });

    // Ordenar por timestamp
    const synced = Array.from(merged.values()).sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return synced;
  }

  /**
   * Obter estatisticas de historico
   */
  getHistoryStats(pipelineId: string) {
    const chat = this.getChatForPipeline(pipelineId);
    const history = chat.getHistory();

    const stats = {
      totalMessages: history.length,
      totalCharacters: history.reduce((sum, m) => sum + m.content.length, 0),
      messagesByType: {} as Record<string, number>,
      messagesBySender: {} as Record<string, number>,
      dateRange:
        history.length > 0
          ? {
              oldest: history[0].timestamp,
              newest: history[history.length - 1].timestamp,
            }
          : null,
    };

    history.forEach(m => {
      stats.messagesByType[m.type] = (stats.messagesByType[m.type] || 0) + 1;
      stats.messagesBySender[m.sender] = (stats.messagesBySender[m.sender] || 0) + 1;
    });

    return stats;
  }

  /**
   * Registra um watcher para mudancas no historico
   */
  watchPipeline(pipelineId: string, callback: (messages: ChatMessage[]) => void): () => void {
    const chat = this.getChatForPipeline(pipelineId);
    
    // Remove watcher anterior se existir
    const existingClose = this._watchers.get(pipelineId);
    if (existingClose) {
      existingClose();
    }

    const close = chat.watch(callback);
    this._watchers.set(pipelineId, close);

    return () => {
      close();
      this._watchers.delete(pipelineId);
    };
  }

  /**
   * Cleanup: remover um pipeline do cache
   */
  removePipelineChat(pipelineId: string): void {
    const close = this._watchers.get(pipelineId);
    if (close) {
      close();
      this._watchers.delete(pipelineId);
    }
    this._chats.delete(pipelineId);
  }

  /**
   * Obter diretorio raiz de historico
   */
  getHistoryDirectory(): string {
    return this._historyDir;
  }

  /**
   * Obter caminho do arquivo de chat de um pipeline
   */
  getChatFilePath(pipelineId: string): string {
    const chat = this.getChatForPipeline(pipelineId);
    return chat.getFilePath();
  }

  /**
   * Dispose: limpa todos os recursos
   */
  dispose(): void {
    this._watchers.forEach(close => close());
    this._watchers.clear();
    this._chats.clear();
  }
}

// Instancia singleton
let instance: PipelineChatHistoryService | null = null;

export function getPipelineChatHistoryService(): PipelineChatHistoryService {
  if (!instance) {
    instance = new PipelineChatHistoryService();
  }
  return instance;
}

/**
 * Reseta a instancia singleton (util para testes)
 */
export function resetPipelineChatHistoryService(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
}
