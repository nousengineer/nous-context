import * as http from 'http';
import * as https from 'https';

export interface OrchestratorClientConfig {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
}

export interface PlanRequest {
  workspaceId: string;
  objective: string;
  constraints?: string[];
  availableModalities?: Array<'text' | 'image'>;
  contextBudgetTokens?: number;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  deadlineMinutes?: number;
}

export interface PlanResponse {
  success: boolean;
  data?: {
    plan?: { id: string };
    warnings?: string[];
    id?: string;
  };
  error?: { code?: string; message?: string };
}

export interface RunResponse {
  success: boolean;
  data?: {
    id?: string;
    status?: string;
    currentStep?: number;
    completedAt?: string;
  };
  error?: { code?: string; message?: string };
}

export interface RunListResponse {
  success: boolean;
  data?: Array<{
    id: string;
    status?: string;
    currentStep?: number;
    createdAt?: string;
  }>;
  error?: { code?: string; message?: string };
}

export class OrchestratorHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly responseBody: string,
    public readonly responseJson?: unknown,
  ) {
    super(`HTTP ${statusCode}`);
    this.name = 'OrchestratorHttpError';
  }
}

function requestJson<T>(config: OrchestratorClientConfig, path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(path, config.baseUrl);
    const payload = body ? JSON.stringify(body) : undefined;
    const transport = endpoint.protocol === 'https:' ? https : http;

    const req = transport.request(
      {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port || undefined,
        path: `${endpoint.pathname}${endpoint.search}`,
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
          ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            if ((res.statusCode || 500) >= 400) {
              reject(new OrchestratorHttpError(res.statusCode || 500, data, parsed));
              return;
            }
            resolve(parsed as T);
          } catch (err) {
            if ((res.statusCode || 500) >= 400) {
              reject(new OrchestratorHttpError(res.statusCode || 500, data));
              return;
            }
            reject(err);
          }
        });
      },
    );

    req.on('error', (err: any) => reject(err));
    const timeoutMs = Math.max(5_000, config.timeoutMs ?? 30_000);
    req.setTimeout(timeoutMs, () => {
      const timeoutError = new Error(`Request timeout after ${timeoutMs}ms`) as Error & { code?: string };
      timeoutError.code = 'ETIMEDOUT';
      req.destroy(timeoutError);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

export class OrchestratorClient {
  constructor(private readonly config: OrchestratorClientConfig) {}

  async createPlan(input: PlanRequest): Promise<PlanResponse> {
    return requestJson<PlanResponse>(this.config, '/api/v1/orchestrator/plans', 'POST', input);
  }

  async startRun(workspaceId: string, planId: string): Promise<RunResponse> {
    return requestJson<RunResponse>(this.config, '/api/v1/orchestrator/runs', 'POST', {
      workspaceId,
      planId,
      autoExecute: true,
    });
  }

  async getRun(runId: string): Promise<RunResponse> {
    return requestJson<RunResponse>(this.config, `/api/v1/orchestrator/runs/${encodeURIComponent(runId)}`, 'GET');
  }

  async listRuns(workspaceId: string, status?: string): Promise<RunListResponse> {
    const query = status
      ? `?workspaceId=${encodeURIComponent(workspaceId)}&status=${encodeURIComponent(status)}`
      : `?workspaceId=${encodeURIComponent(workspaceId)}`;
    return requestJson<RunListResponse>(this.config, `/api/v1/orchestrator/runs${query}`, 'GET');
  }

  async getCheckpoints(runId: string): Promise<{ success: boolean; data?: unknown[]; error?: { message?: string } }> {
    return requestJson(this.config, `/api/v1/orchestrator/runs/${encodeURIComponent(runId)}/checkpoints`, 'GET');
  }

  async pauseRun(runId: string): Promise<RunResponse> {
    return requestJson<RunResponse>(this.config, `/api/v1/orchestrator/runs/${encodeURIComponent(runId)}/pause`, 'POST');
  }

  async resumeRun(runId: string): Promise<RunResponse> {
    return requestJson<RunResponse>(this.config, `/api/v1/orchestrator/runs/${encodeURIComponent(runId)}/resume`, 'POST');
  }
}
