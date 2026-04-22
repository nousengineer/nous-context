# 🚀 ThinkCoffee - Getting Started Guide

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm 8+
- PostgreSQL or SQLite (auto-setup)
- OpenAI or Claude API key (optional but recommended)

### Installation

```bash
# Clone repository
git clone https://github.com/thinkcoffee/thinkcoffee.git
cd thinkcoffee

# Install dependencies
pnpm install

# Setup environment
cp .env.example .env.local
# Edit .env.local with your API keys
```

### Environment Variables

```bash
# Database
DATABASE_URL=sqlite:./thinkcoffee.db

# JWT
JWT_SECRET=your-super-secret-key-change-this
JWT_EXPIRY=7d

# API
API_PORT=3000
API_HOST=localhost

# Claude API (optional)
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-3-opus-20250219
CLAUDE_TEMPERATURE=1

# OpenAI API (optional)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4-turbo
OPENAI_TEMPERATURE=0.7

# AI Provider Selection
AI_PROVIDER=claude  # or: openai, ollama, mock
```

### Build & Run

```bash
# Build core package
pnpm build:core

# Build MCP server
pnpm build:mcp

# Start API server
cd packages/mcp-server
pnpm start:api

# Server running at http://localhost:3000
```

---

## Core Workflows

### 1. User Registration & Authentication

**Create Account:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "secure-password",
    "firstName": "John",
    "lastName": "Doe"
  }'

# Response:
{
  "success": true,
  "data": {
    "user": { "id": "user-123", "email": "user@example.com" },
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "refresh-token-..."
  }
}
```

**Login:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "secure-password"
  }'
```

### 2. Create Workspace

**Setup Multi-tenant Workspace:**
```bash
curl -X POST http://localhost:3000/api/v1/workspaces \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Company",
    "slug": "my-company",
    "description": "Main workspace"
  }'

# Response:
{
  "success": true,
  "data": {
    "workspace": {
      "id": "ws-123",
      "name": "My Company",
      "ownerId": "user-123",
      "members": [...]
    }
  }
}
```

### 3. Create Agent

**Setup AI Agent:**
```bash
curl -X POST http://localhost:3000/api/v1/agents \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws-123",
    "name": "CodeReviewBot",
    "description": "Reviews code for quality and security",
    "capabilities": ["code-analysis", "security-analysis", "reasoning"],
    "config": {
      "model": "claude-3-opus-20250219",
      "temperature": 0.7,
      "systemPrompt": "You are an expert code reviewer..."
    }
  }'

# Response:
{
  "success": true,
  "data": {
    "agent": {
      "id": "agent-456",
      "name": "CodeReviewBot",
      "state": "idle",
      "capabilities": [...],
      "tasksCompleted": 0,
      "tasksFailed": 0
    }
  }
}
```

### 4. Create & Execute Task

**Code Analysis Task:**
```bash
# Step 1: Create task
curl -X POST http://localhost:3000/api/v1/tasks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws-123",
    "agentId": "agent-456",
    "type": "code-analysis",
    "description": "Analyze this Python code",
    "input": {
      "code": "def calculate(items):\n  total = 0\n  for i in range(len(items)):\n    for j in range(len(items)):\n      total += items[i] * items[j]\n  return total",
      "language": "python",
      "analysisType": "all"
    }
  }'

# Response:
{
  "success": true,
  "data": {
    "task": {
      "id": "task-789",
      "status": "pending",
      "type": "code-analysis",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  }
}

# Step 2: Execute task
curl -X POST http://localhost:3000/api/v1/tasks/task-789/execute \
  -H "Authorization: Bearer <token>"

# Response:
{
  "success": true,
  "data": {
    "message": "Task execution started",
    "task": { ... }
  }
}

# Step 3: Check status
curl -X GET http://localhost:3000/api/v1/tasks/task-789 \
  -H "Authorization: Bearer <token>"

# Response includes:
# - status: "running" | "completed" | "failed"
# - output: { result: "...", artifacts: [...] }
# - reasoning: { reasoning: "...", steps: [...], confidence: 0.85 }
```

### 5. Generate Code

**Code Generation Task:**
```bash
curl -X POST http://localhost:3000/api/v1/tasks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws-123",
    "agentId": "agent-456",
    "type": "code-generation",
    "description": "Generate a FastAPI REST endpoint",
    "input": {
      "description": "Create a GET endpoint that returns user data with pagination support. Should validate query params and return proper error responses.",
      "language": "python",
      "framework": "FastAPI"
    }
  }'

# Execute and get generated code
curl -X POST http://localhost:3000/api/v1/tasks/task-XXX/execute \
  -H "Authorization: Bearer <token>"

# Result will contain:
# - Full, production-ready FastAPI endpoint
# - Type hints
# - Error handling
# - Documentation
```

### 6. Security Analysis

**Vulnerability Detection:**
```bash
curl -X POST http://localhost:3000/api/v1/security/analyze \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws-123",
    "targetId": "project-123",
    "targetName": "MyProject",
    "type": "code",
    "code": "SELECT * FROM users WHERE id = ${'id'}",
    "language": "sql"
  }'

# Response includes:
# - Vulnerabilities found (with severity)
# - CWE references
# - CVSS scores
# - Remediation steps
# - Risk recommendations
```

### 7. Check Execution Logs

**View Task Execution Details:**
```bash
curl -X GET http://localhost:3000/api/v1/tasks/task-789/logs \
  -H "Authorization: Bearer <token>"

# Response:
{
  "success": true,
  "data": [
    {
      "phase": "planning",
      "level": "info",
      "message": "Starting task execution...",
      "timestamp": "2024-01-15T10:30:01Z"
    },
    {
      "phase": "reasoning",
      "level": "info",
      "message": "Analyzing code structure...",
      "data": { "lines": 50, "complexity": "high" },
      "timestamp": "2024-01-15T10:30:05Z"
    },
    {
      "phase": "execution",
      "level": "info",
      "message": "Running analysis...",
      "timestamp": "2024-01-15T10:30:10Z"
    },
    {
      "phase": "validation",
      "level": "warn",
      "message": "O(n²) complexity detected in nested loop",
      "timestamp": "2024-01-15T10:30:15Z"
    },
    {
      "phase": "completion",
      "level": "info",
      "message": "Analysis completed",
      "data": { "tokensUsed": 1234, "duration": 14000 },
      "timestamp": "2024-01-15T10:30:20Z"
    }
  ]
}
```

### 8. Agent Metrics

**Monitor Agent Performance:**
```bash
curl -X GET http://localhost:3000/api/v1/agents/agent-456/metrics \
  -H "Authorization: Bearer <token>"

# Response:
{
  "success": true,
  "data": {
    "agentId": "agent-456",
    "tasksCompleted": 42,
    "tasksFailed": 2,
    "successRate": 0.955,
    "state": "running",
    "lastActivityAt": "2024-01-15T10:35:00Z"
  }
}
```

---

## Advanced Workflows

### Multi-Step Problem Solving

```bash
curl -X POST http://localhost:3000/api/v1/tasks \
  -d '{
    "workspaceId": "ws-123",
    "agentId": "agent-456",
    "type": "multi-step-problem-solving",
    "description": "Design a scalable authentication system",
    "input": {
      "problem": "We need to support 100M users across 5 regions with <50ms latency",
      "context": {
        "currentScale": "10M users",
        "regions": ["US", "EU", "APAC", "LATAM", "MENA"],
        "budget": "high",
        "timeline": "6 months"
      }
    }
  }'

# Returns:
# 1. Problem decomposition (5-10 steps)
# 2. Detailed reasoning for each step
# 3. Architecture recommendations
# 4. Implementation timeline
# 5. Risk assessment
```

### Create Workflow

**Multi-task Orchestration:**
```bash
curl -X POST http://localhost:3000/api/v1/workflows \
  -d '{
    "workspaceId": "ws-123",
    "name": "SecurityAudit",
    "description": "Complete security audit workflow",
    "steps": [
      {
        "id": "step-1",
        "name": "CodeAnalysis",
        "agentId": "agent-456",
        "taskType": "code-analysis",
        "input": { "analysisType": "security" }
      },
      {
        "id": "step-2",
        "name": "VulnerabilityScan",
        "agentId": "agent-789",
        "taskType": "vulnerability-scan",
        "dependsOn": ["step-1"]
      },
      {
        "id": "step-3",
        "name": "GenerateReport",
        "agentId": "agent-101",
        "taskType": "code-generation",
        "input": {
          "description": "Generate security report from findings",
          "language": "markdown"
        },
        "dependsOn": ["step-2"]
      }
    ],
    "triggers": [
      {
        "type": "manual"
      }
    ]
  }'

# Execute workflow
curl -X POST http://localhost:3000/api/v1/workflows/workflow-123/execute \
  -H "Authorization: Bearer <token>"
```

---

## Performance Tips

### 1. Provider Selection
```bash
# Best (uses local first, then paid)
AI_PROVIDER=best

# Free only (Ollama, Copilot, Mock)
AI_PROVIDER=free

# Paid options (Claude > OpenAI)
AI_PROVIDER=claude
```

### 2. Token Optimization
```javascript
// Use shorter prompts for simple tasks
// Use longer context for complex analysis
// Reuse provider instances

const provider = await getAIProvider('best');
const aiTaskService = new AITaskService(db, provider);

// All tasks use same provider = efficient
```

### 3. Caching Strategy
```bash
# Cache code analysis results
# Store generated code snippets
# Reuse vulnerability findings
```

---

## Troubleshooting

### API Key Not Found
```bash
# Check environment
echo $ANTHROPIC_API_KEY

# Verify in code
const provider = await getAIProvider('best');
console.log(provider.getConfig());
```

### Tasks Not Executing
```bash
# Check agent state
GET /api/v1/agents/agent-456

# Check task logs
GET /api/v1/tasks/task-789/logs

# Verify workspace
GET /api/v1/workspaces/ws-123
```

### Rate Limiting
```bash
# Automatic retry with backoff
# Check quota
const quota = await provider.getQuota();

# Use different provider
AI_PROVIDER=openai
```

---

## Next Steps

1. **Create your first agent** - Follow "Create Agent" section
2. **Execute a code analysis** - Follow "Code Analysis Task" section
3. **Monitor execution** - Check logs and metrics
4. **Scale to workflows** - Combine multiple agents
5. **Deploy to production** - See deployment guide

---

## Useful Links

- 📖 [Full API Documentation](../implementation/IMPLEMENTATION-PHASE4-AI-INTEGRATION.md)
- 🏗️ [Architecture Guide](../../architecture/ADVANCED-AGENTS-ARCHITECTURE.md)
- 📊 [Status Report](../summaries/STATUS-REPORT.md)
- 🔧 [Configuration Guide](../implementation/IMPLEMENTATION-PHASE3.md)

---

## Support

For issues or questions:
1. Check the logs: `GET /api/v1/tasks/:taskId/logs`
2. Review documentation
3. File a GitHub issue

**Happy automating! 🚀**
