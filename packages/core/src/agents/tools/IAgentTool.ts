/**
 * IAgentTool - Contrato para ferramentas de agentes
 * 
 * Define a interface que tools devem implementar para serem
 * usados pelos agentes durante execucao.
 */

import type { AgentRole } from '../contracts/IAgent';

// ─── Tool Parameter ──────────────────────────────────────────

/**
 * Tipos de parametros suportados.
 */
export type ToolParameterType = 
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array';

/**
 * Definicao de um parametro de tool.
 */
export interface ToolParameter {
  /** Nome do parametro */
  name: string;
  
  /** Tipo do parametro */
  type: ToolParameterType;
  
  /** Descricao para o modelo */
  description: string;
  
  /** Se e obrigatorio */
  required: boolean;
  
  /** Valor default (se nao obrigatorio) */
  default?: unknown;
  
  /** Valores permitidos (enum) */
  enum?: unknown[];
  
  /** Schema de items (se type = 'array') */
  items?: { type: ToolParameterType };
  
  /** Schema de properties (se type = 'object') */
  properties?: Record<string, Omit<ToolParameter, 'name' | 'required'>>;
}

// ─── Tool Context ────────────────────────────────────────────

/**
 * Contexto passado para execucao de tools.
 */
export interface ToolContext {
  /** Caminho do workspace */
  workspace: string;
  
  /** ID do projeto */
  projectId: string;
  
  /** Role do agente executando */
  agentRole: AgentRole;
  
  /** ID do pipeline */
  pipelineId?: string;
  
  /** ID da task */
  taskId?: string;
  
  /** Signal para cancelamento */
  signal?: AbortSignal;
  
  /** Se esta em modo dry-run */
  dryRun?: boolean;
  
  /** Logger (opcional) */
  logger?: ToolLogger;
}

/**
 * Logger para tools.
 */
export interface ToolLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

// ─── Tool Result ─────────────────────────────────────────────

/**
 * Resultado da execucao de um tool.
 */
export interface ToolResult {
  /** Execucao foi bem sucedida? */
  success: boolean;
  
  /** Output textual para o modelo */
  output: string;
  
  /** Mensagem de erro (se success = false) */
  error?: string;
  
  /** Codigo de erro (para handling especifico) */
  errorCode?: string;
  
  /** Arquivos criados/modificados */
  artifacts?: string[];
  
  /** Dados estruturados (opcional) */
  data?: Record<string, unknown>;
  
  /** Se o resultado deve ser truncado */
  truncated?: boolean;
}

// ─── Agent Tool ──────────────────────────────────────────────

/**
 * Interface de um tool de agente.
 * 
 * @example
 * ```typescript
 * const readFileTool: AgentTool = {
 *   name: 'read_file',
 *   description: 'Read contents of a file',
 *   parameters: [
 *     { name: 'path', type: 'string', description: 'File path', required: true },
 *   ],
 *   inputSchema: {
 *     type: 'object',
 *     properties: { path: { type: 'string' } },
 *     required: ['path'],
 *   },
 *   async execute(params, ctx) {
 *     const content = fs.readFileSync(path.join(ctx.workspace, params.path), 'utf-8');
 *     return { success: true, output: content };
 *   },
 * };
 * ```
 */
export interface AgentTool {
  /** Nome unico do tool (usado pelo modelo) */
  name: string;
  
  /** Descricao para o modelo */
  description: string;
  
  /** Parametros do tool */
  parameters: ToolParameter[];
  
  /** JSON Schema dos parametros (para API do modelo) */
  inputSchema: Record<string, unknown>;
  
  /** Roles que podem usar este tool (vazio = todos) */
  allowedRoles?: AgentRole[];
  
  /** Roles que NAO podem usar este tool */
  deniedRoles?: AgentRole[];
  
  /** Se o tool modifica arquivos/estado */
  isMutating?: boolean;
  
  /** Se requer confirmacao do usuario */
  requiresConfirmation?: boolean;
  
  /** Categoria do tool (para agrupamento) */
  category?: string;
  
  /** Tags para busca */
  tags?: string[];
  
  /**
   * Executor do tool.
   * 
   * @param params - Parametros passados pelo modelo
   * @param context - Contexto de execucao
   * @returns Resultado da execucao
   */
  execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
  
  /**
   * Valida os parametros antes de executar (opcional).
   * 
   * @param params - Parametros a validar
   * @returns Erro de validacao ou undefined se valido
   */
  validate?(params: Record<string, unknown>): string | undefined;
}

// ─── Tool Builder ────────────────────────────────────────────

/**
 * Builder para criar tools de forma fluente.
 * 
 * @example
 * ```typescript
 * const myTool = new ToolBuilder('my_tool')
 *   .description('Does something cool')
 *   .parameter('input', 'string', 'The input', true)
 *   .parameter('options', 'object', 'Extra options', false)
 *   .allowedRoles(['backend', 'frontend'])
 *   .mutating()
 *   .executor(async (params, ctx) => {
 *     // implementacao
 *     return { success: true, output: 'done' };
 *   })
 *   .build();
 * ```
 */
export class ToolBuilder {
  private _tool: Partial<AgentTool>;
  private _params: ToolParameter[] = [];
  
  constructor(name: string) {
    this._tool = { name };
  }
  
  description(desc: string): this {
    this._tool.description = desc;
    return this;
  }
  
  parameter(
    name: string,
    type: ToolParameterType,
    description: string,
    required: boolean,
    options?: Partial<ToolParameter>
  ): this {
    this._params.push({ name, type, description, required, ...options });
    return this;
  }
  
  allowedRoles(roles: AgentRole[]): this {
    this._tool.allowedRoles = roles;
    return this;
  }
  
  deniedRoles(roles: AgentRole[]): this {
    this._tool.deniedRoles = roles;
    return this;
  }
  
  mutating(value = true): this {
    this._tool.isMutating = value;
    return this;
  }
  
  requiresConfirmation(value = true): this {
    this._tool.requiresConfirmation = value;
    return this;
  }
  
  category(cat: string): this {
    this._tool.category = cat;
    return this;
  }
  
  tags(tags: string[]): this {
    this._tool.tags = tags;
    return this;
  }
  
  executor(fn: AgentTool['execute']): this {
    this._tool.execute = fn;
    return this;
  }
  
  validator(fn: AgentTool['validate']): this {
    this._tool.validate = fn;
    return this;
  }
  
  build(): AgentTool {
    if (!this._tool.name || !this._tool.description || !this._tool.execute) {
      throw new Error('ToolBuilder: name, description e executor sao obrigatorios');
    }
    
    // Gerar inputSchema a partir dos parametros
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    
    for (const param of this._params) {
      properties[param.name] = {
        type: param.type,
        description: param.description,
        ...(param.enum && { enum: param.enum }),
        ...(param.items && { items: param.items }),
        ...(param.properties && { properties: param.properties }),
        ...(param.default !== undefined && { default: param.default }),
      };
      if (param.required) {
        required.push(param.name);
      }
    }
    
    return {
      ...this._tool,
      parameters: this._params,
      inputSchema: {
        type: 'object',
        properties,
        required,
      },
    } as AgentTool;
  }
}

// ─── Tool Registry ───────────────────────────────────────────

/**
 * Registro de tools.
 */
export interface IToolRegistry {
  /** Registra um tool */
  register(tool: AgentTool): void;
  
  /** Remove um tool */
  unregister(name: string): boolean;
  
  /** Obtem um tool por nome */
  get(name: string): AgentTool | undefined;
  
  /** Lista todos os tools */
  list(): AgentTool[];
  
  /** Lista tools disponiveis para um role */
  getForRole(role: AgentRole): AgentTool[];
  
  /** Lista tools por categoria */
  getByCategory(category: string): AgentTool[];
}

/**
 * Implementacao do registro de tools.
 */
export class ToolRegistry implements IToolRegistry {
  private _tools: Map<string, AgentTool> = new Map();
  
  register(tool: AgentTool): void {
    this._tools.set(tool.name, tool);
  }
  
  unregister(name: string): boolean {
    return this._tools.delete(name);
  }
  
  get(name: string): AgentTool | undefined {
    return this._tools.get(name);
  }
  
  list(): AgentTool[] {
    return Array.from(this._tools.values());
  }
  
  getForRole(role: AgentRole): AgentTool[] {
    return this.list().filter(tool => {
      // Se tem allowedRoles, verifica se o role esta na lista
      if (tool.allowedRoles && tool.allowedRoles.length > 0) {
        if (!tool.allowedRoles.includes(role)) return false;
      }
      // Se tem deniedRoles, verifica se o role NAO esta na lista
      if (tool.deniedRoles && tool.deniedRoles.length > 0) {
        if (tool.deniedRoles.includes(role)) return false;
      }
      return true;
    });
  }
  
  getByCategory(category: string): AgentTool[] {
    return this.list().filter(t => t.category === category);
  }
}

// ─── Global Registry ─────────────────────────────────────────

let _globalToolRegistry: IToolRegistry | null = null;

/**
 * Obtem o registro global de tools.
 */
export function getToolRegistry(): IToolRegistry {
  if (!_globalToolRegistry) {
    _globalToolRegistry = new ToolRegistry();
  }
  return _globalToolRegistry;
}

/**
 * Define o registro global (para testes).
 */
export function setToolRegistry(registry: IToolRegistry): void {
  _globalToolRegistry = registry;
}
