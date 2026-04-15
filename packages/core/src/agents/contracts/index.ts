/**
 * Exports dos contratos de agentes
 */

// Agent
export {
  type AgentRole,
  type BuiltinAgentRole,
  type AgentCapability,
  type AgentMetadata,
  type AgentResult,
  type IAgent,
  BaseAgent,
} from './IAgent';

// Context
export {
  type PreviousOutput,
  type PhaseInfo,
  type AgentEnvironment,
  type IAgentContext,
  AgentContextBuilder,
} from './IAgentContext';

// Registry
export {
  type RegistryEventType,
  type RegistryEvent,
  type RegistryEventCallback,
  type AgentFilter,
  type IAgentRegistry,
  AgentRegistry,
  getAgentRegistry,
  setAgentRegistry,
} from './IAgentRegistry';

// Lifecycle
export {
  type LifecyclePhase,
  type LifecycleEventBase,
  type PreExecuteEvent,
  type PostExecuteEvent,
  type ErrorEvent,
  type RetryEvent,
  type ToolCallEvent,
  type ToolResultEvent,
  type StreamChunkEvent,
  type CancelEvent,
  type LifecycleEvent,
  type HookResult,
  type IAgentLifecycleHook,
  type IAgentLifecycleManager,
  AgentLifecycleManager,
  getLifecycleManager,
  setLifecycleManager,
  loggingHook,
  metricsHook,
} from './IAgentLifecycle';
