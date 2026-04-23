import * as vscode from 'vscode';
import type { OllamaChatMessage, OllamaModelInfo } from './types';

/**
 * Converts a VS Code LM model to an Ollama-compatible name.
 * Format: "{family}:{vendor}" — e.g. "gpt-4o:copilot"
 */
export function modelToOllamaName(model: vscode.LanguageModelChat): string {
    return `${model.family}:${model.vendor}`;
}

/**
 * Lists all available VS Code LM models and converts them to Ollama format.
 */
export async function listVSCodeModels(): Promise<OllamaModelInfo[]> {
    const models = await vscode.lm.selectChatModels();
    const now = new Date().toISOString();
    return models.map((m) => {
        const digest = `sha256:${Buffer.from(`${m.family}${m.vendor}${m.version}`).toString('hex').padEnd(64, '0').slice(0, 64)}`;
        return {
            name: modelToOllamaName(m),
            model: modelToOllamaName(m),
            modified_at: now,
            size: 0,
            digest,
            details: {
                parent_model: '',
                format: 'api',
                family: m.family,
                families: [m.family],
                parameter_size: m.maxInputTokens > 0 ? `${m.maxInputTokens}ctx` : 'unknown',
                quantization_level: 'none',
            },
        };
    });
}

/**
 * Finds a VS Code LM model by Ollama-style name.
 *
 * Accepts:
 *  - "family"            e.g. "gpt-4o"
 *  - "family:latest"     treated same as "family"
 *  - "family:vendor"     e.g. "gpt-4o:copilot"
 */
export async function findModel(
    ollamaModelName: string,
): Promise<vscode.LanguageModelChat | undefined> {
    const [family, tag] = ollamaModelName.split(':');
    const vendor = tag && tag !== 'latest' ? tag : undefined;

    const selector: vscode.LanguageModelChatSelector = { family };
    if (vendor) {
        selector.vendor = vendor;
    }

    const matched = await vscode.lm.selectChatModels(selector);
    if (matched.length > 0) {
        return matched[0];
    }

    // Fallback: case-insensitive search across all models
    const all = await vscode.lm.selectChatModels();
    const lower = family.toLowerCase();
    return all.find(
        (m) =>
            m.family.toLowerCase() === lower ||
            m.id.toLowerCase() === lower ||
            m.name.toLowerCase().includes(lower),
    );
}

/**
 * Converts Ollama chat messages to VS Code LM chat messages.
 * - "system" and "user" roles map to User messages
 * - "assistant" role maps to Assistant messages
 * - "tool" role is ignored (not supported by VS Code LM API)
 */
export function toVSCodeMessages(
    messages: OllamaChatMessage[],
): vscode.LanguageModelChatMessage[] {
    const result: vscode.LanguageModelChatMessage[] = [];
    for (const msg of messages) {
        if (msg.role === 'tool') {
            continue;
        }
        if (msg.role === 'assistant') {
            result.push(vscode.LanguageModelChatMessage.Assistant(msg.content));
        } else {
            result.push(vscode.LanguageModelChatMessage.User(msg.content));
        }
    }
    return result;
}

/**
 * Extracts text value from a VS Code LM stream chunk.
 * Returns undefined if the chunk is not a text part.
 */
export function getChunkText(chunk: unknown): string | undefined {
    // vscode.LanguageModelTextPart has a `value` string property
    if (chunk && typeof (chunk as { value?: unknown }).value === 'string') {
        return (chunk as { value: string }).value;
    }
    return undefined;
}

/**
 * Computes total character count across Ollama chat messages (used as a
 * rough prompt_eval_count proxy since token counts are unavailable).
 */
export function countMessageChars(messages: OllamaChatMessage[]): number {
    return messages.reduce((sum, m) => sum + m.content.length, 0);
}
