<p align="center">
  <img src="logo.svg" alt="thinkCoffee logo" width="160"/>
</p>

# ThinkBrew Project

Este é o repositório principal do projeto ThinkBrew, um conjunto de ferramentas para aumentar a produtividade de desenvolvimento com o auxílio de IA.

## Arquitetura

O projeto utiliza uma arquitetura de monorepo gerenciada com PNPM Workspaces.

-   `packages/core`: Biblioteca com a lógica de negócio principal e tipos compartilhados.
-   `packages/mcp-server`: Servidor backend (Node.js/Express) que gerencia estado, projetos e agentes.
-   `packages/vscode`: Extensão para Visual Studio Code que serve como interface para o usuário.
-   `packages/cli`: Interface de linha de comando para interações com o sistema.

## Stack de Tecnologia

-   **Linguagem:** TypeScript
-   **Backend:** Node.js, Express.js, SQLite
-   **Frontend:** VS Code Extension API
-   **Testes:** Vitest
-   **Monorepo:** PNPM

## Modelo de Dados

O banco de dados (SQLite) contém as seguintes tabelas principais:

-   `Projects`: Armazena informações sobre os projetos importados.
-   `Agents`: Armazena as configurações e prompts dos agentes de IA.

## Contratos de API

A comunicação entre o frontend (`vscode`) e o backend (`mcp-server`) é feita via uma API REST. Para mais detalhes, consulte a documentação no diretório `docs`.

## Como Começar

1.  Clone o repositório.
2.  Instale o PNPM: `npm install -g pnpm`.
3.  Instale as dependências: `pnpm install`.
4.  Execute o build inicial: `pnpm run build`.
