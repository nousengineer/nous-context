import * as http from 'http';
import * as vscode from 'vscode';
import {
    findModel,
    getChunkText,
    listVSCodeModels,
    modelToOllamaName,
    toVSCodeMessages,
    countMessageChars,
} from './modelBridge';
import type {
    OllamaChatChunk,
    OllamaChatRequest,
    OllamaEmbedRequest,
    OllamaGenerateChunk,
    OllamaGenerateRequest,
    OllamaShowRequest,
    OllamaShowResponse,
    OllamaTagsResponse,
    OllamaVersionResponse,
} from './types';

const SERVER_VERSION = '0.1.0';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk: Buffer) => {
            data += chunk.toString();
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    if (res.writableEnded) return;
    const json = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(json),
    });
    res.end(json);
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
    sendJson(res, status, { error: message });
}

function nowNano(): number {
    return Number(process.hrtime.bigint());
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleTags(res: http.ServerResponse): Promise<void> {
    const models = await listVSCodeModels();
    const body: OllamaTagsResponse = { models };
    sendJson(res, 200, body);
}

function handleVersion(res: http.ServerResponse): void {
    const body: OllamaVersionResponse = { version: SERVER_VERSION };
    sendJson(res, 200, body);
}

async function handleGenerate(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    output: vscode.OutputChannel,
): Promise<void> {
    const raw = await readBody(req);
    let payload: OllamaGenerateRequest;
    try {
        payload = JSON.parse(raw);
    } catch {
        sendError(res, 400, 'invalid JSON in request body');
        return;
    }

    const model = await findModel(payload.model);
    if (!model) {
        sendError(res, 404, `model '${payload.model}' not found, try pulling it first`);
        return;
    }

    const messages: vscode.LanguageModelChatMessage[] = [];
    if (payload.system) {
        messages.push(vscode.LanguageModelChatMessage.User(payload.system));
        messages.push(vscode.LanguageModelChatMessage.Assistant('Understood.'));
    }
    messages.push(vscode.LanguageModelChatMessage.User(payload.prompt ?? ''));

    const stream = payload.stream !== false;
    const startNs = nowNano();
    const cts = new vscode.CancellationTokenSource();

    try {
        const lmResponse = await model.sendRequest(
            messages,
            { justification: 'VS Code LLM Server /api/generate request' },
            cts.token,
        );

        const promptChars = messages.reduce((s, m) => s + String(m.content).length, 0);
        const modelName = modelToOllamaName(model);

        if (stream) {
            res.writeHead(200, {
                'Content-Type': 'application/x-ndjson',
                'Transfer-Encoding': 'chunked',
            });

            let evalCount = 0;
            for await (const chunk of lmResponse.stream) {
                const text = getChunkText(chunk);
                if (text !== undefined) {
                    evalCount++;
                    const part: OllamaGenerateChunk = {
                        model: modelName,
                        created_at: new Date().toISOString(),
                        response: text,
                        done: false,
                    };
                    res.write(JSON.stringify(part) + '\n');
                }
            }

            const totalNs = nowNano() - startNs;
            const finalChunk: OllamaGenerateChunk = {
                model: modelName,
                created_at: new Date().toISOString(),
                response: '',
                done: true,
                done_reason: 'stop',
                total_duration: totalNs,
                load_duration: 0,
                prompt_eval_count: promptChars,
                prompt_eval_duration: Math.floor(totalNs * 0.1),
                eval_count: evalCount,
                eval_duration: Math.floor(totalNs * 0.9),
            };
            res.write(JSON.stringify(finalChunk) + '\n');
            res.end();
        } else {
            let fullText = '';
            for await (const chunk of lmResponse.stream) {
                const text = getChunkText(chunk);
                if (text !== undefined) {
                    fullText += text;
                }
            }

            const totalNs = nowNano() - startNs;
            const result: OllamaGenerateChunk = {
                model: modelName,
                created_at: new Date().toISOString(),
                response: fullText,
                done: true,
                done_reason: 'stop',
                total_duration: totalNs,
                load_duration: 0,
                prompt_eval_count: promptChars,
                prompt_eval_duration: Math.floor(totalNs * 0.1),
                eval_count: fullText.split(/\s+/).length,
                eval_duration: Math.floor(totalNs * 0.9),
            };
            sendJson(res, 200, result);
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        output.appendLine(`[/api/generate] Error: ${message}`);
        if (!res.headersSent) {
            sendError(res, 500, `generation failed: ${message}`);
        } else {
            res.end();
        }
    } finally {
        cts.dispose();
    }
}

async function handleChat(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    output: vscode.OutputChannel,
): Promise<void> {
    const raw = await readBody(req);
    let payload: OllamaChatRequest;
    try {
        payload = JSON.parse(raw);
    } catch {
        sendError(res, 400, 'invalid JSON in request body');
        return;
    }

    if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
        sendError(res, 400, 'messages array is required and must not be empty');
        return;
    }

    const model = await findModel(payload.model);
    if (!model) {
        sendError(res, 404, `model '${payload.model}' not found, try pulling it first`);
        return;
    }

    const messages = toVSCodeMessages(payload.messages);
    if (messages.length === 0) {
        sendError(res, 400, 'no valid messages after filtering');
        return;
    }

    const stream = payload.stream !== false;
    const startNs = nowNano();
    const cts = new vscode.CancellationTokenSource();

    try {
        const lmResponse = await model.sendRequest(
            messages,
            { justification: 'VS Code LLM Server /api/chat request' },
            cts.token,
        );

        const promptChars = countMessageChars(payload.messages);
        const modelName = modelToOllamaName(model);

        if (stream) {
            res.writeHead(200, {
                'Content-Type': 'application/x-ndjson',
                'Transfer-Encoding': 'chunked',
            });

            let evalCount = 0;
            for await (const chunk of lmResponse.stream) {
                const text = getChunkText(chunk);
                if (text !== undefined) {
                    evalCount++;
                    const part: OllamaChatChunk = {
                        model: modelName,
                        created_at: new Date().toISOString(),
                        message: { role: 'assistant', content: text },
                        done: false,
                    };
                    res.write(JSON.stringify(part) + '\n');
                }
            }

            const totalNs = nowNano() - startNs;
            const finalChunk: OllamaChatChunk = {
                model: modelName,
                created_at: new Date().toISOString(),
                message: { role: 'assistant', content: '' },
                done: true,
                done_reason: 'stop',
                total_duration: totalNs,
                load_duration: 0,
                prompt_eval_count: promptChars,
                prompt_eval_duration: Math.floor(totalNs * 0.1),
                eval_count: evalCount,
                eval_duration: Math.floor(totalNs * 0.9),
            };
            res.write(JSON.stringify(finalChunk) + '\n');
            res.end();
        } else {
            let fullText = '';
            for await (const chunk of lmResponse.stream) {
                const text = getChunkText(chunk);
                if (text !== undefined) {
                    fullText += text;
                }
            }

            const totalNs = nowNano() - startNs;
            const result: OllamaChatChunk = {
                model: modelName,
                created_at: new Date().toISOString(),
                message: { role: 'assistant', content: fullText },
                done: true,
                done_reason: 'stop',
                total_duration: totalNs,
                load_duration: 0,
                prompt_eval_count: promptChars,
                prompt_eval_duration: Math.floor(totalNs * 0.1),
                eval_count: fullText.split(/\s+/).length,
                eval_duration: Math.floor(totalNs * 0.9),
            };
            sendJson(res, 200, result);
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        output.appendLine(`[/api/chat] Error: ${message}`);
        if (!res.headersSent) {
            sendError(res, 500, `chat failed: ${message}`);
        } else {
            res.end();
        }
    } finally {
        cts.dispose();
    }
}

async function handleShow(
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> {
    const raw = await readBody(req);
    let payload: OllamaShowRequest;
    try {
        payload = JSON.parse(raw || '{}');
    } catch {
        sendError(res, 400, 'invalid JSON in request body');
        return;
    }

    if (!payload.model) {
        sendError(res, 400, 'model field is required');
        return;
    }

    const model = await findModel(payload.model);
    if (!model) {
        sendError(res, 404, `model '${payload.model}' not found`);
        return;
    }

    const body: OllamaShowResponse = {
        details: {
            parent_model: '',
            format: 'api',
            family: model.family,
            families: [model.family],
            parameter_size: model.maxInputTokens > 0 ? `${model.maxInputTokens}ctx` : 'unknown',
            quantization_level: 'none',
        },
        modelfile: `# ${model.family} via VS Code LM API\nFROM vscode/${model.vendor}/${model.family}\n`,
        template: '{{ .Prompt }}',
        modelinfo: {
            'general.architecture': 'api',
            'general.name': model.name,
            'general.family': model.family,
            'general.vendor': model.vendor,
            'general.version': model.version,
            'llm.context_length': model.maxInputTokens,
        },
    };
    sendJson(res, 200, body);
}

function handleEmbed(res: http.ServerResponse): void {
    sendError(res, 501, 'embeddings are not supported via VS Code LM API');
}

// ─── Server factory ───────────────────────────────────────────────────────────

export function createServer(output: vscode.OutputChannel): http.Server {
    const server = http.createServer(async (req, res) => {
        // Basic CORS for local tooling (e.g. Open WebUI, Ollama clients)
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        const method = req.method ?? 'GET';
        const url = (req.url ?? '/').split('?')[0]; // strip query params

        output.appendLine(`[server] ${method} ${url}`);

        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        try {
            // Root ping (Ollama compatibility check)
            if (method === 'GET' && url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Ollama is running');
                return;
            }

            if (method === 'HEAD' && url === '/') {
                res.writeHead(200);
                res.end();
                return;
            }

            if (method === 'GET' && url === '/api/version') {
                handleVersion(res);
                return;
            }

            // List models — Ollama uses /api/tags; OpenAI compat uses /v1/models
            if (method === 'GET' && (url === '/api/tags' || url === '/api/models')) {
                await handleTags(res);
                return;
            }

            // OpenAI-compatible models list (used by many Ollama clients)
            if (method === 'GET' && url === '/v1/models') {
                const models = await listVSCodeModels();
                sendJson(res, 200, {
                    object: 'list',
                    data: models.map((m) => ({
                        id: m.name,
                        object: 'model',
                        created: Math.floor(Date.now() / 1000),
                        owned_by: m.details.family,
                    })),
                });
                return;
            }

            if (method === 'POST' && url === '/api/generate') {
                await handleGenerate(req, res, output);
                return;
            }

            if (method === 'POST' && url === '/api/chat') {
                await handleChat(req, res, output);
                return;
            }

            if (method === 'POST' && url === '/api/show') {
                await handleShow(req, res);
                return;
            }

            if (method === 'POST' && url === '/api/embed') {
                handleEmbed(res);
                return;
            }

            // Unsupported but recognized Ollama endpoints
            if (method === 'POST' && url === '/api/pull') {
                sendError(res, 501, 'model pulling is not supported; models are provided by VS Code');
                return;
            }

            if (method === 'POST' && url === '/api/push') {
                sendError(res, 501, 'model pushing is not supported');
                return;
            }

            if (method === 'POST' && url === '/api/copy') {
                sendError(res, 501, 'model copying is not supported');
                return;
            }

            if (method === 'DELETE' && url === '/api/delete') {
                sendError(res, 501, 'model deletion is not supported');
                return;
            }

            if (method === 'POST' && url === '/api/create') {
                sendError(res, 501, 'model creation is not supported');
                return;
            }

            sendError(res, 404, `unknown endpoint: ${method} ${url}`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            output.appendLine(`[server] Unhandled error: ${message}`);
            if (!res.headersSent) {
                sendError(res, 500, `internal server error: ${message}`);
            }
        }
    });

    return server;
}
