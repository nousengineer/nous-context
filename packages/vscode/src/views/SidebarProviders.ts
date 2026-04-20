import * as vscode from 'vscode';

interface ChatOutboundMessage {
  type: 'chat:status' | 'chat:assistant' | 'chat:error' | 'chat:new-chat' | 'chat:load-history';
  text?: string;
  chatId?: string;
}

export class ChatSidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'thinkcoffee.chat';
  private view?: vscode.WebviewView;
  private pendingMessages: ChatOutboundMessage[] = [];

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
      this.pendingMessages.push(message);
      return;
    }
    void this.view.webview.postMessage(message);
  }

  private flushPending(): void {
    for (const msg of this.pendingMessages) {
      if (this.view) {
        void this.view.webview.postMessage(msg);
      }
    }
    this.pendingMessages = [];
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;

    view.webview.options = { enableScripts: true };

    view.webview.onDidReceiveMessage(async message => {
      if (message?.type === 'ready') {
        this.flushPending();
        return;
      }
      if (message?.type !== 'ask') {
        return;
      }
      await vscode.commands.executeCommand('thinkcoffee.chat.ask', message);
    });

    const nonce = getNonce();

    view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:var(--vscode-font-family);
  font-size:var(--vscode-font-size);
  color:var(--vscode-foreground);
  background:var(--vscode-sideBar-background);
  height:100vh;
  display:flex;
  flex-direction:column;
  overflow:hidden;
}

/* ── SESSIONS HEADER ── */
.sessions-header{
  display:flex;align-items:center;justify-content:space-between;
  padding:8px 12px 6px;
  font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;
  color:var(--vscode-sideBarSectionHeader-foreground,var(--vscode-foreground));
  border-bottom:1px solid var(--vscode-sideBarSectionHeader-border,transparent);
  flex-shrink:0;
}
.sessions-actions{display:flex;gap:2px}
.icon-btn{
  background:transparent;border:0;color:var(--vscode-icon-foreground,var(--vscode-foreground));
  width:22px;height:22px;border-radius:4px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;font-size:14px;
}
.icon-btn:hover{background:var(--vscode-toolbar-hoverBackground)}

/* ── SESSION LIST ── */
.session-list{
  flex:1;overflow-y:auto;padding:2px 0;
  min-height:0;
}
.session-item{
  display:flex;align-items:flex-start;gap:8px;
  padding:6px 12px;cursor:pointer;
  border-left:2px solid transparent;
}
.session-item:hover{background:var(--vscode-list-hoverBackground)}
.session-item.active{
  background:var(--vscode-list-activeSelectionBackground);
  color:var(--vscode-list-activeSelectionForeground);
  border-left-color:var(--vscode-focusBorder);
}
.session-dot{
  width:6px;height:6px;border-radius:50%;
  margin-top:5px;flex-shrink:0;
  background:var(--vscode-charts-blue,#3794ff);
}
.session-dot.idle{background:var(--vscode-foreground);opacity:.3}
.session-info{flex:1;min-width:0}
.session-title{
  font-size:12px;line-height:1.4;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.session-meta{
  font-size:11px;opacity:.6;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.session-delete{
  background:transparent;border:0;color:var(--vscode-foreground);
  opacity:0;cursor:pointer;font-size:12px;padding:2px 4px;border-radius:3px;
  flex-shrink:0;
}
.session-item:hover .session-delete{opacity:.5}
.session-delete:hover{opacity:1!important;background:var(--vscode-toolbar-hoverBackground)}

.more-link{
  padding:4px 12px 8px;font-size:11px;
  color:var(--vscode-textLink-foreground);cursor:pointer;
  display:flex;justify-content:space-between;
}
.more-link:hover{text-decoration:underline}

/* ── MESSAGES AREA ── */
.chat-area{
  flex:1;overflow-y:auto;padding:12px;
  display:flex;flex-direction:column;gap:12px;
  min-height:0;
}
.chat-area.empty-state{
  justify-content:center;align-items:center;
  color:var(--vscode-descriptionForeground);font-size:12px;
}
.msg{
  font-size:12px;line-height:1.5;
  white-space:pre-wrap;word-break:break-word;
}
.msg-row{display:flex;gap:8px;align-items:flex-start}
.msg-avatar{
  width:20px;height:20px;border-radius:50%;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:700;
  margin-top:2px;
}
.msg-avatar.user-av{
  background:var(--vscode-charts-blue,#3794ff);color:#fff;
}
.msg-avatar.pm-av{
  background:var(--vscode-charts-orange,#d18616);color:#fff;
}
.msg-content{flex:1;min-width:0}
.msg-role{font-size:11px;font-weight:600;margin-bottom:2px}
.msg-text{font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.msg-error .msg-text{color:var(--vscode-errorForeground)}
.status-bar{
  font-size:11px;padding:4px 12px;
  color:var(--vscode-descriptionForeground);
  flex-shrink:0;
  display:flex;align-items:center;gap:6px;
}
.status-bar .spinner{
  width:12px;height:12px;border:2px solid var(--vscode-foreground);
  border-top-color:transparent;border-radius:50%;
  animation:spin .8s linear infinite;display:none;
}
.status-bar.busy .spinner{display:inline-block}
.status-bar.busy{color:var(--vscode-charts-yellow,#cca700)}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── COMPOSER (bottom) ── */
.composer{
  border-top:1px solid var(--vscode-panel-border,var(--vscode-sideBarSectionHeader-border,#333));
  padding:8px 10px 6px;
  flex-shrink:0;
  display:flex;flex-direction:column;gap:6px;
  background:var(--vscode-sideBar-background);
}
.composer-input{
  border:1px solid var(--vscode-input-border);
  border-radius:8px;
  background:var(--vscode-input-background);
  padding:8px 10px;
  display:flex;flex-direction:column;gap:4px;
}
.composer-input:focus-within{
  border-color:var(--vscode-focusBorder);
}
.prompt{
  width:100%;min-height:36px;max-height:120px;resize:none;
  background:transparent;color:var(--vscode-input-foreground);
  border:0;outline:none;
  font-size:13px;line-height:1.4;font-family:var(--vscode-font-family);
}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{
  font-size:10px;padding:2px 6px;
  border-radius:3px;
  background:var(--vscode-badge-background);
  color:var(--vscode-badge-foreground);
  display:flex;align-items:center;gap:4px;
}
.chip-remove{cursor:pointer;opacity:.7;font-size:12px}
.chip-remove:hover{opacity:1}
/* ── @ mention autocomplete ── */
.mention-popup{
  position:absolute;bottom:100%;left:0;right:0;
  background:var(--vscode-editorSuggestWidget-background,var(--vscode-dropdown-background));
  border:1px solid var(--vscode-editorSuggestWidget-border,var(--vscode-dropdown-border));
  border-radius:6px;
  box-shadow:0 4px 12px rgba(0,0,0,.3);
  max-height:200px;overflow-y:auto;
  display:none;z-index:10;
  padding:4px 0;
}
.mention-popup.visible{display:block}
.mention-item{
  padding:5px 10px;cursor:pointer;
  font-size:12px;color:var(--vscode-foreground);
  display:flex;align-items:center;gap:8px;
}
.mention-item:hover,.mention-item.active{
  background:var(--vscode-list-hoverBackground);
}
.mention-item .mi-role{
  font-weight:600;color:var(--vscode-textLink-foreground);
  min-width:110px;
}
.mention-item .mi-desc{
  opacity:.7;font-size:11px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.composer-input{position:relative}
.composer-toolbar{
  display:flex;align-items:center;gap:2px;
}
.tb-btn{
  background:transparent;border:0;
  color:var(--vscode-icon-foreground,var(--vscode-foreground));
  width:24px;height:24px;border-radius:4px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  font-size:14px;
}
.tb-btn:hover{background:var(--vscode-toolbar-hoverBackground)}
.tb-btn.active{color:var(--vscode-focusBorder)}
.tb-spacer{flex:1}
.tb-label{
  font-size:11px;color:var(--vscode-descriptionForeground);
  padding:0 4px;cursor:default;
  display:flex;align-items:center;gap:2px;
}
.send-btn{
  background:var(--vscode-button-background);color:var(--vscode-button-foreground);
  border:0;border-radius:4px;width:24px;height:24px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;font-size:14px;
}
.send-btn:hover{background:var(--vscode-button-hoverBackground)}
.send-btn:disabled{opacity:.4;cursor:default}
</style>
</head>
<body>

<!-- SESSIONS VIEW -->
<div id="sessionsView" style="display:flex;flex-direction:column;height:100%">
  <div class="sessions-header">
    <span>Sessions</span>
    <div class="sessions-actions">
      <button class="icon-btn" id="newChatBtn" title="New Chat">+</button>
    </div>
  </div>
  <div class="session-list" id="sessionList"></div>
</div>

<!-- CHAT VIEW -->
<div id="chatView" style="display:none;flex-direction:column;height:100%">
  <div class="sessions-header">
    <button class="icon-btn" id="backBtn" title="Back to sessions">\u2190</button>
    <span id="chatTitle" style="flex:1;text-align:center;text-transform:none;font-weight:500;font-size:12px"></span>
    <button class="icon-btn" id="newChatBtn2" title="New Chat">+</button>
  </div>
  <div class="chat-area empty-state" id="messages">
    <span>Start a new conversation</span>
  </div>
  <div class="status-bar" id="statusBar">
    <span class="spinner"></span>
    <span id="statusText">Ready</span>
  </div>
  <div class="composer">
    <div class="composer-input">
      <div id="mentionPopup" class="mention-popup"></div>
      <textarea id="chatPrompt" class="prompt" placeholder="Use @agent to call a specific AI, or just describe what to build" rows="1"></textarea>
      <div id="chips" class="chips"></div>
    </div>
    <div class="composer-toolbar">
      <button class="tb-btn" id="attachBtn" title="Attach active editor">+</button>
      <button class="tb-btn" id="imageBtn" title="Attach image">\u{1F4CE}</button>
      <span class="tb-label">ThinkCoffee PM</span>
      <span class="tb-spacer"></span>
      <button class="send-btn" id="sendBtn" title="Send" disabled>\u2191</button>
    </div>
  </div>
</div>

<script nonce="${nonce}">
(function(){
  const vscode = acquireVsCodeApi();

  // ── State ──
  let state = vscode.getState() || { chats: {}, currentChatId: null };
  let includeActiveEditor = false;
  let images = [];

  function persist() { vscode.setState(state); }

  // ── DOM refs ──
  const sessionsView = document.getElementById('sessionsView');
  const chatView = document.getElementById('chatView');
  const sessionList = document.getElementById('sessionList');
  const messagesEl = document.getElementById('messages');
  const statusText = document.getElementById('statusText');
  const statusBar = document.getElementById('statusBar');
  const chatTitle = document.getElementById('chatTitle');
  const input = document.getElementById('chatPrompt');
  const sendBtn = document.getElementById('sendBtn');
  const chipsEl = document.getElementById('chips');

  // ── Helpers ──
  function genId() { return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }

  function timeAgo(ts) {
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }

  function escapeHtml(t) {
    return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Sessions View ──
  function showSessions() {
    sessionsView.style.display = 'flex';
    chatView.style.display = 'none';
    renderSessionList();
  }

  function showChat(chatId) {
    if (!state.chats[chatId]) return;
    state.currentChatId = chatId;
    persist();
    sessionsView.style.display = 'none';
    chatView.style.display = 'flex';
    renderChat();
  }

  function renderSessionList() {
    sessionList.innerHTML = '';
    const sorted = Object.values(state.chats).sort((a,b) => b.createdAt - a.createdAt);
    const visible = sorted.slice(0, 5);
    const remaining = sorted.length - visible.length;

    for (const chat of visible) {
      const hasMessages = chat.messages && chat.messages.length > 0;
      const lastMsg = hasMessages ? chat.messages[chat.messages.length - 1] : null;
      const item = document.createElement('div');
      item.className = 'session-item' + (chat.id === state.currentChatId ? ' active' : '');

      const dot = document.createElement('div');
      dot.className = 'session-dot' + (hasMessages ? '' : ' idle');

      const info = document.createElement('div');
      info.className = 'session-info';

      const title = document.createElement('div');
      title.className = 'session-title';
      title.textContent = chat.title || 'New Chat';

      const meta = document.createElement('div');
      meta.className = 'session-meta';
      meta.textContent = lastMsg ? lastMsg.text.slice(0,50) : timeAgo(chat.createdAt);

      info.appendChild(title);
      info.appendChild(meta);

      const del = document.createElement('button');
      del.className = 'session-delete';
      del.textContent = '\u00d7';
      del.title = 'Delete';
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteChat(chat.id); });

      item.appendChild(dot);
      item.appendChild(info);
      item.appendChild(del);
      item.addEventListener('click', () => showChat(chat.id));
      sessionList.appendChild(item);
    }

    if (remaining > 0) {
      const more = document.createElement('div');
      more.className = 'more-link';
      more.innerHTML = '<span>MORE</span><span>' + remaining + '</span>';
      more.addEventListener('click', () => {
        // Show all sessions
        renderAllSessions();
      });
      sessionList.appendChild(more);
    }
  }

  function renderAllSessions() {
    sessionList.innerHTML = '';
    const sorted = Object.values(state.chats).sort((a,b) => b.createdAt - a.createdAt);
    for (const chat of sorted) {
      const hasMessages = chat.messages && chat.messages.length > 0;
      const lastMsg = hasMessages ? chat.messages[chat.messages.length - 1] : null;
      const item = document.createElement('div');
      item.className = 'session-item' + (chat.id === state.currentChatId ? ' active' : '');

      const dot = document.createElement('div');
      dot.className = 'session-dot' + (hasMessages ? '' : ' idle');

      const info = document.createElement('div');
      info.className = 'session-info';

      const title = document.createElement('div');
      title.className = 'session-title';
      title.textContent = chat.title || 'New Chat';

      const meta = document.createElement('div');
      meta.className = 'session-meta';
      meta.textContent = lastMsg ? lastMsg.text.slice(0,50) : timeAgo(chat.createdAt);

      info.appendChild(title);
      info.appendChild(meta);

      const del = document.createElement('button');
      del.className = 'session-delete';
      del.textContent = '\u00d7';
      del.title = 'Delete';
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteChat(chat.id); });

      item.appendChild(dot);
      item.appendChild(info);
      item.appendChild(del);
      item.addEventListener('click', () => showChat(chat.id));
      sessionList.appendChild(item);
    }
  }

  // ── Chat View ──
  function renderChat() {
    const chat = state.chats[state.currentChatId];
    if (!chat) return;

    chatTitle.textContent = chat.title || 'New Chat';
    messagesEl.innerHTML = '';

    if (!chat.messages || chat.messages.length === 0) {
      messagesEl.className = 'chat-area empty-state';
      messagesEl.innerHTML = '<span>Start a new conversation</span>';
    } else {
      messagesEl.className = 'chat-area';
      for (const m of chat.messages) {
        appendMsgDom(m.role, m.text);
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function appendMsgDom(role, text) {
    const row = document.createElement('div');
    row.className = 'msg-row' + (role === 'error' ? ' msg-error' : '');

    const av = document.createElement('div');
    const isAgent = role !== 'user' && role !== 'error' && role !== 'assistant';
    av.className = 'msg-avatar ' + (role === 'user' ? 'user-av' : 'pm-av');
    av.textContent = role === 'user' ? 'U' : role === 'error' ? '!' : isAgent ? role.slice(0,2).toUpperCase() : 'PM';

    const content = document.createElement('div');
    content.className = 'msg-content';

    const roleEl = document.createElement('div');
    roleEl.className = 'msg-role';
    const roleLabels = { user:'You', error:'Error', assistant:'ThinkCoffee PM' };
    roleEl.textContent = roleLabels[role] || ('@' + role);

    const textEl = document.createElement('div');
    textEl.className = 'msg-text';
    textEl.textContent = text;

    content.appendChild(roleEl);
    content.appendChild(textEl);
    row.appendChild(av);
    row.appendChild(content);
    messagesEl.appendChild(row);
  }

  // ── Chat CRUD ──
  function createNewChat() {
    const id = genId();
    const title = new Date().toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    state.chats[id] = { id, title, messages: [], createdAt: Date.now() };
    state.currentChatId = id;
    persist();
    showChat(id);
  }

  function deleteChat(chatId) {
    delete state.chats[chatId];
    if (state.currentChatId === chatId) {
      const keys = Object.keys(state.chats);
      state.currentChatId = keys.length > 0 ? keys[0] : null;
    }
    persist();
    if (chatView.style.display !== 'none' && (!state.currentChatId || !state.chats[state.currentChatId])) {
      showSessions();
    } else if (chatView.style.display !== 'none') {
      renderChat();
    }
    renderSessionList();
  }

  function addMessage(role, text) {
    const chat = state.chats[state.currentChatId];
    if (!chat) return;
    chat.messages.push({ role, text });
    // Update title from first user message
    if (role === 'user' && chat.messages.filter(m => m.role === 'user').length === 1) {
      chat.title = text.slice(0, 60) || chat.title;
    }
    persist();
    if (chatView.style.display !== 'none') {
      if (messagesEl.classList.contains('empty-state')) {
        messagesEl.className = 'chat-area';
        messagesEl.innerHTML = '';
      }
      appendMsgDom(role, text);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // ── Status ──
  let statusTimer = null;
  function setStatus(text, busy) {
    statusText.textContent = text;
    statusBar.className = 'status-bar' + (busy ? ' busy' : '');
    // Clear any existing elapsed timer
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    if (busy && text.includes('working')) {
      // Show elapsed seconds in status bar
      const start = Date.now();
      statusTimer = setInterval(() => {
        const secs = Math.round((Date.now() - start) / 1000);
        const base = text.replace(/\(\d+s.*\)/, '').trim();
        statusText.textContent = base + ' (' + secs + 's)';
      }, 1000);
    }
  }

  // ── Composer ──
  function updateSendBtn() {
    const hasContent = (input.value || '').trim().length > 0 || includeActiveEditor || images.length > 0;
    sendBtn.disabled = !hasContent;
  }

  function renderChips() {
    chipsEl.innerHTML = '';
    if (includeActiveEditor) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.innerHTML = 'Active File <span class="chip-remove">\u00d7</span>';
      c.querySelector('.chip-remove').addEventListener('click', () => { includeActiveEditor = false; renderChips(); updateSendBtn(); });
      chipsEl.appendChild(c);
    }
    for (let i = 0; i < images.length; i++) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.innerHTML = escapeHtml(images[i].name || 'image') + ' <span class="chip-remove">\u00d7</span>';
      const idx = i;
      c.querySelector('.chip-remove').addEventListener('click', () => { images.splice(idx, 1); renderChips(); updateSendBtn(); });
      chipsEl.appendChild(c);
    }
  }

  function submit() {
    const prompt = (input.value || '').trim();
    if (!prompt && !includeActiveEditor && images.length === 0) return;

    // Ensure we're in chat view
    if (!state.currentChatId || !state.chats[state.currentChatId]) {
      createNewChat();
    }

    const preview = prompt || (includeActiveEditor ? '[Active editor file]' : '[Image attachment]');
    addMessage('user', preview);
    setStatus('PM is thinking\u2026', true);

    vscode.postMessage({ type: 'ask', prompt, includeActiveEditor, images });

    input.value = '';
    images = [];
    includeActiveEditor = false;
    renderChips();
    updateSendBtn();
    autoResize();
    input.focus();
  }

  function autoResize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  // ── Events ──
  document.getElementById('newChatBtn').addEventListener('click', createNewChat);
  document.getElementById('newChatBtn2').addEventListener('click', createNewChat);
  document.getElementById('backBtn').addEventListener('click', showSessions);
  sendBtn.addEventListener('click', submit);

  document.getElementById('attachBtn').addEventListener('click', () => {
    includeActiveEditor = !includeActiveEditor;
    document.getElementById('attachBtn').classList.toggle('active', includeActiveEditor);
    renderChips();
    updateSendBtn();
  });

  document.getElementById('imageBtn').addEventListener('click', () => {
    // Trigger paste hint
    input.focus();
  });

  // ── @Mention autocomplete ──
  const AGENTS = [
    { role: 'architect', label: 'Architect', desc: 'Design architecture & tech stack' },
    { role: 'backend', label: 'Backend', desc: 'Implement APIs & business logic' },
    { role: 'frontend', label: 'Frontend', desc: 'UI components & pages' },
    { role: 'devops', label: 'DevOps', desc: 'CI/CD & infrastructure' },
    { role: 'qa', label: 'QA', desc: 'Tests & bug reports' },
    { role: 'code-review', label: 'Code Review', desc: 'Review code quality & security' },
    { role: 'organizer', label: 'Organizer', desc: 'Organize project structure' },
    { role: 'git', label: 'Git', desc: 'Commits, branches & PRs' },
    { role: 'dead-code', label: 'Dead Code', desc: 'Remove unused code' },
    { role: 'troubleshooter', label: 'Troubleshooter', desc: 'Diagnose & fix failures' },
  ];
  const mentionPopup = document.getElementById('mentionPopup');
  let mentionActive = false;
  let mentionStart = -1;
  let mentionIdx = 0;
  let filteredAgents = [];

  function getMentionQuery() {
    const pos = input.selectionStart;
    const text = input.value.slice(0, pos);
    const at = text.lastIndexOf('@');
    if (at < 0) return null;
    // Make sure @ is at start or after whitespace
    if (at > 0 && !/\s/.test(text[at - 1])) return null;
    return { start: at, query: text.slice(at + 1).toLowerCase() };
  }

  function renderMentionPopup() {
    const m = getMentionQuery();
    if (!m) { hideMentions(); return; }
    mentionStart = m.start;
    filteredAgents = AGENTS.filter(a =>
      a.role.includes(m.query) || a.label.toLowerCase().includes(m.query) || a.desc.toLowerCase().includes(m.query)
    );
    if (filteredAgents.length === 0) { hideMentions(); return; }
    mentionActive = true;
    mentionIdx = 0;
    mentionPopup.innerHTML = '';
    filteredAgents.forEach((a, i) => {
      const el = document.createElement('div');
      el.className = 'mention-item' + (i === 0 ? ' active' : '');
      el.innerHTML = '<span class="mi-role">@' + escapeHtml(a.role) + '</span><span class="mi-desc">' + escapeHtml(a.desc) + '</span>';
      el.addEventListener('mousedown', e => { e.preventDefault(); selectMention(i); });
      mentionPopup.appendChild(el);
    });
    mentionPopup.classList.add('visible');
  }

  function hideMentions() {
    mentionActive = false;
    mentionPopup.classList.remove('visible');
    mentionPopup.innerHTML = '';
  }

  function selectMention(idx) {
    const agent = filteredAgents[idx];
    if (!agent) return;
    const before = input.value.slice(0, mentionStart);
    const after = input.value.slice(input.selectionStart);
    input.value = before + '@' + agent.role + ' ' + after;
    const cursor = before.length + agent.role.length + 2;
    input.setSelectionRange(cursor, cursor);
    hideMentions();
    updateSendBtn();
    input.focus();
  }

  input.addEventListener('input', () => { updateSendBtn(); autoResize(); renderMentionPopup(); });
  input.addEventListener('keydown', e => {
    if (mentionActive) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        mentionIdx = (mentionIdx + 1) % filteredAgents.length;
        mentionPopup.querySelectorAll('.mention-item').forEach((el, i) => el.classList.toggle('active', i === mentionIdx));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionIdx = (mentionIdx - 1 + filteredAgents.length) % filteredAgents.length;
        mentionPopup.querySelectorAll('.mention-item').forEach((el, i) => el.classList.toggle('active', i === mentionIdx));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        selectMention(mentionIdx);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideMentions();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  input.addEventListener('blur', () => { setTimeout(hideMentions, 150); });

  input.addEventListener('paste', event => {
    const cb = event.clipboardData;
    if (!cb || !cb.items) return;
    let found = false;
    for (const item of cb.items) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (!file) continue;
      found = true;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string' && images.length < 5) {
          images.push({ name: file.name || 'pasted-image', mimeType: file.type || 'image/png', dataUrl: reader.result });
          renderChips();
          updateSendBtn();
        }
      };
      reader.readAsDataURL(file);
    }
    if (found) event.preventDefault();
  });

  // ── Extension Messages ──
  window.addEventListener('message', event => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'chat:status') {
      setStatus(msg.text || '', true);
    } else if (msg.type === 'chat:assistant') {
      addMessage('assistant', msg.text || '');
      setStatus('Ready', false);
    } else if (msg.type === 'chat:error') {
      addMessage('error', msg.text || 'Unknown error');
      setStatus('Ready', false);
    } else if (msg.type === 'chat:new-chat') {
      const id = msg.chatId || genId();
      state.chats[id] = { id, title: msg.text || 'New Chat', messages: [], createdAt: Date.now() };
      state.currentChatId = id;
      persist();
      showChat(id);
    } else if (msg.type === 'chat:load-history') {
      try {
        const h = JSON.parse(msg.text || '{}');
        state.chats = h.chats || {};
        state.currentChatId = h.currentChatId || null;
        persist();
        showSessions();
      } catch(e) {}
    }
  });

  // ── Init ──
  if (!state.chats || Object.keys(state.chats).length === 0) {
    createNewChat();
  } else if (state.currentChatId && state.chats[state.currentChatId]) {
    showChat(state.currentChatId);
  } else {
    showSessions();
  }

  // Tell extension we're ready
  vscode.postMessage({ type: 'ready' });
})();
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
