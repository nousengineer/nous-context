import * as vscode from 'vscode';

interface ChatOutboundMessage {
  type: 'chat:status' | 'chat:assistant' | 'chat:error' | 'chat:new-chat' | 'chat:load-history';
  text?: string;
  chatId?: string;
}

export class ChatSidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'thinkcoffee.chat';
  private view?: vscode.WebviewView;

  postStatus(text: string): void {
    this.postToWebview({ type: 'chat:status', text });
  }

  postAssistant(text: string): void {
    this.postToWebview({ type: 'chat:assistant', text });
  }

  postError(text: string): void {
    this.postToWebview({ type: 'chat:error', text });
  }

  postNewChat(title: string, chatId?: string): void {
    this.postToWebview({ type: 'chat:new-chat', text: title, chatId });
  }

  postLoadHistory(historyJson: string): void {
    this.postToWebview({ type: 'chat:load-history', text: historyJson });
  }

  private postToWebview(message: ChatOutboundMessage): void {
    if (!this.view) {
      return;
    }
    void this.view.webview.postMessage(message);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;

    view.webview.options = {
      enableScripts: true,
    };

    view.webview.onDidReceiveMessage(async message => {
      if (message?.type !== 'ask') {
        return;
      }
      await vscode.commands.executeCommand('thinkcoffee.chat.ask', message);
    });

    const nonce = getNonce();

    view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ThinkCoffee Chat</title>
<style>
* {
  box-sizing: border-box;
}
body {
  font-family: var(--vscode-font-family);
  color: var(--vscode-editor-foreground);
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 0;
}
.history-section {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 8px;
  border-bottom: 1px solid var(--vscode-input-border);
  overflow-y: auto;
  max-height: 30%;
  flex-shrink: 0;
}
.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--vscode-input-border) 50%, transparent);
}
.history-header h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.new-chat-btn {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: 0;
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.new-chat-btn:hover {
  background: var(--vscode-button-hoverBackground);
}
.chat-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
}
.chat-item {
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--vscode-input-foreground);
  transition: all 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.chat-item:hover {
  background: var(--vscode-list-hoverBackground);
}
.chat-item.active {
  background: color-mix(in srgb, var(--vscode-button-background) 25%, transparent);
  border-color: var(--vscode-focusBorder);
  font-weight: 500;
}
.chat-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-item-delete {
  background: transparent;
  border: 0;
  color: var(--vscode-errorForeground);
  cursor: pointer;
  font-size: 10px;
  padding: 0 4px;
  opacity: 0;
  transition: opacity 0.15s;
}
.chat-item:hover .chat-item-delete {
  opacity: 1;
}
.chat-item-delete:hover {
  opacity: 1 !important;
}
.chat-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  flex: 1;
  overflow: hidden;
}
.messages {
  flex: 1;
  overflow-y: auto;
  border: 1px solid var(--vscode-input-border);
  border-radius: 10px;
  padding: 10px;
  background: var(--vscode-editor-background);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.messages.empty {
  justify-content: center;
  align-items: center;
  color: var(--vscode-input-placeholder-foreground);
  font-size: 12px;
}
.msg {
  max-width: 92%;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg.user {
  align-self: flex-end;
  background: color-mix(in srgb, var(--vscode-button-background) 22%, transparent);
  border: 1px solid color-mix(in srgb, var(--vscode-button-background) 45%, transparent);
}
.msg.assistant {
  align-self: flex-start;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
}
.msg.error {
  align-self: flex-start;
  background: color-mix(in srgb, #b00020 16%, transparent);
  border: 1px solid color-mix(in srgb, #b00020 30%, transparent);
}
.status {
  font-size: 11px;
  opacity: 0.8;
  padding-left: 2px;
}
.composer {
  border: 1px solid var(--vscode-focusBorder);
  border-radius: 12px;
  background: var(--vscode-editor-background);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}
.prompt {
  width: 100%;
  min-height: 56px;
  max-height: 120px;
  resize: vertical;
  box-sizing: border-box;
  background: transparent;
  color: var(--vscode-input-foreground);
  border: 0;
  outline: none;
  font-size: 13px;
  line-height: 1.4;
  font-family: var(--vscode-font-family);
}
.toolbar {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  gap: 6px;
  align-items: center;
}
.tool-btn {
  border: 1px solid var(--vscode-input-border);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border-radius: 7px;
  padding: 5px 8px;
  cursor: pointer;
  font-size: 13px;
}
.tool-btn:hover {
  background: var(--vscode-list-hoverBackground);
}
.tool-btn.active {
  border-color: var(--vscode-focusBorder);
}
.mode {
  font-size: 12px;
  opacity: 0.85;
  padding-left: 2px;
}
.send-btn {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: 0;
  border-radius: 999px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.send-btn:hover {
  background: var(--vscode-button-hoverBackground);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  font-size: 11px;
  border: 1px solid var(--vscode-input-border);
  border-radius: 999px;
  padding: 3px 8px;
  background: var(--vscode-input-background);
}
.hint {
  font-size: 11px;
  opacity: 0.75;
  line-height: 1.4;
}
</style>
</head>
<body>
<div class="sidebar">
  <!-- History Section -->
  <div class="history-section">
    <div class="history-header">
      <h3>History</h3>
      <button id="newChatBtn" class="new-chat-btn" type="button">New</button>
    </div>
    <ul id="chatList" class="chat-list"></ul>
  </div>

  <!-- Chat Section -->
  <div class="chat-section">
    <div id="messages" class="messages empty">
      <span>Start a new conversation</span>
    </div>
    <div id="status" class="status">PM ready.</div>
    <div class="composer">
      <textarea id="chatPrompt" class="prompt" placeholder="Describe what to build"></textarea>
      <div id="chips" class="chips"></div>
      <div class="toolbar">
        <button id="attachEditorBtn" class="tool-btn" type="button">+ File</button>
        <button id="clearImagesBtn" class="tool-btn" type="button">Image</button>
        <div class="mode">Auto</div>
        <button id="sendBtn" class="send-btn" type="button" title="Send">^</button>
      </div>
    </div>
    <div class="hint">
      PM executes commands automatically. Paste image in the composer or toggle + File to include the active editor file.
    </div>
  </div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const input = document.getElementById('chatPrompt');
const send = document.getElementById('sendBtn');
const attachEditorBtn = document.getElementById('attachEditorBtn');
const clearImagesBtn = document.getElementById('clearImagesBtn');
const chips = document.getElementById('chips');
const messagesEl = document.getElementById('messages');
const statusEl = document.getElementById('status');
const chatListEl = document.getElementById('chatList');
const newChatBtn = document.getElementById('newChatBtn');

let includeActiveEditor = false;
let images = [];
let chats = {};
let currentChatId = null;

// Initialize chats from localStorage
function initializeChats() {
  const stored = localStorage.getItem('thinkcoffee:chats');
  chats = stored ? JSON.parse(stored) : {};
  
  const storedCurrentId = localStorage.getItem('thinkcoffee:currentChatId');
  if (storedCurrentId && chats[storedCurrentId]) {
    currentChatId = storedCurrentId;
  }
  
  if (!currentChatId) {
    createNewChat();
  }
  
  renderChatList();
  loadCurrentChat();
}

function saveChats() {
  localStorage.setItem('thinkcoffee:chats', JSON.stringify(chats));
  localStorage.setItem('thinkcoffee:currentChatId', currentChatId || '');
}

function generateChatId() {
  return 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function createNewChat() {
  const chatId = generateChatId();
  const title = new Date().toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  chats[chatId] = {
    id: chatId,
    title: title,
    messages: [],
    createdAt: Date.now(),
  };
  
  currentChatId = chatId;
  saveChats();
  renderChatList();
  loadCurrentChat();
}

function deleteChat(chatId) {
  if (Object.keys(chats).length <= 1) {
    alert('Cannot delete the last chat');
    return;
  }
  
  delete chats[chatId];
  
  if (currentChatId === chatId) {
    const remaining = Object.keys(chats)[0];
    currentChatId = remaining;
  }
  
  saveChats();
  renderChatList();
  loadCurrentChat();
}

function loadCurrentChat() {
  if (!currentChatId || !chats[currentChatId]) {
    return;
  }
  
  const chat = chats[currentChatId];
  messagesEl.innerHTML = '';
  
  if (chat.messages.length === 0) {
    messagesEl.className = 'messages empty';
    messagesEl.innerHTML = '<span>Start a new conversation</span>';
  } else {
    messagesEl.className = 'messages';
    for (const msg of chat.messages) {
      const el = document.createElement('div');
      el.className = 'msg ' + msg.role;
      el.textContent = msg.text;
      messagesEl.appendChild(el);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function renderChatList() {
  chatListEl.innerHTML = '';
  
  const sortedChats = Object.values(chats).sort((a, b) => b.createdAt - a.createdAt);
  
  for (const chat of sortedChats) {
    const li = document.createElement('li');
    li.className = 'chat-item' + (chat.id === currentChatId ? ' active' : '');
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'chat-item-name';
    nameSpan.textContent = chat.title;
    nameSpan.addEventListener('click', () => {
      currentChatId = chat.id;
      saveChats();
      renderChatList();
      loadCurrentChat();
    });
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'chat-item-delete';
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChat(chat.id);
    });
    
    li.appendChild(nameSpan);
    li.appendChild(deleteBtn);
    chatListEl.appendChild(li);
  }
}

function addMessageToCurrentChat(role, text) {
  if (!currentChatId || !chats[currentChatId]) {
    return;
  }
  
  chats[currentChatId].messages.push({ role, text });
  saveChats();
  loadCurrentChat();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderChips() {
  const parts = [];
  if (includeActiveEditor) {
    parts.push('<span class="chip">Active editor file</span>');
  }
  for (const img of images) {
    parts.push('<span class="chip">Image: ' + escapeHtml(img.name || 'clipboard') + '</span>');
  }
  chips.innerHTML = parts.join('');
  attachEditorBtn.classList.toggle('active', includeActiveEditor);
}

function setImages(next) {
  images = next.slice(0, 5);
  renderChips();
}

function setStatus(text) {
  statusEl.textContent = text;
}

function buildUserPreview(prompt, includeFile, imageCount) {
  const lines = [];
  if (prompt) {
    lines.push(prompt);
  }
  if (includeFile || imageCount > 0) {
    const flags = [];
    if (includeFile) flags.push('active editor file');
    if (imageCount > 0) flags.push(imageCount + ' image' + (imageCount > 1 ? 's' : ''));
    lines.push('Attachments: ' + flags.join(', '));
  }
  return lines.join('\n');
}

function submitPrompt() {
  const prompt = (input.value || '').trim();
  if (!prompt && !includeActiveEditor && images.length === 0) {
    return;
  }

  const userPreview = buildUserPreview(prompt, includeActiveEditor, images.length);
  addMessageToCurrentChat('user', userPreview);
  setStatus('PM thinking...');

  vscode.postMessage({
    type: 'ask',
    prompt,
    includeActiveEditor,
    images,
  });

  input.value = '';
  setImages([]);
  input.focus();
}

newChatBtn.addEventListener('click', createNewChat);
send.addEventListener('click', submitPrompt);
attachEditorBtn.addEventListener('click', () => {
  includeActiveEditor = !includeActiveEditor;
  renderChips();
});
clearImagesBtn.addEventListener('click', () => {
  setImages([]);
});

input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitPrompt();
  }
});

input.addEventListener('paste', event => {
  const clipboard = event.clipboardData;
  if (!clipboard || !clipboard.items) {
    return;
  }

  let foundImage = false;
  for (const item of clipboard.items) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) {
      continue;
    }

    const file = item.getAsFile();
    if (!file) {
      continue;
    }

    foundImage = true;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) {
        return;
      }
      setImages(images.concat([{
        name: file.name || 'pasted-image',
        mimeType: file.type || 'image/png',
        dataUrl,
      }]));
    };
    reader.readAsDataURL(file);
  }

  if (foundImage) {
    event.preventDefault();
  }
});

window.addEventListener('message', event => {
  const message = event.data;
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'chat:status' && typeof message.text === 'string') {
    setStatus(message.text);
    return;
  }

  if (message.type === 'chat:assistant' && typeof message.text === 'string') {
    addMessageToCurrentChat('assistant', message.text);
    setStatus('PM ready.');
    return;
  }

  if (message.type === 'chat:error' && typeof message.text === 'string') {
    addMessageToCurrentChat('error', message.text);
    setStatus('PM ready.');
  }
});

// Initialize on load
initializeChats();
renderChips();
</script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
