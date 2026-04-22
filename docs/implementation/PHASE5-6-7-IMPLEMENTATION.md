# Phase 5, 6, 7: Advanced Implementation Guide

## 📋 Overview

ThinkCoffee now includes three advanced phases:
- **Phase 5**: Sandboxing & Real-time WebSocket Updates
- **Phase 6**: Workflow Execution Engine
- **Phase 7**: Advanced Security Analysis & Attack Simulation

---

## Phase 5: Task Execution with Sandboxing & WebSocket

### What It Does
- Executes code in isolated sandbox environments
- Enforces resource limits (memory, CPU, timeout)
- Streams real-time updates via WebSocket
- Supports JavaScript, Python, and analysis tasks

### Architecture

```
┌─────────────────────────────────────────────┐
│         Task Execution Pipeline              │
├─────────────────────────────────────────────┤
│                                               │
│  1. TaskExecutorService                      │
│     ├─ JavaScript (VM sandbox)               │
│     ├─ Python (subprocess with limits)       │
│     └─ Analysis (AI-powered)                 │
│                                               │
│  2. WebSocketServer (Real-time)              │
│     ├─ Task Updates                          │
│     ├─ Agent Status                          │
│     ├─ Workflow Progress                     │
│     └─ System Events                         │
│                                               │
│  3. Resource Management                      │
│     ├─ Active execution tracking             │
│     ├─ Memory monitoring                     │
│     └─ Concurrency control                   │
│                                               │
└─────────────────────────────────────────────┘
```

### Usage Example

#### 1. Task Execution

```typescript
import { TaskExecutorService, SandboxConfig } from '@thinkcoffee/core';

const executor = new TaskExecutorService(aiProvider);

// Configure sandbox
const config: SandboxConfig = {
  timeoutMs: 30000,      // 30 second timeout
  memoryLimitMb: 512,    // 512 MB limit
  cpuLimitMs: 10000,     // 10 second CPU limit
  maxFileSize: 10485760, // 10 MB
  allowedModules: ['fs', 'path', 'crypto'],
  isolationLevel: 'strict',
};

// Execute JavaScript
const result = await executor.executeTask(
  taskId,
  agentId,
  workspaceId,
  {
    code: `
      function analyzeCode(code) {
        const lines = code.split('\\n');
        return {
          lineCount: lines.length,
          characterCount: code.length,
          complexity: calculateComplexity(lines)
        };
      }
    `,
    language: 'javascript',
  },
  config
);

console.log(result);
// {
//   success: true,
//   output: { executed: true },
//   metrics: { duration: 145, ... },
//   executionId: 'exec-123'
// }
```

#### 2. Real-time WebSocket Updates

```typescript
import { WebSocketServer } from '@thinkcoffee/core';
import { createServer } from 'http';

const httpServer = createServer();
const wsServer = new WebSocketServer(httpServer, jwtSecret);

// On client side (JavaScript)
const socket = io('http://localhost:3000', {
  auth: {
    token: jwtToken,
  },
});

// Listen for task updates
socket.on('message', (message) => {
  if (message.type === 'task-update') {
    console.log(`Task ${message.taskId}: ${message.status} (${message.progress}%)`);
  }
});

// Subscribe to specific task
socket.emit('subscribe', {
  taskIds: ['task-123'],
  agentIds: ['agent-456'],
});

// Broadcast task update from server
wsServer.broadcastTaskUpdate({
  type: 'task-update',
  taskId: 'task-123',
  status: 'running',
  progress: 45,
  data: { processed: 1000 },
  timestamp: Date.now(),
});
```

#### 3. Monitoring Task Execution

```typescript
// Get active executions
const active = executor.getActiveExecutions();
console.log(`Running tasks: ${active.length}`);

// Get execution status
const status = executor.getExecutionStatus(executionId);
console.log(`Status: ${status?.result}`);
console.log(`Duration: ${status?.metrics.duration}ms`);

// Get resource stats
const stats = executor.getResourceStats();
console.log(`Memory: ${stats.memoryUsageMb}MB`);
console.log(`CPU: ${stats.cpuUsage}`);

// Cancel task if needed
await executor.cancelTask(executionId);
```

### Key Features

✅ **Security**
- VM isolation for JavaScript
- Process limits for Python
- No access to system calls
- Input validation

✅ **Performance**
- Concurrent execution up to 10 tasks
- Automatic queuing
- Resource monitoring
- Timeout enforcement

✅ **Observability**
- Real-time progress updates
- Detailed metrics
- Error tracking
- Execution history

---

## Phase 6: Workflow Execution Engine

### What It Does
- Executes multi-step workflows with dependencies
- Resolves task dependencies automatically
- Supports parallel execution
- Includes retry logic and error handling

### Architecture

```
Workflow Definition:
┌──────────────────────────────────────────────┐
│ Step 1: Analyze Code                         │
│   └─ dependencies: []                        │
├──────────────────────────────────────────────┤
│ Step 2: Generate Report                      │
│   └─ dependencies: [Step 1]                  │
├──────────────────────────────────────────────┤
│ Step 3a: Security Scan                       │
│   └─ dependencies: [Step 1]                  │
│                                               │
│ Step 3b: Performance Check                   │
│   └─ dependencies: [Step 1]                  │
│       (Can run in parallel with 3a)          │
├──────────────────────────────────────────────┤
│ Step 4: Create Recommendations               │
│   └─ dependencies: [Step 2, Step 3a, 3b]    │
└──────────────────────────────────────────────┘
```

### Usage Example

#### 1. Define Workflow

```typescript
import { WorkflowExecutionEngine, WorkflowDefinition } from '@thinkcoffee/core';

const engine = new WorkflowExecutionEngine();

// Define workflow
const workflow: WorkflowDefinition = {
  id: 'workflow-review-code',
  name: 'Code Review Workflow',
  description: 'Complete code analysis and review',
  version: '1.0.0',
  agentId: 'agent-123',
  workspaceId: 'ws-456',
  steps: [
    {
      id: 'step-1',
      name: 'Analyze Code',
      type: 'code-analysis',
      taskId: 'task-1',
      description: 'Perform initial code analysis',
      retryPolicy: {
        maxRetries: 2,
        backoffMs: 1000,
        backoffMultiplier: 2,
      },
      timeout: 60000,
    },
    {
      id: 'step-2',
      name: 'Security Check',
      type: 'security-analysis',
      taskId: 'task-2',
      dependencies: ['step-1'],
      timeout: 45000,
    },
    {
      id: 'step-3',
      name: 'Performance Review',
      type: 'performance-analysis',
      taskId: 'task-3',
      dependencies: ['step-1'],
      timeout: 45000,
    },
    {
      id: 'step-4',
      name: 'Generate Report',
      type: 'report-generation',
      taskId: 'task-4',
      dependencies: ['step-2', 'step-3'],
      timeout: 30000,
    },
  ],
  errorHandling: 'continue-on-error',
  timeout: 300000, // 5 minutes total
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// Register workflow
engine.registerWorkflow(workflow);

// Register step executors
engine.registerStepExecutor('code-analysis', async (step, context) => {
  // Implementation
  return { success: true, output: { analyzed: true } };
});

engine.registerStepExecutor('security-analysis', async (step, context) => {
  // Implementation
  return { success: true, output: { secure: true } };
});
```

#### 2. Execute Workflow

```typescript
// Set up event handlers
engine.onStepStart((execution, step) => {
  console.log(`Starting: ${step.stepId}`);
  wsServer.broadcastWorkflowProgress({
    type: 'workflow-progress',
    workflowId: execution.workflowId,
    status: 'running',
    progress: execution.progress,
    currentStep: Array.from(execution.stepExecutions.values()).filter(
      s => s.status === 'running'
    ).length,
    totalSteps: execution.stepExecutions.size,
  });
});

engine.onStepComplete((execution, step) => {
  console.log(`Completed: ${step.stepId}`);
});

engine.onStepFail((execution, step) => {
  console.log(`Failed: ${step.stepId}`);
});

engine.onWorkflowProgress((execution) => {
  console.log(`Progress: ${execution.progress}%`);
});

// Execute workflow
const execution = await engine.executeWorkflow(
  'workflow-review-code',
  'agent-123',
  'ws-456',
  { code: 'function test() { ... }' }, // Initial context
  'user-789'
);

console.log(`Workflow completed: ${execution.status}`);
console.log(`Steps: ${execution.stepExecutions.size}`);
console.log(`Errors: ${execution.errors.length}`);
console.log(`Duration: ${execution.duration}ms`);
```

#### 3. Monitor Workflow Execution

```typescript
// Get execution status
const status = engine.getExecution(executionId);
console.log(`Status: ${status.status}`);
console.log(`Progress: ${status.progress}%`);

// Check step results
for (const [stepId, stepExecution] of status.stepExecutions) {
  console.log(`${stepId}: ${stepExecution.status}`);
  if (stepExecution.result) {
    console.log(`  Result: ${JSON.stringify(stepExecution.result)}`);
  }
  if (stepExecution.error) {
    console.log(`  Error: ${stepExecution.error}`);
  }
}

// Pause execution
engine.pauseExecution(executionId);

// Cancel execution
engine.cancelExecution(executionId);
```

### Key Features

✅ **Dependency Resolution**
- Automatic topological sorting
- Parallel execution when possible
- Circular dependency detection

✅ **Retry Logic**
- Configurable retry policies
- Exponential backoff
- Per-step timeout

✅ **Error Handling**
- Fail-fast mode
- Continue-on-error mode
- Error collection and reporting

✅ **Progress Tracking**
- Real-time progress updates
- Step-level metrics
- Execution context sharing

---

## Phase 7: Advanced Security Analysis & Attack Simulation

### What It Does
- Comprehensive vulnerability detection
- CWE/CVE classification
- CVSS scoring
- Attack vector identification
- Attack simulation & testing
- Threat modeling

### Architecture

```
Security Analysis Pipeline:
┌──────────────────────────────────────────────┐
│ 1. Pattern Detection                         │
│    ├─ SQL Injection patterns                 │
│    ├─ XSS patterns                           │
│    ├─ Hardcoded secrets                      │
│    └─ Authorization flaws                    │
├──────────────────────────────────────────────┤
│ 2. AI-Based Analysis (Extended Thinking)     │
│    ├─ Deep reasoning about vulnerabilities  │
│    ├─ Zero-day discovery                     │
│    └─ Context-aware analysis                 │
├──────────────────────────────────────────────┤
│ 3. Attack Vector Mapping                     │
│    ├─ Identify exploitation paths            │
│    ├─ Calculate likelihood & impact          │
│    └─ Map to OWASP/CWE                       │
├──────────────────────────────────────────────┤
│ 4. Threat Modeling                           │
│    ├─ Component analysis                     │
│    ├─ Threat-per-component                   │
│    └─ Risk scoring                           │
├──────────────────────────────────────────────┤
│ 5. Recommendations                           │
│    ├─ Critical fixes                         │
│    ├─ Detection strategies                   │
│    └─ Design improvements                    │
└──────────────────────────────────────────────┘
```

### Usage Example

#### 1. Security Analysis

```typescript
import { AdvancedSecurityAnalysisService } from '@thinkcoffee/core';

const securityAnalysis = new AdvancedSecurityAnalysisService(aiProvider);

// Analyze code
const result = await securityAnalysis.analyzeCode(
  `
    function getUserData(userId) {
      const query = "SELECT * FROM users WHERE id = " + userId;
      return database.execute(query);
    }
  `,
  'javascript',
  {
    filename: 'userService.js',
    framework: 'Express.js',
    dependencies: ['mysql', 'express'],
  }
);

console.log(`Analysis ID: ${result.analysisId}`);
console.log(`Threat Score: ${result.threatScore}/100`);
console.log(`Risk Level: ${result.riskLevel}`);
console.log(`Confidence: ${result.confidence}%`);

// Vulnerabilities found
for (const vuln of result.vulnerabilities) {
  console.log(`
    ${vuln.title} (${vuln.cweId})
    Severity: ${vuln.severity}
    CVSS: ${vuln.cvssScore}
    Attack Vector: ${vuln.attackVector}
  `);
}

// Attack vectors
for (const vector of result.attackVectors) {
  console.log(`
    Attack: ${vector.name}
    Likelihood: ${vector.likelihood}
    Impact: ${vector.impact}
    Steps:
      ${vector.steps.join('\n      ')}
  `);
}

// Recommendations
for (const rec of result.recommendations) {
  console.log(`
    [${rec.priority.toUpperCase()}] ${rec.title}
    ${rec.description}
    Effort: ${rec.estimatedEffort}
    Steps:
      ${rec.steps.join('\n      ')}
  `);
}
```

#### 2. Attack Simulation

```typescript
import { AttackSimulationFramework } from '@thinkcoffee/core';

const attackSimulation = new AttackSimulationFramework();

// Run SQL injection simulation
const simulation = await attackSimulation.simulateAttack(
  vulnerabilityId,
  'sql-injection',
  'http://app.local/api/users',
  'fuzzing' // Attack pattern: random, sequential, fuzzing, encoding, obfuscation
);

console.log(`Simulation: ${simulation.simulationId}`);
console.log(`Status: ${simulation.status}`);
console.log(`
  Payloads attempted: ${simulation.metrics.payloadsAttempted}
  Payloads successful: ${simulation.metrics.payloadsSuccessful}
  Block rate: ${simulation.metrics.blockRatePercent.toFixed(2)}%
  Detected: ${simulation.results.detected}
  Exploitable: ${simulation.results.successful}
`);

// View detection events
for (const event of simulation.detectionEvents) {
  console.log(`
    [${event.type}] ${event.message}
    Severity: ${event.severity}
    Time: ${new Date(event.timestamp).toISOString()}
  `);
}

// Assessment
console.log(`
  Impact Assessment:
  - Data Access: ${simulation.results.impact.dataAccess}
  - Code Execution: ${simulation.results.impact.codeExecution}
  - System Compromise: ${simulation.results.impact.systemCompromise}
  - Privilege Escalation: ${simulation.results.impact.escalation}
`);
```

### Response Format

#### Security Analysis Response

```json
{
  "analysisId": "analysis-abc123",
  "codeHash": "sha256...",
  "scanDate": 1713607600000,
  "threatScore": 78,
  "riskLevel": "high",
  "confidence": 92,
  "summary": "Found 5 vulnerabilities (2 critical, 2 high) with 8 potential attack vectors",
  "vulnerabilities": [
    {
      "id": "vuln-1",
      "type": "cwe",
      "cweId": "CWE-89",
      "cweName": "SQL Injection",
      "title": "SQL Injection Vulnerability Detected",
      "description": "Unsanitized user input in SQL query",
      "severity": "critical",
      "cvssScore": 9.8,
      "confidentiality": 10,
      "integrity": 10,
      "availability": 10,
      "attackVector": "network",
      "attackComplexity": "low",
      "privilegesRequired": "none",
      "userInteraction": false,
      "discoveryDate": 1713607600000,
      "lineNumbers": [15, 16]
    }
  ],
  "attackVectors": [
    {
      "id": "vector-1",
      "name": "SQL Injection Attack",
      "attackType": "injection",
      "likelihood": "critical",
      "impact": "critical",
      "steps": ["Identify input field", "Craft payload", "Submit", "Extract data"],
      "detectionMethod": "Monitor logs for SQL keywords"
    }
  ],
  "recommendations": [
    {
      "type": "fix",
      "priority": "critical",
      "title": "Use parameterized queries",
      "steps": ["Replace string concatenation", "Use prepared statements"],
      "estimatedEffort": "low"
    }
  ]
}
```

### Key Features

✅ **Vulnerability Detection**
- 50+ pattern-based rules
- AI-powered zero-day discovery
- CWE classification
- CVSS scoring

✅ **Attack Simulation**
- Multiple attack patterns
- Payload generation & encoding
- Evasion technique testing
- Detection effectiveness measurement

✅ **Threat Modeling**
- Component-based analysis
- STRIDE methodology
- Likelihood & impact assessment
- Risk prioritization

✅ **Remediation**
- Actionable recommendations
- Effort estimation
- Detection strategies
- Design improvements

---

## Integration Example

```typescript
import { AdvancedFeaturesFactory } from '@thinkcoffee/core';
import { createServer } from 'http';
import express from 'express';

const app = express();
const httpServer = createServer(app);

// Initialize all advanced features
const features = new AdvancedFeaturesFactory({
  httpServer,
  jwtSecret: process.env.JWT_SECRET,
  aiProvider: anthropicProvider,
  enableTaskExecutor: true,
  enableWebSocket: true,
  enableWorkflowEngine: true,
  enableSecurityAnalysis: true,
  enableAttackSimulation: true,
});

// Use services
const executor = features.getTaskExecutor();
const wsServer = features.getWebSocketServer();
const workflow = features.getWorkflowEngine();
const security = features.getSecurityAnalysis();
const attack = features.getAttackSimulation();

// API Endpoints
app.post('/api/tasks/execute', async (req, res) => {
  const result = await executor.executeTask(
    req.body.taskId,
    req.body.agentId,
    req.body.workspaceId,
    req.body.code
  );
  res.json(result);
});

app.post('/api/workflows/execute', async (req, res) => {
  const execution = await workflow.executeWorkflow(
    req.body.workflowId,
    req.body.agentId,
    req.body.workspaceId
  );
  res.json(execution);
});

app.post('/api/security/analyze', async (req, res) => {
  const analysis = await security.analyzeCode(
    req.body.code,
    req.body.language
  );
  res.json(analysis);
});

app.post('/api/security/simulate', async (req, res) => {
  const simulation = await attack.simulateAttack(
    req.body.vulnerabilityId,
    req.body.attackType
  );
  res.json(simulation);
});

// System status
app.get('/api/system/status', (req, res) => {
  res.json(features.getSystemStatus());
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await features.shutdown();
  process.exit(0);
});

httpServer.listen(3000);
```

---

## Performance Considerations

### Task Executor
- Max 10 concurrent executions
- 30-second default timeout
- 512 MB memory limit
- Automatic queuing

### WebSocket
- ~1000 concurrent connections
- Binary frame compression
- Automatic reconnection
- Message history (1000 messages)

### Workflow Engine
- Topological dependency resolution
- Parallel execution support
- Configurable retry policies
- ~100 concurrent workflows

### Security Analysis
- AI-powered with 10K token budget
- Pattern matching for quick detection
- Caching of analysis results
- ~5 second analysis time

### Attack Simulation
- Multiple payload variants
- Encoding transformations
- Evasion technique testing
- ~10 payload attempts per simulation

---

## Best Practices

1. **Task Execution**
   - Set appropriate timeouts
   - Monitor resource usage
   - Use WebSocket for real-time feedback
   - Implement error handling

2. **Workflows**
   - Define clear dependencies
   - Use parallel execution when possible
   - Configure retry policies
   - Monitor step execution

3. **Security Analysis**
   - Run analysis in CI/CD pipeline
   - Cache results for performance
   - Use for pre-commit checks
   - Integrate with threat monitoring

4. **Attack Simulation**
   - Run in isolated environment
   - Document findings
   - Test remediation effectiveness
   - Use for red-team exercises

---

## Troubleshooting

### Task Execution Timeout
```typescript
// Increase timeout for complex tasks
const config: SandboxConfig = {
  timeoutMs: 60000, // Increase to 60 seconds
  // ... rest of config
};
```

### WebSocket Connection Issues
```typescript
// On client, implement reconnection
socket.on('disconnect', () => {
  socket.connect(); // Automatic reconnection
});
```

### Workflow Dependency Errors
```typescript
// Verify all dependencies exist
const definition = {
  steps: [...],
  // Check that all dependencies reference existing stepIds
};
```

### Security Analysis Accuracy
```typescript
// Improve accuracy with context
const analysis = await securityAnalysis.analyzeCode(code, 'javascript', {
  framework: 'React',
  dependencies: ['lodash', 'axios'],
  filename: 'utils.js',
});
```

---

**Next**: Deploy to production or implement Phase 8 (Advanced Monitoring)
