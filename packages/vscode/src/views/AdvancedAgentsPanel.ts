import * as vscode from 'vscode';

export class AdvancedAgentsPanel {
  public static currentPanel: AdvancedAgentsPanel | undefined;
  public static readonly viewType = 'thinkcoffee.advancedAgents';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        if (!message?.command) {
          return;
        }
        await vscode.commands.executeCommand(message.command);
      },
      null,
      this.disposables,
    );
    this.render();
  }

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (AdvancedAgentsPanel.currentPanel) {
      AdvancedAgentsPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      AdvancedAgentsPanel.viewType,
      'ThinkCoffee Advanced Agents',
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')],
      },
    );

    AdvancedAgentsPanel.currentPanel = new AdvancedAgentsPanel(panel);
  }

  public dispose(): void {
    AdvancedAgentsPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }

  private render(): void {
    const nonce = getNonce();
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ThinkCoffee</title>
<style>
body{font-family:var(--vscode-font-family);padding:12px;color:var(--vscode-editor-foreground)}
.grid{display:grid;grid-template-columns:1fr;gap:8px}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:8px;border-radius:4px;text-align:left;cursor:pointer}
button:hover{background:var(--vscode-button-hoverBackground)}
h3{margin:14px 0 8px}
</style>
</head>
<body>
<h2>ThinkCoffee Advanced Runtime</h2>
<p>Inicializacao das capacidades autonomas no VS Code.</p>
<h3>Reasoning</h3>
<div class="grid">
<button data-cmd="thinkcoffee.reasoning.adaptiveThink">Raciocinio adaptativo</button>
<button data-cmd="thinkcoffee.reasoning.multiStepSolve">Resolucao multi-etapas</button>
</div>
<h3>Software</h3>
<div class="grid">
<button data-cmd="thinkcoffee.advancedSoftware.generateCode">Geracao avancada de codigo</button>
<button data-cmd="thinkcoffee.advancedSoftware.debugCode">Debug automatico</button>
<button data-cmd="thinkcoffee.advancedSoftware.refactorCode">Refatoracao de codigo</button>
</div>
<h3>Security</h3>
<div class="grid">
<button data-cmd="thinkcoffee.advancedSecurity.scanVulnerabilities">Analise defensiva</button>
<button data-cmd="thinkcoffee.advancedSecurity.simulateAttack">Simulacao controlada</button>
<button data-cmd="thinkcoffee.advancedSecurity.zeroDayDiscovery">Descoberta avancada</button>
</div>
<h3>Multimodal & Workflow</h3>
<div class="grid">
<button data-cmd="thinkcoffee.advancedMultimodal.analyzeImage">Analise multimodal</button>
<button data-cmd="thinkcoffee.advancedMultimodal.analyzeDiagram">Interpretar diagramas</button>
<button data-cmd="thinkcoffee.advancedMultimodal.synthesizeKnowledge">Sintese interdisciplinar</button>
<button data-cmd="thinkcoffee.workflow.createComplex">Criar workflow complexo</button>
<button data-cmd="thinkcoffee.workflow.executeAutonomous">Executar autonomamente</button>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
for (const b of document.querySelectorAll('button[data-cmd]')) {
  b.addEventListener('click', () => vscode.postMessage({ command: b.getAttribute('data-cmd') }));
}
</script>
</body>
</html>`;

    this.panel.webview.html = html;
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
