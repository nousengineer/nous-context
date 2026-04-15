/**
 * IAgentRegistry - Registro central de agentes
 * 
 * Permite registrar, descobrir e gerenciar agentes no sistema.
 * Suporta agentes builtin e customizados (plugins).
 */

import type { IAgent, AgentRole, AgentCapability } from './IAgent';

// ─── Registry Events ─────────────────────────────────────────

/**
 * Eventos emitidos pelo registry.
 */
export type RegistryEventType = 
  | 'agent:registered'
  | 'agent:unregistered'
  | 'agent:updated';

export interface RegistryEvent {
  type: RegistryEventType;
  role: AgentRole;
  agent?: IAgent;
  timestamp: string;
}

export type RegistryEventCallback = (event: RegistryEvent) => void;

// ─── Agent Filter ────────────────────────────────────────────

/**
 * Filtro para busca de agentes.
 */
export interface AgentFilter {
  /** Filtrar por roles especificos */
  roles?: AgentRole[];
  
  /** Filtrar por capabilities */
  capabilities?: string[];
  
  /** Filtrar por author */
  author?: string;
  
  /** Filtrar por versao (semver range) */
  versionRange?: string;
  
  /** Filtrar por tags */
  tags?: string[];
  
  /** Funcao customizada de filtro */
  predicate?: (agent: IAgent) => boolean;
}

// ─── IAgentRegistry ──────────────────────────────────────────

/**
 * Interface do registro de agentes.
 * 
 * @example
 * ```typescript
 * // Registrar um agente
 * registry.register(new MyCustomAgent());
 * 
 * // Obter agente por role
 * const agent = registry.get('backend');
 * 
 * // Buscar por capability
 * const agents = registry.getByCapability('git-commit');
 * 
 * // Listar todos
 * const all = registry.list();
 * ```
 */
export interface IAgentRegistry {
  // ─── CRUD ────────────────────────────────────────────────
  
  /**
   * Registra um agente no sistema.
   * 
   * @throws Se ja existir um agente com o mesmo role
   */
  register(agent: IAgent): void;
  
  /**
   * Registra um agente, substituindo se ja existir.
   */
  registerOrReplace(agent: IAgent): void;
  
  /**
   * Remove um agente do registro.
   * 
   * @returns true se o agente foi removido, false se nao existia
   */
  unregister(role: AgentRole): boolean;
  
  /**
   * Obtem um agente por role.
   * 
   * @returns O agente ou undefined se nao encontrado
   */
  get(role: AgentRole): IAgent | undefined;
  
  /**
   * Obtem um agente por role, lancando erro se nao encontrado.
   * 
   * @throws Se o agente nao existir
   */
  getOrThrow(role: AgentRole): IAgent;
  
  // ─── Query ───────────────────────────────────────────────
  
  /**
   * Lista todos os agentes registrados.
   */
  list(): IAgent[];
  
  /**
   * Verifica se um role esta registrado.
   */
  has(role: AgentRole): boolean;
  
  /**
   * Conta quantos agentes estao registrados.
   */
  count(): number;
  
  /**
   * Obtem agentes que possuem uma capability especifica.
   */
  getByCapability(capabilityId: string): IAgent[];
  
  /**
   * Obtem agentes que possuem TODAS as capabilities especificadas.
   */
  getByCapabilities(capabilityIds: string[]): IAgent[];
  
  /**
   * Busca agentes usando um filtro.
   */
  filter(filter: AgentFilter): IAgent[];
  
  /**
   * Lista todas as capabilities unicas registradas.
   */
  listCapabilities(): AgentCapability[];
  
  /**
   * Lista todos os roles registrados.
   */
  listRoles(): AgentRole[];
  
  // ─── Events ──────────────────────────────────────────────
  
  /**
   * Registra um listener para eventos do registry.
   * 
   * @returns Funcao para remover o listener
   */
  on(event: RegistryEventType, callback: RegistryEventCallback): () => void;
  
  /**
   * Remove todos os listeners de um tipo de evento.
   */
  off(event: RegistryEventType): void;
  
  // ─── Bulk Operations ─────────────────────────────────────
  
  /**
   * Registra multiplos agentes de uma vez.
   */
  registerAll(agents: IAgent[]): void;
  
  /**
   * Remove todos os agentes (cuidado!).
   */
  clear(): void;
}

// ─── Default Implementation ──────────────────────────────────

/**
 * Implementacao default do AgentRegistry.
 * 
 * Pode ser estendida ou substituida para casos especiais.
 */
export class AgentRegistry implements IAgentRegistry {
  private _agents: Map<AgentRole, IAgent> = new Map();
  private _listeners: Map<RegistryEventType, Set<RegistryEventCallback>> = new Map();
  
  constructor(initialAgents: IAgent[] = []) {
    for (const agent of initialAgents) {
      this._agents.set(agent.metadata.role, agent);
    }
  }
  
  // ─── CRUD ────────────────────────────────────────────────
  
  register(agent: IAgent): void {
    const role = agent.metadata.role;
    if (this._agents.has(role)) {
      throw new Error(`AgentRegistry: agente '${role}' ja registrado`);
    }
    this._agents.set(role, agent);
    this._emit('agent:registered', role, agent);
  }
  
  registerOrReplace(agent: IAgent): void {
    const role = agent.metadata.role;
    const existed = this._agents.has(role);
    this._agents.set(role, agent);
    this._emit(existed ? 'agent:updated' : 'agent:registered', role, agent);
  }
  
  unregister(role: AgentRole): boolean {
    const existed = this._agents.delete(role);
    if (existed) {
      this._emit('agent:unregistered', role);
    }
    return existed;
  }
  
  get(role: AgentRole): IAgent | undefined {
    return this._agents.get(role);
  }
  
  getOrThrow(role: AgentRole): IAgent {
    const agent = this._agents.get(role);
    if (!agent) {
      throw new Error(`AgentRegistry: agente '${role}' nao encontrado`);
    }
    return agent;
  }
  
  // ─── Query ───────────────────────────────────────────────
  
  list(): IAgent[] {
    return Array.from(this._agents.values());
  }
  
  has(role: AgentRole): boolean {
    return this._agents.has(role);
  }
  
  count(): number {
    return this._agents.size;
  }
  
  getByCapability(capabilityId: string): IAgent[] {
    return this.list().filter(agent =>
      agent.metadata.capabilities.some(cap => cap.id === capabilityId)
    );
  }
  
  getByCapabilities(capabilityIds: string[]): IAgent[] {
    return this.list().filter(agent => {
      const agentCapIds = agent.metadata.capabilities.map(c => c.id);
      return capabilityIds.every(id => agentCapIds.includes(id));
    });
  }
  
  filter(filter: AgentFilter): IAgent[] {
    let agents = this.list();
    
    if (filter.roles?.length) {
      agents = agents.filter(a => filter.roles!.includes(a.metadata.role));
    }
    
    if (filter.capabilities?.length) {
      agents = agents.filter(a => {
        const capIds = a.metadata.capabilities.map(c => c.id);
        return filter.capabilities!.some(id => capIds.includes(id));
      });
    }
    
    if (filter.author) {
      agents = agents.filter(a => a.metadata.author === filter.author);
    }
    
    if (filter.tags?.length) {
      agents = agents.filter(a => {
        const agentTags = a.metadata.capabilities.flatMap(c => c.tags ?? []);
        return filter.tags!.some(t => agentTags.includes(t));
      });
    }
    
    if (filter.predicate) {
      agents = agents.filter(filter.predicate);
    }
    
    return agents;
  }
  
  listCapabilities(): AgentCapability[] {
    const capMap = new Map<string, AgentCapability>();
    for (const agent of this._agents.values()) {
      for (const cap of agent.metadata.capabilities) {
        if (!capMap.has(cap.id)) {
          capMap.set(cap.id, cap);
        }
      }
    }
    return Array.from(capMap.values());
  }
  
  listRoles(): AgentRole[] {
    return Array.from(this._agents.keys());
  }
  
  // ─── Events ──────────────────────────────────────────────
  
  on(event: RegistryEventType, callback: RegistryEventCallback): () => void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(callback);
    
    return () => {
      this._listeners.get(event)?.delete(callback);
    };
  }
  
  off(event: RegistryEventType): void {
    this._listeners.delete(event);
  }
  
  // ─── Bulk Operations ─────────────────────────────────────
  
  registerAll(agents: IAgent[]): void {
    for (const agent of agents) {
      this.register(agent);
    }
  }
  
  clear(): void {
    for (const role of this._agents.keys()) {
      this._emit('agent:unregistered', role);
    }
    this._agents.clear();
  }
  
  // ─── Private ─────────────────────────────────────────────
  
  private _emit(type: RegistryEventType, role: AgentRole, agent?: IAgent): void {
    const event: RegistryEvent = {
      type,
      role,
      agent,
      timestamp: new Date().toISOString(),
    };
    
    const callbacks = this._listeners.get(type);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(event);
        } catch (err) {
          console.error(`[AgentRegistry] Error in event listener:`, err);
        }
      }
    }
  }
}

// ─── Global Registry ─────────────────────────────────────────

let _globalRegistry: IAgentRegistry | null = null;

/**
 * Obtem o registry global de agentes.
 */
export function getAgentRegistry(): IAgentRegistry {
  if (!_globalRegistry) {
    _globalRegistry = new AgentRegistry();
  }
  return _globalRegistry;
}

/**
 * Define o registry global (para testes ou config custom).
 */
export function setAgentRegistry(registry: IAgentRegistry): void {
  _globalRegistry = registry;
}
