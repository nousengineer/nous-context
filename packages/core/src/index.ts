import 'reflect-metadata';

// Database
export { getDatabase, closeDatabase } from './database';
export type { DatabaseOptions } from './database';

// Entities
export { Project, ContextEntry, Decision, ApiKey } from './entities';

// Services
export { ProjectService, ContextService, DecisionService, ApiKeyService } from './services';

// Export
export { exportProject, getExportFilename } from './export';
export type { ExportFormat } from './export';

// Validation
export * from './validation/schemas';

// Utils
export { CryptoUtils } from './utils/crypto';

// Chat
export { ChatService } from './chat';
export type { ChatMessage } from './chat';
