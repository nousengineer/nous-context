import { Repository, DataSource, Between, LessThan, MoreThan } from 'typeorm';
import { ChatHistory, ChatMessage } from '../entities/ChatHistory';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface SaveHistoryInput {
  projectId?: string;
  pipelineId?: string;
  channel: string;
  workspace: string;
  messages: ChatMessage[];
}

export interface HistoryFilter {
  projectId?: string;
  pipelineId?: string;
  channel?: string;
  workspace?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

export interface BackupInfo {
  id: string;
  file: string;
  path: string;
  timestamp: Date;
  messageCount: number;
  channel: string;
  pipelineId?: string;
}

export interface RecoveryResult {
  success: boolean;
  messagesRestored: number;
  error?: string;
}

/**
 * ChatHistoryService
 * 
 * Servico centralizado para persistencia, backup e recovery do historico de chat.
 * Utiliza SQLite para armazenamento persistente e oferece funcionalidades de
 * backup automatico e manual.
 */
export class ChatHistoryService {
  private repo: Repository<ChatHistory>;
  private backupDir: string;
  private autoBackupInterval: NodeJS.Timeout | null = null;

  constructor(private dataSource: DataSource) {
    this.repo = dataSource.getRepository(ChatHistory);
    this.backupDir = path.join(os.homedir(), '.thinkcoffee', 'backups', 'chat');
    this.ensureBackupDir();
  }

  private ensureBackupDir(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Gera um ID unico para o historico baseado no canal
   */
  private generateHistoryId(channel: string, pipelineId?: string): string {
    const base = pipelineId ? `pipeline-${pipelineId}` : channel;
    return `history-${base}`;
  }

  /**
   * Salva ou atualiza o historico de chat
   */
  async saveHistory(input: SaveHistoryInput): Promise<ChatHistory> {
    const id = this.generateHistoryId(input.channel, input.pipelineId);
    
    let history = await this.repo.findOne({ where: { id } });
    
    if (history) {
      history.messages = input.messages;
      history.messageCount = input.messages.length;
      history.updatedAt = new Date();
    } else {
      history = this.repo.create({
        id,
        projectId: input.projectId,
        pipelineId: input.pipelineId,
        channel: input.channel,
        workspace: input.workspace,
        messages: input.messages,
        messageCount: input.messages.length,
      });
    }

    return this.repo.save(history);
  }

  /**
   * Adiciona uma mensagem ao historico existente
   */
  async appendMessage(channel: string, message: ChatMessage, pipelineId?: string): Promise<ChatHistory> {
    const id = this.generateHistoryId(channel, pipelineId);
    let history = await this.repo.findOne({ where: { id } });

    if (!history) {
      history = this.repo.create({
        id,
        channel,
        pipelineId,
        workspace: '',
        messages: [message],
        messageCount: 1,
      });
    } else {
      history.messages.push(message);
      history.messageCount = history.messages.length;
    }

    return this.repo.save(history);
  }

  /**
   * Recupera historico por ID
   */
  async getHistoryById(id: string): Promise<ChatHistory | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * Recupera historico por canal
   */
  async getHistoryByChannel(channel: string): Promise<ChatHistory | null> {
    return this.repo.findOne({ where: { channel } });
  }

  /**
   * Recupera historico por pipeline
   */
  async getHistoryByPipeline(pipelineId: string): Promise<ChatHistory | null> {
    const id = this.generateHistoryId(`pipeline-${pipelineId}`, pipelineId);
    return this.repo.findOne({ where: { id } });
  }

  /**
   * Lista historicos com filtros
   */
  async listHistories(filter: HistoryFilter = {}): Promise<ChatHistory[]> {
    const query = this.repo.createQueryBuilder('history');

    if (filter.projectId) {
      query.andWhere('history.projectId = :projectId', { projectId: filter.projectId });
    }

    if (filter.pipelineId) {
      query.andWhere('history.pipelineId = :pipelineId', { pipelineId: filter.pipelineId });
    }

    if (filter.channel) {
      query.andWhere('history.channel = :channel', { channel: filter.channel });
    }

    if (filter.workspace) {
      query.andWhere('history.workspace = :workspace', { workspace: filter.workspace });
    }

    if (filter.fromDate) {
      query.andWhere('history.createdAt >= :fromDate', { fromDate: filter.fromDate });
    }

    if (filter.toDate) {
      query.andWhere('history.createdAt <= :toDate', { toDate: filter.toDate });
    }

    query.orderBy('history.updatedAt', 'DESC');

    if (filter.limit) {
      query.take(filter.limit);
    }

    if (filter.offset) {
      query.skip(filter.offset);
    }

    return query.getMany();
  }

  /**
   * Deleta historico por ID
   */
  async deleteHistory(id: string): Promise<boolean> {
    const result = await this.repo.delete({ id });
    return (result.affected || 0) > 0;
  }

  /**
   * Deleta historico por pipeline
   */
  async deleteHistoryByPipeline(pipelineId: string): Promise<boolean> {
    const result = await this.repo.delete({ pipelineId });
    return (result.affected || 0) > 0;
  }

  /**
   * Limpa mensagens de um historico mantendo o registro
   */
  async clearMessages(id: string): Promise<ChatHistory | null> {
    const history = await this.repo.findOne({ where: { id } });
    if (!history) return null;

    history.messages = [];
    history.messageCount = 0;
    return this.repo.save(history);
  }

  // ─── Backup & Recovery ─────────────────────────────────────

  /**
   * Cria backup de um historico especifico
   */
  async createBackup(historyId: string): Promise<BackupInfo | null> {
    const history = await this.repo.findOne({ where: { id: historyId } });
    if (!history) return null;

    const timestamp = new Date();
    const safeId = historyId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `backup_${safeId}_${timestamp.toISOString().replace(/[:.]/g, '-')}.json`;
    const filePath = path.join(this.backupDir, fileName);

    const backupData = {
      id: history.id,
      projectId: history.projectId,
      pipelineId: history.pipelineId,
      channel: history.channel,
      workspace: history.workspace,
      messages: history.messages,
      messageCount: history.messageCount,
      createdAt: history.createdAt,
      updatedAt: history.updatedAt,
      backupTimestamp: timestamp.toISOString(),
    };

    fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf-8');

    // Atualiza timestamp do ultimo backup
    history.lastBackup = timestamp.toISOString();
    await this.repo.save(history);

    return {
      id: historyId,
      file: fileName,
      path: filePath,
      timestamp,
      messageCount: history.messageCount,
      channel: history.channel,
      pipelineId: history.pipelineId,
    };
  }

  /**
   * Cria backup de todos os historicos
   */
  async createFullBackup(): Promise<BackupInfo[]> {
    const histories = await this.repo.find();
    const backups: BackupInfo[] = [];

    for (const history of histories) {
      const backup = await this.createBackup(history.id);
      if (backup) {
        backups.push(backup);
      }
    }

    return backups;
  }

  /**
   * Lista todos os backups disponiveis
   */
  listBackups(pipelineId?: string): BackupInfo[] {
    if (!fs.existsSync(this.backupDir)) return [];

    const files = fs.readdirSync(this.backupDir);
    const backups: BackupInfo[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const filePath = path.join(this.backupDir, file);
      
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);

        if (pipelineId && data.pipelineId !== pipelineId) continue;

        backups.push({
          id: data.id,
          file,
          path: filePath,
          timestamp: new Date(data.backupTimestamp),
          messageCount: data.messageCount || data.messages?.length || 0,
          channel: data.channel,
          pipelineId: data.pipelineId,
        });
      } catch (err) {
        console.error(`[ChatHistoryService] Erro ao ler backup ${file}:`, err);
      }
    }

    return backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Recupera historico de um arquivo de backup
   */
  async restoreFromBackup(backupPath: string): Promise<RecoveryResult> {
    try {
      if (!fs.existsSync(backupPath)) {
        return { success: false, messagesRestored: 0, error: 'Arquivo de backup nao encontrado' };
      }

      const content = fs.readFileSync(backupPath, 'utf-8');
      const data = JSON.parse(content);

      const history = await this.saveHistory({
        projectId: data.projectId,
        pipelineId: data.pipelineId,
        channel: data.channel,
        workspace: data.workspace,
        messages: data.messages,
      });

      return {
        success: true,
        messagesRestored: history.messageCount,
      };
    } catch (err: any) {
      return {
        success: false,
        messagesRestored: 0,
        error: err.message,
      };
    }
  }

  /**
   * Recupera historico do ultimo backup disponivel
   */
  async restoreLatestBackup(pipelineId?: string): Promise<RecoveryResult> {
    const backups = this.listBackups(pipelineId);
    if (backups.length === 0) {
      return { success: false, messagesRestored: 0, error: 'Nenhum backup encontrado' };
    }

    return this.restoreFromBackup(backups[0].path);
  }

  /**
   * Deleta backups antigos (mais velhos que X dias)
   */
  cleanupOldBackups(daysOld: number = 30): number {
    if (!fs.existsSync(this.backupDir)) return 0;

    const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    const files = fs.readdirSync(this.backupDir);
    let deleted = 0;

    for (const file of files) {
      const filePath = path.join(this.backupDir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    }

    return deleted;
  }

  // ─── Sincronizacao com arquivos JSONL ─────────────────────

  /**
   * Importa historico de um arquivo JSONL (formato do ChatService original)
   */
  async importFromJsonl(filePath: string, channel: string, pipelineId?: string): Promise<RecoveryResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, messagesRestored: 0, error: 'Arquivo JSONL nao encontrado' };
      }

      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (!content) {
        return { success: true, messagesRestored: 0 };
      }

      const messages: ChatMessage[] = [];
      const lines = content.split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          messages.push(JSON.parse(line) as ChatMessage);
        } catch (err) {
          console.error(`[ChatHistoryService] Erro ao parsear linha JSONL:`, err);
        }
      }

      const history = await this.saveHistory({
        channel,
        pipelineId,
        workspace: path.dirname(filePath),
        messages,
      });

      return {
        success: true,
        messagesRestored: history.messageCount,
      };
    } catch (err: any) {
      return {
        success: false,
        messagesRestored: 0,
        error: err.message,
      };
    }
  }

  /**
   * Exporta historico para arquivo JSONL
   */
  async exportToJsonl(historyId: string, outputPath: string): Promise<boolean> {
    const history = await this.repo.findOne({ where: { id: historyId } });
    if (!history) return false;

    const content = history.messages.map(m => JSON.stringify(m)).join('\n');
    fs.writeFileSync(outputPath, content + '\n', 'utf-8');
    return true;
  }

  /**
   * Sincroniza historico do banco com arquivo JSONL existente
   * Util para manter compatibilidade com o ChatService original
   */
  async syncWithJsonl(channel: string, pipelineId?: string): Promise<RecoveryResult> {
    const chatDir = path.join(os.homedir(), '.thinkcoffee', 'chat');
    const safe = channel.replace(/[^a-zA-Z0-9_-]/g, '_');
    const jsonlPath = path.join(chatDir, `${safe}.jsonl`);

    if (!fs.existsSync(jsonlPath)) {
      // Nao ha arquivo para sincronizar, exporta do banco se existir
      const history = await this.getHistoryByChannel(channel);
      if (history && history.messages.length > 0) {
        await this.exportToJsonl(history.id, jsonlPath);
      }
      return { success: true, messagesRestored: 0 };
    }

    return this.importFromJsonl(jsonlPath, channel, pipelineId);
  }

  // ─── Auto-backup ───────────────────────────────────────────

  /**
   * Inicia backup automatico em intervalo especificado
   */
  startAutoBackup(intervalMinutes: number = 30): void {
    if (this.autoBackupInterval) {
      clearInterval(this.autoBackupInterval);
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    
    this.autoBackupInterval = setInterval(async () => {
      try {
        const backups = await this.createFullBackup();
        console.log(`[ChatHistoryService] Auto-backup criado: ${backups.length} historicos salvos`);
        
        // Limpa backups antigos (mais de 7 dias por padrao)
        const deleted = this.cleanupOldBackups(7);
        if (deleted > 0) {
          console.log(`[ChatHistoryService] ${deleted} backups antigos removidos`);
        }
      } catch (err) {
        console.error('[ChatHistoryService] Erro no auto-backup:', err);
      }
    }, intervalMs);

    console.log(`[ChatHistoryService] Auto-backup iniciado (intervalo: ${intervalMinutes} min)`);
  }

  /**
   * Para o backup automatico
   */
  stopAutoBackup(): void {
    if (this.autoBackupInterval) {
      clearInterval(this.autoBackupInterval);
      this.autoBackupInterval = null;
      console.log('[ChatHistoryService] Auto-backup parado');
    }
  }

  // ─── Estatisticas ──────────────────────────────────────────

  /**
   * Obtem estatisticas gerais do historico
   */
  async getStats(): Promise<{
    totalHistories: number;
    totalMessages: number;
    totalBackups: number;
    oldestHistory: Date | null;
    newestHistory: Date | null;
  }> {
    const histories = await this.repo.find();
    const backups = this.listBackups();

    const totalMessages = histories.reduce((sum, h) => sum + h.messageCount, 0);
    const dates = histories.map(h => h.createdAt).sort((a, b) => a.getTime() - b.getTime());

    return {
      totalHistories: histories.length,
      totalMessages,
      totalBackups: backups.length,
      oldestHistory: dates[0] || null,
      newestHistory: dates[dates.length - 1] || null,
    };
  }
}
