import { Logger } from '../utils/Logger';
import TaskExecutorService from './TaskExecutorService';
import WebSocketServer from './WebSocketServer';
import WorkflowExecutionEngine from './WorkflowExecutionEngine';
import AdvancedSecurityAnalysisService from './AdvancedSecurityAnalysisService';
import AttackSimulationFramework from './AttackSimulationFramework';
import { Server as HTTPServer } from 'http';
import { AIProvider } from '../providers/AIProvider';

/**
 * Advanced Features Factory (Phase 5, 6, 7)
 * 
 * Integrates and orchestrates:
 * - Phase 5: Task executor with sandboxing & WebSocket real-time updates
 * - Phase 6: Workflow execution engine with dependency resolution
 * - Phase 7: Advanced security analysis & attack simulation
 */

export interface AdvancedFeaturesConfig {
  httpServer: HTTPServer;
  jwtSecret: string;
  aiProvider: AIProvider;
  enableTaskExecutor?: boolean;
  enableWebSocket?: boolean;
  enableWorkflowEngine?: boolean;
  enableSecurityAnalysis?: boolean;
  enableAttackSimulation?: boolean;
}

export class AdvancedFeaturesFactory {
  private taskExecutor: TaskExecutorService;
  private webSocketServer: WebSocketServer;
  private workflowEngine: WorkflowExecutionEngine;
  private securityAnalysis: AdvancedSecurityAnalysisService;
  private attackSimulation: AttackSimulationFramework;
  private logger = Logger.getInstance();

  constructor(config: AdvancedFeaturesConfig) {
    this.logger.info('[AdvancedFeatures] Initializing Phase 5, 6, 7 features');

    // Phase 5: Task Executor
    if (config.enableTaskExecutor !== false) {
      this.taskExecutor = new TaskExecutorService(config.aiProvider);
      this.logger.info('[AdvancedFeatures] Task Executor initialized');
    }

    // Phase 5: WebSocket Server
    if (config.enableWebSocket !== false) {
      this.webSocketServer = new WebSocketServer(config.httpServer, config.jwtSecret);
      this.logger.info('[AdvancedFeatures] WebSocket Server initialized');
    }

    // Phase 6: Workflow Engine
    if (config.enableWorkflowEngine !== false) {
      this.workflowEngine = new WorkflowExecutionEngine();
      this.logger.info('[AdvancedFeatures] Workflow Execution Engine initialized');
    }

    // Phase 7: Security Analysis
    if (config.enableSecurityAnalysis !== false) {
      this.securityAnalysis = new AdvancedSecurityAnalysisService(config.aiProvider);
      this.logger.info('[AdvancedFeatures] Advanced Security Analysis Service initialized');
    }

    // Phase 7: Attack Simulation
    if (config.enableAttackSimulation !== false) {
      this.attackSimulation = new AttackSimulationFramework();
      this.logger.info('[AdvancedFeatures] Attack Simulation Framework initialized');
    }
  }

  // Getters for services
  getTaskExecutor(): TaskExecutorService {
    return this.taskExecutor;
  }

  getWebSocketServer(): WebSocketServer {
    return this.webSocketServer;
  }

  getWorkflowEngine(): WorkflowExecutionEngine {
    return this.workflowEngine;
  }

  getSecurityAnalysis(): AdvancedSecurityAnalysisService {
    return this.securityAnalysis;
  }

  getAttackSimulation(): AttackSimulationFramework {
    return this.attackSimulation;
  }

  /**
   * Get comprehensive system status
   */
  getSystemStatus() {
    return {
      phase5: {
        taskExecutor: this.taskExecutor?.getResourceStats() || null,
        websocket: this.webSocketServer?.getStats() || null,
      },
      phase6: {
        workflowEngine: {
          initialized: !!this.workflowEngine,
        },
      },
      phase7: {
        securityAnalysis: {
          initialized: !!this.securityAnalysis,
        },
        attackSimulation: {
          initialized: !!this.attackSimulation,
        },
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Shutdown all services
   */
  async shutdown(): Promise<void> {
    this.logger.info('[AdvancedFeatures] Shutting down all services');

    if (this.webSocketServer) {
      await this.webSocketServer.close();
    }

    this.logger.info('[AdvancedFeatures] All services shut down');
  }
}

// Export all service types and interfaces
export {
  TaskExecutorService,
  SandboxConfig,
  ExecutionContext,
  ExecutionMetrics,
  ExecutionResult,
  SandboxedCode,
} from './TaskExecutorService';

export {
  WebSocketServer,
  WebSocketMessage,
  TaskUpdateMessage,
  AgentStatusMessage,
  WorkflowProgressMessage,
  ClientSubscription,
} from './WebSocketServer';

export {
  WorkflowExecutionEngine,
  WorkflowStep,
  WorkflowDefinition,
  StepExecution,
  WorkflowExecution,
  StepResult,
} from './WorkflowExecutionEngine';

export {
  AdvancedSecurityAnalysisService,
  Vulnerability,
  AttackVector,
  SecurityAnalysisResult,
  SecurityRecommendation,
  ThreatModel,
} from './AdvancedSecurityAnalysisService';

export {
  AttackSimulationFramework,
  AttackSimulation,
  AttackPayload,
  SimulationResult,
  DetectionEvent,
  SimulationMetrics,
} from './AttackSimulationFramework';

export default AdvancedFeaturesFactory;
