# VS Code LLM Server

A VS Code extension that exposes the LLMs available in VS Code (via GitHub Copilot and other providers) through an **Ollama-compatible HTTP API**.

Any tool that works with Ollama — Open WebUI, Continue.dev, Cursor, LangChain, llama-index, etc. — can use VS Code's LLMs without any changes.

## Default URL

```
http://127.0.0.1:11434
```

## Implemented Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Returns `"Ollama is running"` |
| `HEAD` | `/` | 200 OK liveness check |
| `GET` | `/api/version` | Returns server version |
| `GET` | `/api/tags` | Lists available VS Code LM models |
| `GET` | `/v1/models` | OpenAI-compatible model list |
| `POST` | `/api/generate` | Generate a completion (streaming + non-streaming) |
| `POST` | `/api/chat` | Chat completion (streaming + non-streaming) |
| `POST` | `/api/show` | Show model details |
| `POST` | `/api/embed` | Returns 501 (not supported) |

## Model Names

Models are exposed as `{family}:{vendor}`, for example:

- `gpt-4o:copilot`
- `claude-sonnet-4-5:copilot`
- `gemini-2.0-flash:copilot`

You can also use just the family name with `:latest` (e.g. `gpt-4o:latest`) and the server will resolve the correct model.

## Quick Start

```bash
# Check if server is running
curl http://127.0.0.1:11434

# List available models
curl http://127.0.0.1:11434/api/tags

# Chat (streaming)
curl http://127.0.0.1:11434/api/chat -d '{
  "model": "gpt-4o:copilot",
  "messages": [{"role": "user", "content": "Why is the sky blue?"}]
}'

# Generate (non-streaming)
curl http://127.0.0.1:11434/api/generate -d '{
  "model": "gpt-4o:copilot",
  "prompt": "Why is the sky blue?",
  "stream": false
}'
```

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `vscode-llm-server.host` | `127.0.0.1` | Bind address |
| `vscode-llm-server.port` | `11434` | Port number |
| `vscode-llm-server.autoStart` | `true` | Start automatically on VS Code open |

## Commands

- **LLM Server: Start** — Start the HTTP server
- **LLM Server: Stop** — Stop the HTTP server
- **LLM Server: Show Status** — Show current status and open output channel
- **LLM Server: List Available Models** — Print available models to the output channel

## Requirements

- VS Code 1.90+
- GitHub Copilot extension (or another VS Code LM provider)

## Build

```bash
cd vscode-llm-server
pnpm install
pnpm build
pnpm package   # creates .vsix
```
