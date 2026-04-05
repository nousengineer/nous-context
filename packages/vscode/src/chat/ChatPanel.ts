import * as vscode from 'vscode';
import { ChatService } from '@thinkcoffee/core';
import type { ChatMessage } from '@thinkcoffee/core';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _chat: ChatService;
  private _disposables: vscode.Disposable[] = [];
  private _stopWatch: (() => void) | null = null;

  private constructor(panel: vscode.WebviewPanel, chat: ChatService) {
    this._panel = panel;
    this._chat = chat;

    this._panel.webview.html = this._getHtml();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from webview
    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.command) {
          case 'send':
            await this._handleUserMessage(msg.text);
            break;
          case 'clear':
            this._chat.clear();
            this._sendMessages();
            break;
          case 'ready':
            this._sendMessages();
            break;
        }
      },
      null,
      this._disposables
    );

    // Watch for external messages (from Claude Desktop or other AIs)
    this._stopWatch = this._chat.watch(() => {
      this._sendMessages();
    });
  }

  public static create(extensionUri: vscode.Uri, chat: ChatService) {
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'thinkcoffeeChat',
      'ThinkCoffee Chat',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    ChatPanel.currentPanel = new ChatPanel(panel, chat);
  }

  private _sendMessages() {
    const msgs = this._chat.getHistory(100);
    this._panel.webview.postMessage({ command: 'messages', data: msgs });
  }

  private async _handleUserMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    // @agent routing
    if (trimmed.startsWith('@gh ')) {
      await this._handleGitHub(trimmed.slice(4));
    } else if (trimmed.startsWith('@terminal ')) {
      await this._handleTerminal(trimmed.slice(10));
    } else if (trimmed.startsWith('@files ')) {
      await this._handleFiles(trimmed.slice(7));
    } else if (trimmed.startsWith('@context ')) {
      await this._handleContext(trimmed.slice(9));
    } else {
      // Regular message — programmer request to AIs
      this._chat.send({
        sender: 'programmer',
        senderLabel: 'You',
        content: trimmed,
        type: 'request',
      });
      this._sendMessages();
    }
  }

  private async _handleGitHub(input: string) {
    this._chat.send({ sender: 'programmer', senderLabel: 'You', content: `@gh ${input}`, type: 'request' });
    this._sendMessages();

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    try {
      // Route gh commands
      let cmd: string;
      if (input.startsWith('suggest ')) {
        cmd = `gh copilot suggest "${input.slice(8).replace(/"/g, '\\"')}" --shell-out 2>&1`;
      } else if (input.startsWith('explain ')) {
        cmd = `gh copilot explain "${input.slice(8).replace(/"/g, '\\"')}" 2>&1`;
      } else if (input.startsWith('pr ') || input.startsWith('issue ') || input.startsWith('repo ')) {
        cmd = `gh ${input} 2>&1`;
      } else {
        cmd = `gh ${input} 2>&1`;
      }

      const output = execSync(cmd, { cwd: root, encoding: 'utf-8', timeout: 30000 });
      this._chat.send({
        sender: 'github-cli',
        senderLabel: 'GitHub CLI',
        content: `\`gh ${input}\`\n\n\`\`\`\n${output.trim()}\n\`\`\``,
        type: 'response',
      });
    } catch (e: any) {
      const errMsg = e.stderr || e.stdout || e.message;
      this._chat.send({
        sender: 'github-cli',
        senderLabel: 'GitHub CLI',
        content: `Command failed: \`gh ${input}\`\n\n\`\`\`\n${errMsg}\n\`\`\``,
        type: 'error',
      });
    }
    this._sendMessages();
  }

  private async _handleTerminal(input: string) {
    this._chat.send({ sender: 'programmer', senderLabel: 'You', content: `@terminal ${input}`, type: 'request' });
    this._sendMessages();

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    try {
      const output = execSync(input, { cwd: root, encoding: 'utf-8', timeout: 30000, shell: 'powershell.exe' });
      this._chat.send({
        sender: 'terminal',
        senderLabel: 'Terminal',
        content: `\`${input}\`\n\n\`\`\`\n${output.trim() || '(no output)'}\n\`\`\``,
        type: 'code',
      });
    } catch (e: any) {
      this._chat.send({
        sender: 'terminal',
        senderLabel: 'Terminal',
        content: `Failed: \`${input}\`\n\n\`\`\`\n${e.stderr || e.message}\n\`\`\``,
        type: 'error',
      });
    }
    this._sendMessages();
  }

  private async _handleFiles(input: string) {
    this._chat.send({ sender: 'programmer', senderLabel: 'You', content: `@files ${input}`, type: 'request' });
    this._sendMessages();

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      this._chat.send({ sender: 'system', content: 'No workspace folder open.', type: 'error' });
      this._sendMessages();
      return;
    }

    try {
      const parts = input.split(' ');
      const action = parts[0];
      const filePath = parts.slice(1).join(' ');

      if (action === 'read' && filePath) {
        const abs = path.resolve(root, filePath);
        if (!abs.startsWith(root)) throw new Error('Path traversal denied');
        const content = fs.readFileSync(abs, 'utf-8');
        const lines = content.split('\n');
        const preview = lines.length > 100
          ? lines.slice(0, 100).join('\n') + `\n... (${lines.length - 100} more lines)`
          : content;
        this._chat.send({
          sender: 'system',
          senderLabel: 'Files',
          content: `**${filePath}** (${lines.length} lines)\n\n\`\`\`\n${preview}\n\`\`\``,
          type: 'response',
        });
      } else if (action === 'list') {
        const target = filePath ? path.resolve(root, filePath) : root;
        const entries = fs.readdirSync(target, { withFileTypes: true });
        const list = entries
          .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
          .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
          .map(e => e.isDirectory() ? `${e.name}/` : e.name)
          .join('\n');
        this._chat.send({
          sender: 'system',
          senderLabel: 'Files',
          content: `**${filePath || '.'}**\n\n\`\`\`\n${list}\n\`\`\``,
          type: 'response',
        });
      } else {
        this._chat.send({
          sender: 'system',
          senderLabel: 'Files',
          content: 'Usage: `@files read <path>` or `@files list [path]`',
          type: 'info',
        });
      }
    } catch (e: any) {
      this._chat.send({ sender: 'system', senderLabel: 'Files', content: `Error: ${e.message}`, type: 'error' });
    }
    this._sendMessages();
  }

  private async _handleContext(input: string) {
    // This just posts the message — the user can query context via the ThinkCoffee sidebar
    this._chat.send({ sender: 'programmer', senderLabel: 'You', content: `@context ${input}`, type: 'request' });
    this._chat.send({
      sender: 'system',
      senderLabel: 'ThinkCoffee',
      content: 'Use the ThinkCoffee sidebar or CLI to manage context. This message is visible to all connected AIs.',
      type: 'info',
    });
    this._sendMessages();
  }

  dispose() {
    ChatPanel.currentPanel = undefined;
    if (this._stopWatch) this._stopWatch();
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }

  private _getHtml(): string {
    return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    flex-shrink: 0;
  }

  .header h2 { font-size: 14px; font-weight: 600; }

  .header button {
    background: transparent;
    border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
    color: var(--vscode-foreground);
    padding: 3px 8px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
  }
  .header button:hover { background: var(--vscode-toolbar-hoverBackground); }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
  }

  .msg {
    margin-bottom: 12px;
    animation: fadeIn 0.15s ease-in;
  }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

  .msg-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 3px;
  }

  .sender {
    font-weight: 600;
    font-size: 12px;
  }

  .sender.programmer { color: var(--vscode-terminal-ansiCyan); }
  .sender.claude { color: var(--vscode-terminal-ansiMagenta); }
  .sender.copilot { color: var(--vscode-terminal-ansiBlue); }
  .sender.github-cli { color: var(--vscode-terminal-ansiGreen); }
  .sender.terminal { color: var(--vscode-terminal-ansiYellow); }
  .sender.system { color: var(--vscode-descriptionForeground); }

  .time {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
  }

  .type-badge {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 8px;
    font-weight: 500;
    text-transform: uppercase;
  }
  .type-badge.request { background: var(--vscode-terminal-ansiCyan); color: #000; }
  .type-badge.response { background: var(--vscode-terminal-ansiGreen); color: #000; }
  .type-badge.code { background: var(--vscode-terminal-ansiYellow); color: #000; }
  .type-badge.error { background: var(--vscode-terminal-ansiRed); color: #fff; }
  .type-badge.info { background: var(--vscode-descriptionForeground); color: var(--vscode-editor-background); }

  .msg-body {
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .msg-body code {
    font-family: var(--vscode-editor-font-family, monospace);
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 12px;
  }

  .msg-body pre {
    margin: 6px 0;
    padding: 8px;
    background: var(--vscode-textCodeBlock-background);
    border-radius: 4px;
    overflow-x: auto;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    line-height: 1.4;
  }

  .msg.programmer .msg-body {
    background: color-mix(in srgb, var(--vscode-terminal-ansiCyan) 8%, transparent);
    border-color: color-mix(in srgb, var(--vscode-terminal-ansiCyan) 30%, transparent);
  }

  .input-area {
    display: flex;
    gap: 6px;
    padding: 8px 12px;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    flex-shrink: 0;
  }

  .input-area textarea {
    flex: 1;
    resize: none;
    border: 1px solid var(--vscode-input-border);
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    padding: 6px 10px;
    border-radius: 4px;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 13px;
    outline: none;
    min-height: 36px;
    max-height: 120px;
  }

  .input-area textarea:focus { border-color: var(--vscode-focusBorder); }

  .input-area button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    align-self: flex-end;
  }
  .input-area button:hover { background: var(--vscode-button-hoverBackground); }

  .hints {
    padding: 4px 12px 6px;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-sideBar-background);
    flex-shrink: 0;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--vscode-descriptionForeground);
    gap: 8px;
    text-align: center;
    padding: 20px;
  }
  .empty h3 { font-size: 16px; color: var(--vscode-foreground); }
</style>
</head>
<body>
  <div class="header">
    <h2>ThinkCoffee Chat</h2>
    <button id="clearBtn" title="Clear chat history">Clear</button>
  </div>

  <div class="messages" id="messages">
    <div class="empty" id="emptyState">
      <h3>ThinkCoffee AI Chat</h3>
      <p>Type a message to request code changes, ask questions,<br>or coordinate with connected AIs.</p>
      <p style="margin-top: 8px; font-size: 11px;">
        <strong>@gh</strong> GitHub CLI &nbsp;|&nbsp;
        <strong>@terminal</strong> Run command &nbsp;|&nbsp;
        <strong>@files</strong> Read/list files
      </p>
    </div>
  </div>

  <div class="hints">
    <strong>@gh</strong> suggest/explain/pr/issue &nbsp;&bull;&nbsp;
    <strong>@terminal</strong> &lt;command&gt; &nbsp;&bull;&nbsp;
    <strong>@files</strong> read/list &lt;path&gt; &nbsp;&bull;&nbsp;
    Enter to send, Shift+Enter for newline
  </div>

  <div class="input-area">
    <textarea id="input" placeholder="Ask the AIs to code something..." rows="1"></textarea>
    <button id="sendBtn">Send</button>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById('messages');
  const emptyEl = document.getElementById('emptyState');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('sendBtn');
  const clearBtn = document.getElementById('clearBtn');

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderMarkdown(text) {
    let html = escapeHtml(text);
    // Code blocks
    html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, (_, code) => '<pre>' + code.trim() + '</pre>');
    // Inline code
    html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    return html;
  }

  function renderMessages(msgs) {
    if (!msgs.length) {
      emptyEl.style.display = 'flex';
      return;
    }
    emptyEl.style.display = 'none';

    // Keep only message elements
    const existing = messagesEl.querySelectorAll('.msg');
    const existingIds = new Set();
    existing.forEach(el => existingIds.add(el.dataset.id));

    for (const m of msgs) {
      if (existingIds.has(m.id)) continue;

      const div = document.createElement('div');
      div.className = 'msg ' + m.sender;
      div.dataset.id = m.id;
      div.innerHTML =
        '<div class="msg-header">' +
          '<span class="sender ' + m.sender + '">' + escapeHtml(m.senderLabel || m.sender) + '</span>' +
          '<span class="type-badge ' + m.type + '">' + m.type + '</span>' +
          '<span class="time">' + new Date(m.timestamp).toLocaleTimeString() + '</span>' +
        '</div>' +
        '<div class="msg-body">' + renderMarkdown(m.content) + '</div>';
      messagesEl.appendChild(div);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function send() {
    const text = inputEl.value.trim();
    if (!text) return;
    vscode.postMessage({ command: 'send', text });
    inputEl.value = '';
    inputEl.style.height = '36px';
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = '36px';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });
  clearBtn.addEventListener('click', () => {
    messagesEl.querySelectorAll('.msg').forEach(el => el.remove());
    emptyEl.style.display = 'flex';
    vscode.postMessage({ command: 'clear' });
  });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.command === 'messages') renderMessages(msg.data);
  });

  // Request initial messages
  vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
  }
}
