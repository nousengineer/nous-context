import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export interface ChatMessage {
  id: string;
  timestamp: string;
  sender: 'programmer' | 'claude' | 'copilot' | 'github-cli' | 'terminal' | 'system';
  senderLabel?: string;
  content: string;
  /** Optional: which project this relates to */
  projectId?: string;
  /** Message type for filtering */
  type: 'request' | 'response' | 'info' | 'error' | 'code';
  /** If this is a response, which message ID it replies to */
  replyTo?: string;
  /** Whether external AIs have seen this message */
  read?: boolean;
}

function getChatDir(): string {
  const dir = path.join(os.homedir(), '.thinkcoffee', 'chat');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getChatFile(channel: string): string {
  const safe = channel.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getChatDir(), `${safe}.jsonl`);
}

export class ChatService {
  private filePath: string;

  constructor(channel: string = 'default') {
    this.filePath = getChatFile(channel);
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '', 'utf-8');
    }
  }

  send(msg: Omit<ChatMessage, 'id' | 'timestamp'>): ChatMessage {
    const full: ChatMessage = {
      ...msg,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    fs.appendFileSync(this.filePath, JSON.stringify(full) + '\n', 'utf-8');
    return full;
  }

  getHistory(limit?: number): ChatMessage[] {
    if (!fs.existsSync(this.filePath)) return [];
    const raw = fs.readFileSync(this.filePath, 'utf-8').trim();
    if (!raw) return [];
    const lines = raw.split('\n');
    const msgs = lines
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) as ChatMessage; } catch { return null; } })
      .filter((m): m is ChatMessage => m !== null);
    return limit ? msgs.slice(-limit) : msgs;
  }

  getUnread(): ChatMessage[] {
    return this.getHistory().filter(m =>
      m.sender === 'programmer' && m.type === 'request' && !m.read
    );
  }

  markRead(messageId: string): void {
    const msgs = this.getHistory();
    const updated = msgs.map(m => m.id === messageId ? { ...m, read: true } : m);
    fs.writeFileSync(this.filePath, updated.map(m => JSON.stringify(m)).join('\n') + '\n', 'utf-8');
  }

  markAllRead(): void {
    const msgs = this.getHistory();
    const updated = msgs.map(m => m.sender === 'programmer' && !m.read ? { ...m, read: true } : m);
    fs.writeFileSync(this.filePath, updated.map(m => JSON.stringify(m)).join('\n') + '\n', 'utf-8');
  }

  clear(): void {
    fs.writeFileSync(this.filePath, '', 'utf-8');
  }

  /** Watch for new messages (returns close function) */
  watch(callback: (msgs: ChatMessage[]) => void): () => void {
    let lastSize = 0;
    try { lastSize = fs.statSync(this.filePath).size; } catch {}

    const watcher = fs.watchFile(this.filePath, { interval: 500 }, (curr) => {
      if (curr.size > lastSize) {
        lastSize = curr.size;
        callback(this.getHistory());
      }
    });

    return () => fs.unwatchFile(this.filePath);
  }

  getFilePath(): string {
    return this.filePath;
  }
}
