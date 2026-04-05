import 'reflect-metadata';

// Database
export { getDatabase, closeDatabase } from './database';
export type { DatabaseOptions } from './database';

// Entities
export { Project, ContextEntry, Decision, ApiKey, SyncConfig, ChatHistory } from './entities';
export type { SyncTarget, SyncTrigger } from './entities/SyncConfig';
export type { ChatMessage } from './entities/ChatHistory';

// Services
export { ProjectService, ContextService, DecisionService, ApiKeyService, SyncConfigService, AutoSyncService, ChatHistoryService } from './services';
export type { CreateSyncConfigInput, UpdateSyncConfigInput, SyncResult } from './services/SyncConfigService';
export type { AutoSyncStatus } from './services/AutoSyncService';
export type { SaveHistoryInput, HistoryFilter, BackupInfo, RecoveryResult } from './services/ChatHistoryService';

// Export
export { exportProject, getExportFilename } from './export';
export type { ExportFormat } from './export';

// Validation
export * from './validation/schemas';

// Utils
export { CryptoUtils } from './utils/crypto';

// Chat
export { ChatService } from './chat';

// Pipeline
export { PipelineService, AGENT_META } from './pipeline';
export type { Pipeline, PipelinePhase, AgentTask, AgentRole, PhaseStatus, TaskStatus, PipelineStatus, PhaseTemplate } from './pipeline';

// Agent Config
export {
  loadAgentConfig, saveAgentConfig, getModelForAgent, setAgentModel,
  applyQualityPreset, isQualityPreset,
  recordModelFailure, getModelFailureCounts, loadModelFailures,
  getModelCost, getModelsByCostRange, getPresetRanking, getPMModelForPreset,
  DEFAULT_AGENT_MODELS, AVAILABLE_MODELS, QUALITY_PRESETS,
} from './agent-config';
export type { AgentModelConfig, PMModelAssignment, ModelFamily, QualityPreset, CostMultiplier, ModelFailureEntry, ModelFailureHistory } from './agent-config';
