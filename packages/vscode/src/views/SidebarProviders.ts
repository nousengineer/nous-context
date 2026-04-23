import * as vscode from 'vscode';

interface ChatOutboundMessage {
  type:
  | 'chat:status'
  | 'chat:assistant'
  | 'chat:error'
  | 'chat:new-chat'
  | 'chat:load-history'
  | 'chat:thinking'
  | 'chat:step'
  | 'chat:done'
  | 'chat:capability-result';
  text?: string;
  chatId?: string;
  meta?: Record<string, unknown>;
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

  postThinking(text: string): void {
    this.postToWebview({ type: 'chat:thinking', text });
  }

  postStep(text: string): void {
    this.postToWebview({ type: 'chat:step', text });
  }

  postDone(): void {
    this.postToWebview({ type: 'chat:done' });
  }

  postCapabilityResult(text: string, meta?: Record<string, unknown>): void {
    this.postToWebview({ type: 'chat:capability-result', text, meta });
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

    view.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ask') {
        await vscode.commands.executeCommand('thinkcoffee.chat.ask', message);
      } else if (message.type === 'capability') {
        await vscode.commands.executeCommand('thinkcoffee.chat.capability', message);
      } else if (message.type === 'stop') {
        await vscode.commands.executeCommand('thinkcoffee.stopAgents');
      }
    });

    const nonce = getNonce();
    view.webview.html = buildWebviewHtml(nonce);
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

function buildWebviewHtml(nonce: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ThinkCoffee PM</title>
<style>
:root { --radius: 8px; --font-sm: 11px; --font-base: 13px; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--font-base);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  display: flex; flex-direction: column; height: 100vh; overflow: hidden;
}
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border));
  background: var(--vscode-sideBarSectionHeader-background, transparent);
  flex-shrink: 0;
}
.topbar-left { display: flex; align-items: center; gap: 6px; }
.topbar-title { font-size: var(--font-base); font-weight: 600; }
.topbar-badge {
  font-size: 9px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  padding: 1px 6px; border-radius: 10px; font-weight: 600;
}
.topbar-actions { display: flex; gap: 4px; }
.icon-btn {
  background: transparent; border: none; color: var(--vscode-icon-foreground, var(--vscode-foreground));
  cursor: pointer; padding: 4px; border-radius: 4px; font-size: 14px; line-height: 1;
  display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; opacity: 0.8;
}
.icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); opacity: 1; }
.icon-btn.danger:hover { background: color-mix(in srgb, var(--vscode-errorForeground) 20%, transparent); color: var(--vscode-errorForeground); }
.history-panel {
  display: none; flex-direction: column;
  border-bottom: 1px solid var(--vscode-widget-border); max-height: 200px; overflow: hidden;
}
.history-panel.open { display: flex; }
.history-list { list-style: none; overflow-y: auto; flex: 1; padding: 4px 8px; }
.history-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 8px; border-radius: 4px; cursor: pointer;
  font-size: var(--font-sm); opacity: 0.85;
}
.history-item:hover { background: var(--vscode-list-hoverBackground); opacity: 1; }
.history-item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); opacity: 1; }
.history-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-del { background: none; border: none; color: var(--vscode-foreground); opacity: 0; cursor: pointer; font-size: 12px; padding: 0 2px; }
.history-item:hover .history-del { opacity: 0.6; }
.history-del:hover { opacity: 1 !important; color: var(--vscode-errorForeground); }
.messages-container { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.welcome {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; gap: 12px; opacity: 0.7; text-align: center; padding: 20px;
}
.welcome-icon { font-size: 28px; }
.welcome h3 { font-size: 14px; font-weight: 600; }
.welcome p { font-size: var(--font-sm); line-height: 1.5; max-width: 280px; }
.msg-group { display: flex; flex-direction: column; gap: 2px; }
.msg-header { display: flex; align-items: center; gap: 6px; font-size: var(--font-sm); font-weight: 600; padding-left: 2px; }
.msg-avatar {
  width: 18px; height: 18px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; flex-shrink: 0;
}
.msg-avatar.user { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.msg-avatar.pm { background: color-mix(in srgb, #f0883e 90%, transparent); color: #fff; }
.msg-body {
  padding: 8px 12px; border-radius: var(--radius); font-size: var(--font-base);
  line-height: 1.5; white-space: pre-wrap; word-break: break-word; margin-left: 24px;
}
.msg-body.user { background: color-mix(in srgb, var(--vscode-button-background) 15%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-button-background) 30%, transparent); }
.msg-body.assistant { background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border); }
.msg-body.error { background: color-mix(in srgb, var(--vscode-errorForeground) 10%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 25%, transparent); color: var(--vscode-errorForeground); }
.thinking { display: none; align-items: center; gap: 8px; padding: 6px 12px; margin-left: 24px; font-size: var(--font-sm); color: var(--vscode-descriptionForeground); }
.thinking.visible { display: flex; }
.thinking-dots { display: flex; gap: 3px; }
.thinking-dots span { width: 4px; height: 4px; border-radius: 50%; background: var(--vscode-descriptionForeground); animation: blink 1.4s infinite both; }
.thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
.thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%,80%,100%{opacity:0.2;} 40%{opacity:1;} }
.step-item { display: flex; align-items: flex-start; gap: 6px; padding: 3px 12px; margin-left: 24px; font-size: var(--font-sm); color: var(--vscode-descriptionForeground); }
.step-icon { flex-shrink: 0; margin-top: 2px; }
.statusbar { font-size: var(--font-sm); padding: 4px 12px; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-widget-border); flex-shrink: 0; display: flex; align-items: center; gap: 6px; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-testing-iconPassed, #3fb950); flex-shrink: 0; }
.status-dot.busy { background: var(--vscode-debugIcon-startForeground, #f0883e); animation: pulse 1.5s ease-in-out infinite; }
@keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }
.capabilities-panel { display: none; flex-direction: column; border-top: 1px solid var(--vscode-widget-border); max-height: 55vh; overflow-y: auto; flex-shrink: 0; padding: 8px; gap: 6px; }
.capabilities-panel.open { display: flex; }
.cap-group-title { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: var(--vscode-descriptionForeground); padding: 6px 4px 2px; }
.cap-btn { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: none; border-radius: 4px; background: transparent; color: var(--vscode-foreground); cursor: pointer; font-size: var(--font-sm); text-align: left; width: 100%; }
.cap-btn:hover { background: var(--vscode-list-hoverBackground); }
.cap-icon { font-size: 14px; width: 20px; text-align: center; flex-shrink: 0; }
.cap-label { flex: 1; }
.composer-wrapper { flex-shrink: 0; border-top: 1px solid var(--vscode-widget-border); background: var(--vscode-sideBar-background); }
.chips-bar { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 12px 0; }
.chips-bar:empty { padding: 0; }
.chip { font-size: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 8px; border-radius: 10px; }
.composer { display: flex; align-items: flex-end; gap: 6px; padding: 8px 12px; }
.prompt-input { flex: 1; min-height: 36px; max-height: 120px; resize: none; border: 1px solid var(--vscode-input-border); border-radius: var(--radius); background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 8px 10px; font-size: var(--font-base); font-family: var(--vscode-font-family); line-height: 1.4; outline: none; }
.prompt-input:focus { border-color: var(--vscode-focusBorder); }
.prompt-input::placeholder { color: var(--vscode-input-placeholderForeground); }
.composer-actions { display: flex; gap: 2px; flex-shrink: 0; }
.send-btn { width: 30px; height: 30px; border-radius: 6px; border: none; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; }
.send-btn:hover { background: var(--vscode-button-hoverBackground); }
.send-btn:disabled { opacity: 0.4; cursor: default; }
.stop-btn { width: 30px; height: 30px; border-radius: 6px; border: 1px solid var(--vscode-errorForeground); background: transparent; color: var(--vscode-errorForeground); cursor: pointer; font-size: 12px; display: none; align-items: center; justify-content: center; }
.stop-btn:hover { background: color-mix(in srgb, var(--vscode-errorForeground) 15%, transparent); }
.stop-btn.visible { display: flex; }
.composer-toolbar { display: flex; align-items: center; gap: 4px; padding: 0 12px 8px; }
.toolbar-btn { font-size: var(--font-sm); padding: 2px 8px; border-radius: 4px; border: 1px solid var(--vscode-input-border); background: transparent; color: var(--vscode-foreground); cursor: pointer; opacity: 0.7; }
.toolbar-btn:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
.toolbar-btn.active { border-color: var(--vscode-focusBorder); opacity: 1; }
.toolbar-spacer { flex: 1; }
.toolbar-mode { font-size: 10px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-left">
    <span class="topbar-title">ThinkCoffee PM</span>
    <span class="topbar-badge">AI</span>
  </div>
  <div class="topbar-actions">
    <button class="icon-btn" id="btnHistory" title="Chat history">&#128203;</button>
    <button class="icon-btn" id="btnCapabilities" title="PM capabilities">&#9889;</button>
    <button class="icon-btn" id="btnNewChat" title="New chat">&#43;</button>
    <button class="icon-btn danger" id="btnStopAll" title="Stop all AI tasks">&#9632;</button>
  </div>
</div>
<div class="history-panel" id="historyPanel">
  <ul class="history-list" id="historyList"></ul>
</div>
<div class="capabilities-panel" id="capPanel">
  <div class="cap-group-title">Reasoning &amp; Analysis</div>
  <button class="cap-btn" data-cap="adaptive-reasoning"><span class="cap-icon">&#129504;</span><span class="cap-label">Adaptive Reasoning</span></button>
  <button class="cap-btn" data-cap="deep-reasoning"><span class="cap-icon">&#128161;</span><span class="cap-label">Deep Reasoning (Extended Thinking)</span></button>
  <button class="cap-btn" data-cap="multi-step-solve"><span class="cap-icon">&#127922;</span><span class="cap-label">Multi-step Problem Solving</span></button>
  <button class="cap-btn" data-cap="pattern-discovery"><span class="cap-icon">&#128269;</span><span class="cap-label">Hidden Pattern Discovery</span></button>
  <button class="cap-btn" data-cap="complex-systems"><span class="cap-icon">&#128300;</span><span class="cap-label">Complex Systems Analysis</span></button>
  <button class="cap-btn" data-cap="interdisciplinary"><span class="cap-icon">&#127891;</span><span class="cap-label">Interdisciplinary Knowledge Synthesis</span></button>
  <button class="cap-btn" data-cap="inconsistency-detection"><span class="cap-icon">&#9888;</span><span class="cap-label">Technical Inconsistency Detection</span></button>
  <button class="cap-btn" data-cap="scientific-analysis"><span class="cap-icon">&#128300;</span><span class="cap-label">Advanced Scientific Analysis</span></button>
  <div class="cap-group-title">Software Engineering</div>
  <button class="cap-btn" data-cap="generate-code"><span class="cap-icon">&#128187;</span><span class="cap-label">Advanced Code Generation</span></button>
  <button class="cap-btn" data-cap="debug-code"><span class="cap-icon">&#128027;</span><span class="cap-label">Automatic System Debugging</span></button>
  <button class="cap-btn" data-cap="refactor-code"><span class="cap-icon">&#9881;</span><span class="cap-label">Code Refactoring</span></button>
  <button class="cap-btn" data-cap="autonomous-dev"><span class="cap-icon">&#129302;</span><span class="cap-label">Autonomous Software Development</span></button>
  <button class="cap-btn" data-cap="task-decomposition"><span class="cap-icon">&#128203;</span><span class="cap-label">Automatic Task Decomposition</span></button>
  <button class="cap-btn" data-cap="self-optimization"><span class="cap-icon">&#128260;</span><span class="cap-label">Iterative Self-Optimization</span></button>
  <div class="cap-group-title">Security &amp; Defense</div>
  <button class="cap-btn" data-cap="vulnerability-scan"><span class="cap-icon">&#128274;</span><span class="cap-label">Vulnerability Discovery (incl. Zero-day)</span></button>
  <button class="cap-btn" data-cap="security-analysis"><span class="cap-icon">&#128737;</span><span class="cap-label">Systems Security Analysis</span></button>
  <button class="cap-btn" data-cap="attack-simulation"><span class="cap-icon">&#9876;</span><span class="cap-label">Multi-step Attack Simulation</span></button>
  <button class="cap-btn" data-cap="exploit-chain"><span class="cap-icon">&#128279;</span><span class="cap-label">Exploit Chain Analysis</span></button>
  <button class="cap-btn" data-cap="defensive-security"><span class="cap-icon">&#128737;</span><span class="cap-label">Defensive Security Application</span></button>
  <button class="cap-btn" data-cap="evasion-testing"><span class="cap-icon">&#128683;</span><span class="cap-label">Restriction Evasion Testing (Controlled)</span></button>
  <div class="cap-group-title">Autonomous Operations</div>
  <button class="cap-btn" data-cap="long-task"><span class="cap-icon">&#9201;</span><span class="cap-label">Long-running Task Execution</span></button>
  <button class="cap-btn" data-cap="workflow-planning"><span class="cap-icon">&#128197;</span><span class="cap-label">Complex Workflow Planning</span></button>
  <button class="cap-btn" data-cap="autonomous-agent"><span class="cap-icon">&#129302;</span><span class="cap-label">Continuous Autonomous Agent</span></button>
  <button class="cap-btn" data-cap="contextual-decision"><span class="cap-icon">&#127919;</span><span class="cap-label">Contextual Decision Making</span></button>
  <button class="cap-btn" data-cap="dynamic-adaptation"><span class="cap-icon">&#128257;</span><span class="cap-label">Dynamic Behavior Adaptation</span></button>
  <button class="cap-btn" data-cap="long-context"><span class="cap-icon">&#128220;</span><span class="cap-label">Long Context Processing</span></button>
  <button class="cap-btn" data-cap="contextual-memory"><span class="cap-icon">&#129504;</span><span class="cap-label">Advanced Contextual Memory</span></button>
  <div class="cap-group-title">Multimodal</div>
  <button class="cap-btn" data-cap="multimodal-text-image"><span class="cap-icon">&#128444;</span><span class="cap-label">Text &amp; Image Analysis</span></button>
  <button class="cap-btn" data-cap="diagram-interpretation"><span class="cap-icon">&#128200;</span><span class="cap-label">Graph &amp; Diagram Interpretation</span></button>
</div>
<div class="messages-container" id="messagesContainer">
  <div class="welcome" id="welcome">
    <div class="welcome-icon">&#9749;</div>
    <h3>ThinkCoffee PM</h3>
    <p>Your autonomous project manager. Send a message or select a capability to get started.</p>
  </div>
</div>
<div class="thinking" id="thinking">
  <div class="thinking-dots"><span></span><span></span><span></span></div>
  <span id="thinkingText">PM is thinking...</span>
</div>
<div class="statusbar">
  <span class="status-dot" id="statusDot"></span>
  <span id="statusText">Ready</span>
</div>
<div class="composer-wrapper">
  <div class="chips-bar" id="chipsBar"></div>
  <div class="composer">
    <textarea class="prompt-input" id="promptInput" placeholder="Ask the PM anything..." rows="1"></textarea>
    <div class="composer-actions">
      <button class="send-btn" id="btnSend" title="Send (Enter)">&#9654;</button>
      <button class="stop-btn" id="btnStop" title="Stop current task">&#9632;</button>
    </div>
  </div>
  <div class="composer-toolbar">
    <button class="toolbar-btn" id="btnAttachFile" title="Attach active editor file">+ File</button>
    <button class="toolbar-btn" id="btnAttachImage" title="Paste or attach image">Image</button>
    <span class="toolbar-spacer"></span>
    <span class="toolbar-mode" id="modeLabel">auto</span>
  </div>
</div>
<script nonce="${nonce}">
(function(){
var vscode=acquireVsCodeApi();
var _=function(id){return document.getElementById(id);};
var mc=_('messagesContainer'),wc=_('welcome'),th=_('thinking'),tt=_('thinkingText');
var sd=_('statusDot'),st=_('statusText'),pi=_('promptInput'),cb=_('chipsBar');
var hp=_('historyPanel'),hl=_('historyList'),cp=_('capPanel');
var bs=_('btnSend'),bp=_('btnStop'),bh=_('btnHistory'),bc=_('btnCapabilities');
var bn=_('btnNewChat'),ba=_('btnStopAll'),bf=_('btnAttachFile'),bi=_('btnAttachImage');
var chats={},cid=null,incFile=false,imgs=[],busy=false;

function load(){var s=vscode.getState();if(s){chats=s.chats||{};cid=s.currentChatId||null;}if(!cid||!chats[cid])newChat(true);}
function save(){vscode.setState({chats:chats,currentChatId:cid});}
function gid(){return 'c_'+Date.now()+'_'+Math.random().toString(36).substr(2,6);}

function newChat(q){
  var id=gid();
  chats[id]={id:id,title:new Date().toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}),messages:[],createdAt:Date.now()};
  cid=id;save();if(!q){rList();rMsgs();}
}
function delChat(id){if(Object.keys(chats).length<=1)return;delete chats[id];if(cid===id){cid=Object.keys(chats).sort(function(a,b){return(chats[b].createdAt||0)-(chats[a].createdAt||0);})[0];}save();rList();rMsgs();}
function swChat(id){if(!chats[id])return;cid=id;save();rList();rMsgs();}

function rList(){
  hl.innerHTML='';
  var sorted=Object.values(chats).sort(function(a,b){return b.createdAt-a.createdAt;});
  for(var i=0;i<sorted.length;i++){
    var c=sorted[i],li=document.createElement('li');
    li.className='history-item'+(c.id===cid?' active':'');
    var n=document.createElement('span');n.className='history-item-name';n.textContent=c.title||'Untitled';
    (function(id){n.addEventListener('click',function(){swChat(id);});})(c.id);
    var d=document.createElement('button');d.className='history-del';d.textContent='\u00d7';d.title='Delete';
    (function(id){d.addEventListener('click',function(e){e.stopPropagation();delChat(id);});})(c.id);
    li.appendChild(n);li.appendChild(d);hl.appendChild(li);
  }
}

function rMsgs(){
  var c=chats[cid];if(!c)return;
  while(mc.firstChild)mc.removeChild(mc.firstChild);
  if(c.messages.length===0){mc.appendChild(wc);wc.style.display='flex';}
  else{wc.style.display='none';for(var i=0;i<c.messages.length;i++)appMsg(c.messages[i].role,c.messages[i].text);sBot();}
}

function appMsg(role,text){
  var g=document.createElement('div');g.className='msg-group';
  var h=document.createElement('div');h.className='msg-header';
  var a=document.createElement('div');a.className='msg-avatar '+(role==='user'?'user':'pm');a.textContent=role==='user'?'U':'PM';
  var nm=document.createElement('span');nm.textContent=role==='user'?'You':role==='error'?'Error':'ThinkCoffee PM';
  h.appendChild(a);h.appendChild(nm);
  var b=document.createElement('div');b.className='msg-body '+(role==='user'?'user':role==='error'?'error':'assistant');b.textContent=text;
  g.appendChild(h);g.appendChild(b);mc.appendChild(g);return g;
}

function addMsg(role,text){
  if(!cid||!chats[cid])return;chats[cid].messages.push({role:role,text:text,ts:Date.now()});
  var um=chats[cid].messages.filter(function(m){return m.role==='user';});
  if(role==='user'&&um.length===1){chats[cid].title=text.slice(0,50)+(text.length>50?'...':'');rList();}
  save();wc.style.display='none';appMsg(role,text);sBot();
}

function sBot(){requestAnimationFrame(function(){mc.scrollTop=mc.scrollHeight;});}

function setBusy(b,label){
  busy=b;sd.className='status-dot'+(b?' busy':'');st.textContent=label||(b?'Working...':'Ready');
  th.className='thinking'+(b?' visible':'');tt.textContent=label||'PM is thinking...';
  bs.disabled=b;bp.className='stop-btn'+(b?' visible':'');
}

function rChips(){
  var p=[];if(incFile)p.push('<span class="chip">Active file</span>');
  for(var i=0;i<imgs.length;i++)p.push('<span class="chip">'+esc(imgs[i].name||'image')+'</span>');
  cb.innerHTML=p.join('');bf.classList.toggle('active',incFile);
}
function esc(t){return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function submit(){
  var text=(pi.value||'').trim();if(!text&&!incFile&&imgs.length===0)return;if(busy)return;
  var preview=text||(incFile?'[Active editor file]':'[Image attachment]');
  addMsg('user',preview);setBusy(true,'PM is analyzing...');
  vscode.postMessage({type:'ask',prompt:text,includeActiveEditor:incFile,images:imgs});
  pi.value='';imgs=[];incFile=false;rChips();aResize();pi.focus();
}

var capLabels={'adaptive-reasoning':'Adaptive Reasoning','deep-reasoning':'Deep Reasoning','multi-step-solve':'Multi-step Problem Solving','pattern-discovery':'Hidden Pattern Discovery','complex-systems':'Complex Systems Analysis','interdisciplinary':'Interdisciplinary Synthesis','inconsistency-detection':'Inconsistency Detection','scientific-analysis':'Scientific Analysis','generate-code':'Code Generation','debug-code':'Debug Code','refactor-code':'Refactor Code','autonomous-dev':'Autonomous Development','task-decomposition':'Task Decomposition','self-optimization':'Self-Optimization','vulnerability-scan':'Vulnerability Scan','security-analysis':'Security Analysis','attack-simulation':'Attack Simulation','exploit-chain':'Exploit Chain Analysis','defensive-security':'Defensive Security','evasion-testing':'Evasion Testing','long-task':'Long-running Task','workflow-planning':'Workflow Planning','autonomous-agent':'Autonomous Agent','contextual-decision':'Contextual Decision','dynamic-adaptation':'Dynamic Adaptation','long-context':'Long Context Processing','contextual-memory':'Contextual Memory','multimodal-text-image':'Multimodal Analysis','diagram-interpretation':'Diagram Interpretation'};

function dispCap(cap){if(busy)return;var label=capLabels[cap]||cap;addMsg('user','/'+cap);setBusy(true,'Running: '+label+'...');cp.classList.remove('open');vscode.postMessage({type:'capability',capability:cap});}

function aResize(){pi.style.height='auto';pi.style.height=Math.min(pi.scrollHeight,120)+'px';}

bs.addEventListener('click',submit);
bp.addEventListener('click',function(){vscode.postMessage({type:'stop'});setBusy(false,'Stopped');});
ba.addEventListener('click',function(){vscode.postMessage({type:'stop'});setBusy(false,'All tasks stopped');});
bn.addEventListener('click',function(){newChat(false);});
bh.addEventListener('click',function(){hp.classList.toggle('open');cp.classList.remove('open');});
bc.addEventListener('click',function(){cp.classList.toggle('open');hp.classList.remove('open');});
bf.addEventListener('click',function(){incFile=!incFile;rChips();});
bi.addEventListener('click',function(){imgs=[];rChips();});
document.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey&&document.activeElement===pi){e.preventDefault();e.stopImmediatePropagation();submit();}},true);
pi.addEventListener('input',aResize);
pi.addEventListener('paste',function(e){
  var items=e.clipboardData&&e.clipboardData.items;if(!items)return;var found=false;
  for(var i=0;i<items.length;i++){var item=items[i];if(item.kind!=='file'||!item.type.startsWith('image/'))continue;var file=item.getAsFile();if(!file)continue;found=true;
  (function(f){var reader=new FileReader();reader.onload=function(){if(typeof reader.result==='string'){imgs=imgs.concat([{name:f.name||'pasted-image',mimeType:f.type,dataUrl:reader.result}]).slice(0,5);rChips();}};reader.readAsDataURL(f);})(file);}
  if(found)e.preventDefault();
});

var cbs=document.querySelectorAll('.cap-btn');
for(var i=0;i<cbs.length;i++){(function(btn){btn.addEventListener('click',function(){var cap=btn.getAttribute('data-cap');if(cap)dispCap(cap);});})(cbs[i]);}

window.addEventListener('message',function(e){
  var msg=e.data;if(!msg||typeof msg!=='object')return;
  switch(msg.type){
    case 'chat:status':st.textContent=msg.text||'Ready';break;
    case 'chat:assistant':addMsg('assistant',msg.text||'');setBusy(false,'Ready');break;
    case 'chat:error':addMsg('error',msg.text||'Unknown error');setBusy(false,'Ready');break;
    case 'chat:thinking':setBusy(true,msg.text||'PM is thinking...');break;
    case 'chat:step':var s=document.createElement('div');s.className='step-item';s.innerHTML='<span class="step-icon">&#10003;</span> '+esc(msg.text||'');mc.appendChild(s);sBot();break;
    case 'chat:done':setBusy(false,'Ready');break;
    case 'chat:capability-result':addMsg('assistant',msg.text||'');setBusy(false,'Ready');break;
    case 'chat:new-chat':if(msg.text){var id=msg.chatId||gid();chats[id]={id:id,title:msg.text,messages:[],createdAt:Date.now()};cid=id;save();rList();rMsgs();}break;
    case 'chat:load-history':try{var h=JSON.parse(msg.text||'{}');if(h.chats)chats=h.chats;if(h.currentChatId)cid=h.currentChatId;save();rList();rMsgs();}catch(ex){}break;
  }
});

load();rList();rMsgs();rChips();pi.focus();
})();
</script>
</body>
</html>`;
}
