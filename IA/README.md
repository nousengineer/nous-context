# IA - Copilot LLM APIs only

Esta pasta contem apenas arquivos relacionados ao uso da API de modelos de linguagem do GitHub Copilot no VS Code.

## Conteudo

- `vscode-copilot-api/package.json`
  - Manifesto da extensao VS Code (base para uso da API).
- `vscode-copilot-api/src/agents/ModelRegistry.ts`
  - Descoberta de modelos via `vscode.lm.selectChatModels({ vendor: 'copilot' })`.
- `vscode-copilot-api/src/agents/AutonomousRuntime.ts`
  - Fluxos de chamada de modelo com `model.sendRequest(...)`.
- `vscode-copilot-api/src/agents/services/AdaptiveReasoningService.ts`
- `vscode-copilot-api/src/agents/services/CodeGenerationService.ts`
- `vscode-copilot-api/src/agents/services/MultimodalAnalysisService.ts`
  - Servicos com exemplos praticos de prompt e execucao de requests.

## API principal usada

- Selecionar modelos: `vscode.lm.selectChatModels(...)`
- Criar mensagens: `vscode.LanguageModelChatMessage.User(...)`
- Enviar request: `model.sendRequest(messages, options, token)`
