# Phase 5, 6, 7: Quick Start Guide

## 📚 Installation

### 1. Install WebSocket Dependencies

```bash
cd packages/core
npm install socket.io
npm install --save-dev @types/node
```

### 2. Import New Services

Update `packages/core/src/index.ts`:

```typescript
// Add these exports
export {
  TaskExecutorService,
  WebSocketServer,
  WorkflowExecutionEngine,
  AdvancedSecurityAnalysisService,
  AttackSimulationFramework,
  AdvancedFeaturesFactory,
} from './services';
```

---

## 🚀 Quick Start

### Phase 5: Task Executor

```typescript
import { TaskExecutorService } from '@thinkcoffee/core';

const executor = new TaskExecutorService(aiProvider);

// Execute code
const result = await executor.executeTask(
  'task-1',
  'agent-1',
  'ws-1',
  {
    code: 'const sum = (a, b) => a + b; console.log(sum(2, 3));',
    language: 'javascript',
  }
);

console.log(result); // { success: true, ... }
```

### Phase 5: WebSocket Server

```typescript
import { WebSocketServer } from '@thinkcoffee/core';

const wsServer = new WebSocketServer(httpServer, jwtSecret);

// Broadcast task update
wsServer.broadcastTaskUpdate({
  type: 'task-update',
  taskId: 'task-1',
  status: 'running',
  progress: 50,
  data: {},
  timestamp: Date.now(),
});
```

### Phase 6: Workflow Engine

```typescript
import { WorkflowExecutionEngine } from '@thinkcoffee/core';

const engine = new WorkflowExecutionEngine();

// Register workflow
engine.registerWorkflow(workflowDefinition);

// Execute
const execution = await engine.executeWorkflow(
  'workflow-1',
  'agent-1',
  'ws-1'
);

console.log(execution.status); // 'completed' | 'failed' | ...
```

### Phase 7: Security Analysis

```typescript
import { AdvancedSecurityAnalysisService } from '@thinkcoffee/core';

const security = new AdvancedSecurityAnalysisService(aiProvider);

// Analyze code
const analysis = await security.analyzeCode(code, 'javascript');

console.log(analysis.threatScore); // 0-100
console.log(analysis.vulnerabilities); // Array of vulnerabilities
```

### Phase 7: Attack Simulation

```typescript
import { AttackSimulationFramework } from '@thinkcoffee/core';

const attack = new AttackSimulationFramework();

// Simulate attack
const simulation = await attack.simulateAttack(
  vulnerabilityId,
  'sql-injection',
  'http://app.local/api',
  'fuzzing'
);

console.log(simulation.status); // 'succeeded' | 'blocked' | 'failed'
console.log(simulation.metrics.blockRatePercent); // Detection %
```

---

## 🔌 Integration with Express

```typescript
import express from 'express';
import { createServer } from 'http';
import { AdvancedFeaturesFactory } from '@thinkcoffee/core';

const app = express();
const httpServer = createServer(app);

// Initialize features
const features = new AdvancedFeaturesFactory({
  httpServer,
  jwtSecret: process.env.JWT_SECRET,
  aiProvider,
});

// Task execution endpoint
app.post('/api/tasks/execute', async (req, res) => {
  try {
    const executor = features.getTaskExecutor();
    const result = await executor.executeTask(
      req.body.taskId,
      req.body.agentId,
      req.body.workspaceId,
      req.body.code
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Workflow endpoint
app.post('/api/workflows/execute', async (req, res) => {
  try {
    const engine = features.getWorkflowEngine();
    const execution = await engine.executeWorkflow(
      req.body.workflowId,
      req.body.agentId,
      req.body.workspaceId
    );
    res.json(execution);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Security analysis endpoint
app.post('/api/security/analyze', async (req, res) => {
  try {
    const security = features.getSecurityAnalysis();
    const analysis = await security.analyzeCode(
      req.body.code,
      req.body.language
    );
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Status endpoint
app.get('/api/system/status', (req, res) => {
  res.json(features.getSystemStatus());
});

httpServer.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

---

## 🧪 Testing Examples

### Test Task Executor

```bash
# Execute JavaScript
curl -X POST http://localhost:3000/api/tasks/execute \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-1",
    "agentId": "agent-1",
    "workspaceId": "ws-1",
    "code": {
      "code": "const x = 5 + 3; console.log(x);",
      "language": "javascript"
    }
  }'
```

### Test WebSocket

```javascript
// Client-side
const socket = io('http://localhost:3000', {
  auth: { token: jwtToken }
});

socket.on('connected', (data) => {
  console.log('Connected:', data.clientId);
});

socket.emit('subscribe', {
  taskIds: ['task-1'],
  messageTypes: ['task-update']
});

socket.on('message', (msg) => {
  console.log('Update:', msg);
});
```

### Test Workflow

```bash
curl -X POST http://localhost:3000/api/workflows/execute \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "workflow-1",
    "agentId": "agent-1",
    "workspaceId": "ws-1"
  }'
```

### Test Security Analysis

```bash
curl -X POST http://localhost:3000/api/security/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "code": "SELECT * FROM users WHERE id = \${userId}",
    "language": "sql"
  }'
```

---

## 📊 Monitoring

### Get System Status

```bash
curl http://localhost:3000/api/system/status

# Response:
{
  "phase5": {
    "taskExecutor": {
      "activeExecutions": 2,
      "memoryUsageMb": 145,
      "cpuUsage": 0.25
    },
    "websocket": {
      "connectedClients": 5,
      "rooms": 12,
      "messagesInHistory": 234
    }
  },
  "phase6": {
    "workflowEngine": {
      "initialized": true
    }
  },
  "phase7": {
    "securityAnalysis": { "initialized": true },
    "attackSimulation": { "initialized": true }
  },
  "timestamp": 1713607600000
}
```

---

## ⚙️ Configuration

### Task Executor Config

```typescript
const config: SandboxConfig = {
  timeoutMs: 30000,          // Task timeout
  memoryLimitMb: 512,        // Memory limit
  cpuLimitMs: 10000,         // CPU time limit
  maxFileSize: 10485760,     // 10 MB
  allowedModules: ['fs', 'path', 'crypto'],
  isolationLevel: 'strict',  // 'strict' | 'moderate' | 'permissive'
};
```

### WebSocket Config

```typescript
const wsServer = new WebSocketServer(httpServer, jwtSecret, {
  cors: {
    origin: ['http://localhost:3000', 'https://app.example.com'],
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e6,
});
```

### Workflow Config

```typescript
const definition: WorkflowDefinition = {
  timeout: 300000,              // 5 minutes total
  errorHandling: 'fail-fast',  // 'fail-fast' | 'continue-on-error'
  parallelSteps: [              // Steps that can run in parallel
    ['step-2a', 'step-2b'],
  ],
};
```

---

## 🔒 Security Checklist

- [ ] JWT token validation enabled
- [ ] Sandbox isolation configured
- [ ] Resource limits enforced
- [ ] WebSocket authentication required
- [ ] CORS properly configured
- [ ] Rate limiting implemented
- [ ] Error messages sanitized
- [ ] Logging enabled
- [ ] Monitoring alerts configured

---

## 📈 Performance Tuning

### Increase Concurrent Executions
```typescript
// In TaskExecutorService
private maxConcurrentExecutions: number = 20; // Increase from 10
```

### Increase WebSocket History
```typescript
// In WebSocketServer
private maxHistorySize: number = 5000; // Increase from 1000
```

### Optimize Workflow Engine
```typescript
// Parallel execution groups
const definition: WorkflowDefinition = {
  parallelSteps: [
    ['step-2', 'step-3', 'step-4'], // All run in parallel
    ['step-5'],
    ['step-6'],
  ],
};
```

---

## 🐛 Common Issues

### "Execution timeout"
→ Increase `timeoutMs` in SandboxConfig

### "WebSocket connection failed"
→ Check JWT token validity and CORS settings

### "Workflow stuck on step"
→ Check step dependencies and executor registration

### "Security analysis slow"
→ Reduce code size or implement caching

---

## 📚 Full Documentation

See [PHASE5-6-7-IMPLEMENTATION.md](./PHASE5-6-7-IMPLEMENTATION.md) for comprehensive guide.

---

**Status**: Phase 5, 6, 7 ✅ Complete
**Next**: Deploy to production or implement Phase 8 monitoring
