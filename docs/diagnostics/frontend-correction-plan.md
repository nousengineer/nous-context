# Plano de Correcao: Implementacao Frontend - Safety Net

> Data: 2025-01-16
> Autor: Code Reviewer (ThinkCoffee)
> Status: ACAO REQUERIDA

---

## 1. Contexto

O Frontend Engineer falhou em implementar o frontend. Este documento especifica EXATAMENTE o que deve ser criado.

## 2. Estado Atual

### Servicos Core (JA EXISTEM - NAO MODIFICAR)

| Servico | Arquivo | Status |
|---------|---------|--------|
| ActionLogService | packages/core/src/services/ActionLogService.ts | OK |
| SnapshotService | packages/core/src/services/SnapshotService.ts | OK |
| RollbackService | packages/core/src/services/RollbackService.ts | OK |

### SafetyNetPanel (PARCIALMENTE IMPLEMENTADO)

- Arquivo: packages/vscode/src/views/SafetyNetPanel.ts
- Status: Estrutura existe, mas falta o HTML do webview

---

## 3. Arquivos a Criar

### 3.1 Webview HTML (PRIORIDADE ALTA)

Arquivo: packages/vscode/resources/safetynet/index.html

Este arquivo deve conter:
- Tabela de Action Logs
- Lista de Snapshots
- Botoes de Rollback
- Indicador Dry-Run
- Estilos CSS inline ou separado

### 3.2 Webview JavaScript (PRIORIDADE ALTA)

Arquivo: packages/vscode/resources/safetynet/main.js

Este arquivo deve implementar:
- Comunicacao com extensao via acquireVsCodeApi()
- Renderizacao dinamica de logs e snapshots
- Handlers para botoes de rollback
- Atualizacao automatica da UI

### 3.3 Estilos CSS (PRIORIDADE MEDIA)

Arquivo: packages/vscode/resources/safetynet/styles.css

---

## 4. Especificacao de Implementacao

### 4.1 index.html - Estrutura Base

A pagina deve ter:
1. Header com titulo Safety Net
2. Secao Status (dry-run indicator)
3. Secao Snapshots (lista com botao rollback)
4. Secao Action Logs (tabela)
5. Footer com botao Refresh

### 4.2 main.js - Funcionalidades

1. acquireVsCodeApi() para comunicacao
2. Listener para mensagens da extensao
3. Funcao renderSnapshots(data)
4. Funcao renderActionLogs(data)
5. Handler para rollback com confirmacao
6. Handler para refresh

### 4.3 Comunicacao Webview-Extension

Mensagens da Extension para Webview:
- { type: 'update', data: { snapshots, actionLog, dryRunEnabled } }

Mensagens do Webview para Extension:
- { command: 'refresh' }
- { command: 'rollback', pipelineId, phaseIndex }
- { command: 'previewRollback', pipelineId, phaseIndex }

---

## 5. Instrucoes para o Frontend Engineer

### REGRAS OBRIGATORIAS

1. Usar write_file para criar cada arquivo
2. Criar diretorio packages/vscode/resources/safetynet/
3. NAO apenas descrever - IMPLEMENTAR codigo funcional
4. Testar comunicacao webview-extension

### Ordem de Execucao

1. Criar packages/vscode/resources/safetynet/styles.css
2. Criar packages/vscode/resources/safetynet/main.js
3. Criar packages/vscode/resources/safetynet/index.html
4. Atualizar SafetyNetPanel.ts para usar os novos recursos

---

## 6. Criterios de Aceite

- [ ] Arquivos criados no diretorio correto
- [ ] HTML renderiza corretamente no webview
- [ ] Botao Refresh funciona
- [ ] Lista de snapshots exibida
- [ ] Tabela de action logs exibida
- [ ] Botao Rollback com confirmacao
- [ ] Indicador dry-run visivel
