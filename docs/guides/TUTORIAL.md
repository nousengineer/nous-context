# ThinkCoffee - Tutorial de Uso

Guia completo para gerenciar contexto de projetos com ThinkCoffee via **CLI** e **MCP Server**.

---

## Indice

1. [Instalacao](#1-instalacao)
2. [Primeiros Passos - CLI](#2-primeiros-passos---cli)
3. [Gerenciando Projetos](#3-gerenciando-projetos)
4. [Gerenciando Contexto](#4-gerenciando-contexto)
5. [Registrando Decisoes](#5-registrando-decisoes)
6. [Exportando para Ferramentas de IA](#6-exportando-para-ferramentas-de-ia)
7. [Usando via MCP Server](#7-usando-via-mcp-server)
8. [Configurando no Claude Desktop](#8-configurando-no-claude-desktop)
9. [Categorias e Prioridades](#9-categorias-e-prioridades)
10. [Referencia Rapida](#10-referencia-rapida)

---

## 1. Instalacao

```bash
# Clone e instale dependencias
git clone https://github.com/seu-usuario/thinkcoffee.git
cd thinkcoffee
pnpm install

# Build de todos os pacotes
pnpm build
```

Os dados sao armazenados localmente em `~/.thinkcoffee/data.sqlite`. Nenhuma conta ou servico externo e necessario.

---

## 2. Primeiros Passos - CLI

O CLI esta disponivel via o comando `think`. Para ver todos os comandos:

```bash
think --help
think <comando> --help
```

### Inicializando num projeto existente

Navegue ate o diretorio do seu projeto e execute:

```bash
think init --name "Meu Projeto" --description "App de delivery com React Native"
```

Isso cria o projeto no banco de dados e gera um arquivo `.thinkcoffee` no diretorio com o ID do projeto.

---

## 3. Gerenciando Projetos

### Criar um projeto

```bash
think project create "E-commerce API" --description "Backend REST API com Node.js e PostgreSQL"
```

Saida:

```
Project created: E-commerce API
  ID: a1b2c3d4-...
```

> Guarde o **ID** — voce vai usar em outros comandos.

### Listar projetos

```bash
think project list
```

Saida:

```
Projects:

  E-commerce API (a1b2c3d4...)
    Status: active | Contexts: 0 | Decisions: 0
    Created: Apr 5, 2026
```

### Ver detalhes

```bash
think project show a1b2c3d4-...
```

### Deletar projeto

```bash
think project delete a1b2c3d4-...
```

> Isso remove o projeto e **todos** os contextos e decisoes associados (cascade delete).

---

## 4. Gerenciando Contexto

Entradas de contexto sao pedacos de informacao sobre seu projeto que voce quer que ferramentas de IA conheçam.

### Adicionar contexto

```bash
think ctx add <projectId> <chave> <valor> [opcoes]
```

Exemplos praticos:

```bash
# Stack tecnologica
think ctx add a1b2c3d4 tech-stack "Node.js 20, TypeScript 5, PostgreSQL 16, Redis" \
  -c architecture -p 4

# Convenções de codigo
think ctx add a1b2c3d4 code-style "Usar camelCase para variaveis, PascalCase para classes. Nunca usar any." \
  -c standards -p 3

# Dependencias importantes
think ctx add a1b2c3d4 orm "TypeORM com migrations manuais, nunca synchronize em producao" \
  -c dependencies -p 3

# Requisitos de negocio
think ctx add a1b2c3d4 auth "Autenticacao via JWT com refresh tokens, OAuth2 para login social" \
  -c requirements -p 2
```

**Opcoes:**

- `-c, --category <cat>` — Categoria (default: `general`)
- `-p, --priority <n>` — Prioridade 1-4, onde 4 = mais importante (default: `1`)

### Listar contexto

```bash
# Todos
think ctx list a1b2c3d4

# Filtrado por categoria
think ctx list a1b2c3d4 -c architecture
```

### Buscar contexto

```bash
think ctx search a1b2c3d4 "TypeScript"
```

### Atualizar contexto

```bash
think ctx update <entryId> -v "Novo valor atualizado" -p 4
```

### Remover contexto

```bash
think ctx remove <entryId>
```

---

## 5. Registrando Decisoes

Decisoes arquiteturais (ADRs) documentam o **que** foi decidido, **por que**, e quais **alternativas** existiam.

### Adicionar decisao

```bash
think dec add <projectId> <titulo> <descricao> [opcoes]
```

Exemplo:

```bash
think dec add a1b2c3d4 \
  "Usar PostgreSQL" \
  "PostgreSQL por suporte a JSONB, full-text search nativo e extensions como PostGIS" \
  -r "Precisamos de queries complexas e tipos de dados avancados" \
  -a "MySQL (menos features), MongoDB (NoSQL nao ideal para relacional), SQLite (nao escala)"
```

**Opcoes:**

- `-r, --rationale <texto>` — Justificativa
- `-a, --alternatives <texto>` — Alternativas consideradas

### Listar decisoes

```bash
think dec list a1b2c3d4
```

### Atualizar status

```bash
# Marcar como superada
think dec update <decisionId> -s superseded

# Status possiveis: active, deprecated, superseded
```

### Remover decisao

```bash
think dec remove <decisionId>
```

---

## 6. Exportando para Ferramentas de IA

ThinkCoffee exporta seu contexto em **6 formatos**, incluindo formatos nativos para Copilot, Claude e Cursor.

### Exportar para um formato especifico

```bash
# Markdown (default)
think export a1b2c3d4

# JSON
think export a1b2c3d4 -f json

# Para stdout (nao cria arquivo)
think export a1b2c3d4 -f markdown --stdout

# Para arquivo customizado
think export a1b2c3d4 -f json -o ./docs/context.json
```

### Formatos e arquivos gerados

| Formato    | Arquivo gerado                    | Para                |
| ---------- | --------------------------------- | ------------------- |
| `copilot`  | `.github/copilot-instructions.md` | GitHub Copilot      |
| `claude`   | `CLAUDE.md`                       | Claude Code         |
| `cursor`   | `.cursorrules`                    | Cursor              |
| `markdown` | `<projeto>-context.md`            | Uso geral           |
| `json`     | `<projeto>-context.json`          | Integracoes via API |
| `plain`    | `<projeto>-context.txt`           | Texto puro          |

### Sync — exportar para todas as ferramentas de uma vez

```bash
think sync a1b2c3d4
```

Gera automaticamente:

- `.github/copilot-instructions.md`
- `CLAUDE.md`
- `.cursorrules`

> Execute `think sync` sempre que atualizar o contexto para manter todas as ferramentas sincronizadas.

---

## 7. Usando via MCP Server

O MCP Server permite que ferramentas de IA (Claude, Copilot, etc.) acessem seu contexto **diretamente** durante a conversa, sem precisar exportar arquivos.

### Tools disponiveis via MCP

| Tool              | Descricao                                    |
| ----------------- | -------------------------------------------- |
| `list_projects`   | Listar todos os projetos                     |
| `create_project`  | Criar novo projeto                           |
| `get_project`     | Ver projeto completo com contexto e decisoes |
| `delete_project`  | Deletar projeto                              |
| `add_context`     | Adicionar entrada de contexto                |
| `update_context`  | Atualizar entrada existente                  |
| `remove_context`  | Remover entrada de contexto                  |
| `list_context`    | Listar entradas (com filtro por categoria)   |
| `search_context`  | Buscar por palavra-chave                     |
| `add_decision`    | Registrar decisao arquitetural               |
| `update_decision` | Atualizar decisao                            |
| `remove_decision` | Remover decisao                              |
| `list_decisions`  | Listar decisoes do projeto                   |
| `export_context`  | Exportar em qualquer formato                 |

### Resources MCP

| Resource          | URI                                          | Descricao                       |
| ----------------- | -------------------------------------------- | ------------------------------- |
| `projects`        | `thinkcoffee://projects`                     | Lista JSON de todos os projetos |
| `project-context` | `thinkcoffee://projects/{projectId}/context` | Contexto completo em Markdown   |

### Prompts MCP

| Prompt                 | Descricao                                       |
| ---------------------- | ----------------------------------------------- |
| `project_context`      | Contexto completo do projeto para consumo da IA |
| `architecture_summary` | Resumo de arquitetura + decisoes ativas         |

---

## 8. Configurando no Claude Desktop

### 1. Localize o arquivo de configuracao

```
Windows: %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\claude_desktop_config.json
macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
```

### 2. Adicione o servidor MCP

```json
{
  "mcpServers": {
    "thinkcoffee": {
      "command": "cmd",
      "args": [
        "/c",
        "C:\\caminho\\para\\thinkcoffee\\packages\\mcp-server\\run.cmd"
      ]
    }
  }
}
```

> No macOS/Linux, use diretamente:
>
> ```json
> {
>   "command": "node",
>   "args": ["/caminho/para/thinkcoffee/packages/mcp-server/dist/index.js"],
>   "cwd": "/caminho/para/thinkcoffee"
> }
> ```

### 3. Reinicie o Claude Desktop

Apos salvar o arquivo, reinicie o Claude Desktop. O servidor ThinkCoffee aparecera na lista de ferramentas MCP.

### Exemplo de uso no Claude

Depois de configurado, voce pode dizer ao Claude:

> "Liste meus projetos ThinkCoffee"

> "Adicione ao projeto X que usamos React 19 com Server Components como stack do frontend"

> "Qual o contexto completo do projeto E-commerce API?"

> "Exporte o contexto do projeto X no formato copilot"

---

## 9. Categorias e Prioridades

### Categorias

| Categoria      | Uso                                                |
| -------------- | -------------------------------------------------- |
| `architecture` | Stack, design do sistema, estrutura de componentes |
| `requirements` | Objetivos, features, especificacoes                |
| `dependencies` | Bibliotecas, servicos externos, integracoes        |
| `standards`    | Code style, convencoes, patterns                   |
| `general`      | Informacoes diversas                               |

### Prioridades

| Prioridade | Significado                                   |
| ---------- | --------------------------------------------- |
| `4`        | Critico — sempre deve ser considerado pela IA |
| `3`        | Importante — alta relevancia                  |
| `2`        | Moderado — util mas nao essencial             |
| `1`        | Baixo — informacao complementar (default)     |

---

## 10. Referencia Rapida

```bash
# Projetos
think project create "Nome" -d "Descricao"
think project list
think project show <id>
think project delete <id>

# Contexto
think ctx add <projectId> <chave> <valor> -c <categoria> -p <prioridade>
think ctx list <projectId> [-c <categoria>]
think ctx search <projectId> <query>
think ctx update <id> [-k chave] [-v valor] [-c cat] [-p n]
think ctx remove <id>

# Decisoes
think dec add <projectId> <titulo> <descricao> [-r rationale] [-a alternativas]
think dec list <projectId>
think dec update <id> [-t titulo] [-d desc] [-s status]
think dec remove <id>

# Export
think export <projectId> [-f formato] [-o arquivo] [--stdout]
think sync <projectId>

# Inicializar no diretorio atual
think init -n "Nome" -d "Descricao"
```

---

## Armazenamento

- **Banco local:** `~/.thinkcoffee/data.sqlite`
- Sem cloud, sem conta, sem telemetria
- Para resetar tudo, delete o arquivo `.sqlite`
