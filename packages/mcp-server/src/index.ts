#!/usr/bin/env node

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  getDatabase,
  ProjectService,
  ContextService,
  DecisionService,
  exportProject,
  ExportFormat,
  ChatService,
} from '@thinkcoffee/core';
import type { ChatMessage } from '@thinkcoffee/core';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const CATEGORIES = ['architecture', 'requirements', 'dependencies', 'standards', 'general'] as const;

// ─── Workspace sandbox helpers ─────────────────────────────────
function getWorkspaceRoot(): string | null {
  // --workspace=<path> arg or THINKCOFFEE_WORKSPACE env
  const argIdx = process.argv.findIndex(a => a.startsWith('--workspace='));
  if (argIdx !== -1) return process.argv[argIdx].split('=')[1];
  if (process.argv.includes('--workspace') && process.argv[process.argv.indexOf('--workspace') + 1]) {
    return process.argv[process.argv.indexOf('--workspace') + 1];
  }
  return process.env.THINKCOFFEE_WORKSPACE || null;
}

function requireWorkspace(): string {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('No workspace configured. Pass --workspace=<path> or set THINKCOFFEE_WORKSPACE env.');
  if (!fs.existsSync(root)) throw new Error(`Workspace path does not exist: ${root}`);
  return path.resolve(root);
}

/** Resolve a relative path within the workspace, preventing path traversal */
function safePath(workspaceRoot: string, relativePath: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);
  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
    throw new Error(`Path traversal denied: ${relativePath}`);
  }
  return resolved;
}

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.mp3', '.mp4', '.avi', '.mov', '.wav',
  '.sqlite', '.db', '.lock',
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', '.tox', 'coverage', '.nyc_output', '.cache',
  'target', 'bin', 'obj', '.gradle',
]);

async function main() {
  const db = await getDatabase();
  const projects = new ProjectService(db);
  const contexts = new ContextService(db);
  const decisions = new DecisionService(db);
  const chat = new ChatService('default');

  const server = new McpServer({
    name: 'thinkcoffee',
    version: '1.0.0',
  });

  // ─── Resources ───────────────────────────────────────────────
  // List all projects
  server.resource(
    'projects',
    'thinkcoffee://projects',
    async (uri) => {
      const all = await projects.list();
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(all.map(p => ({ id: p.id, name: p.name, description: p.description, status: p.status })), null, 2),
        }],
      };
    }
  );

  // Project context (all entries as markdown)
  server.resource(
    'project-context',
    new ResourceTemplate('thinkcoffee://projects/{projectId}/context', { list: undefined }),
    async (uri, variables) => {
      const projectId = String(variables.projectId);
      const project = await projects.get(projectId);
      if (!project) return { contents: [{ uri: uri.href, text: 'Project not found' }] };

      const md = exportProject(project, 'markdown');
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: md }] };
    }
  );

  // ─── Tools ───────────────────────────────────────────────────

  // --- Project tools ---
  server.tool(
    'list_projects',
    'List all ThinkCoffee projects',
    {},
    async () => {
      const all = await projects.list();
      const summary = all.map(p =>
        `- **${p.name}** (${p.id}) [${p.status}] - ${p.contextEntries?.length || 0} contexts, ${p.decisions?.length || 0} decisions`
      ).join('\n');
      return { content: [{ type: 'text', text: summary || 'No projects yet. Use create_project to get started.' }] };
    }
  );

  server.tool(
    'create_project',
    'Create a new ThinkCoffee project',
    { name: z.string().describe('Project name'), description: z.string().optional().describe('Project description') },
    async ({ name, description }) => {
      const project = await projects.create({ name, description });
      return { content: [{ type: 'text', text: `Project created: ${project.name} (${project.id})` }] };
    }
  );

  server.tool(
    'get_project',
    'Get full project details including all context entries and decisions',
    { projectId: z.string().describe('Project ID or name') },
    async ({ projectId }) => {
      let project = await projects.get(projectId);
      if (!project) project = await projects.findByName(projectId);
      if (!project) return { content: [{ type: 'text', text: `Project not found: ${projectId}` }] };

      const md = exportProject(project, 'markdown');
      return { content: [{ type: 'text', text: md }] };
    }
  );

  server.tool(
    'delete_project',
    'Delete a project and all its data',
    { projectId: z.string().describe('Project ID') },
    async ({ projectId }) => {
      await projects.delete(projectId);
      return { content: [{ type: 'text', text: `Project ${projectId} deleted.` }] };
    }
  );

  // --- Context tools ---
  server.tool(
    'add_context',
    'Add a context entry to a project (architecture, requirements, dependencies, standards, general)',
    {
      projectId: z.string().describe('Project ID'),
      key: z.string().describe('Short label for this context entry'),
      value: z.string().describe('The context content'),
      category: z.enum(CATEGORIES).default('general').describe('Category of this context'),
      priority: z.number().min(1).max(4).default(1).describe('Priority 1-4 (4 = highest)'),
    },
    async ({ projectId, key, value, category, priority }) => {
      const entry = await contexts.create({ projectId, key, value, category, priority });
      return { content: [{ type: 'text', text: `Context added: [${entry.category}] ${entry.key} (priority: ${entry.priority})` }] };
    }
  );

  server.tool(
    'update_context',
    'Update an existing context entry',
    {
      id: z.string().describe('Context entry ID'),
      key: z.string().optional().describe('New label'),
      value: z.string().optional().describe('New content'),
      category: z.enum(CATEGORIES).optional().describe('New category'),
      priority: z.number().min(1).max(4).optional().describe('New priority'),
    },
    async ({ id, ...updates }) => {
      const entry = await contexts.update(id, updates);
      return { content: [{ type: 'text', text: `Context updated: [${entry.category}] ${entry.key}` }] };
    }
  );

  server.tool(
    'remove_context',
    'Delete a context entry',
    { id: z.string().describe('Context entry ID') },
    async ({ id }) => {
      await contexts.delete(id);
      return { content: [{ type: 'text', text: `Context entry ${id} removed.` }] };
    }
  );

  server.tool(
    'search_context',
    'Search context entries within a project by keyword',
    {
      projectId: z.string().describe('Project ID'),
      query: z.string().describe('Search keyword'),
    },
    async ({ projectId, query }) => {
      const results = await contexts.search(projectId, query);
      if (!results.length) return { content: [{ type: 'text', text: `No results for "${query}"` }] };

      const text = results.map(e =>
        `**[${e.category}] ${e.key}** (priority: ${e.priority})\n${e.value}`
      ).join('\n\n---\n\n');
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'list_context',
    'List context entries for a project, optionally filtered by category',
    {
      projectId: z.string().describe('Project ID'),
      category: z.enum(CATEGORIES).optional().describe('Filter by category'),
    },
    async ({ projectId, category }) => {
      const entries = await contexts.listByProject(projectId, category);
      if (!entries.length) return { content: [{ type: 'text', text: 'No context entries found.' }] };

      const text = entries.map(e =>
        `- **[${e.category}] ${e.key}** (id: ${e.id}, priority: ${e.priority}): ${e.value.substring(0, 120)}${e.value.length > 120 ? '...' : ''}`
      ).join('\n');
      return { content: [{ type: 'text', text }] };
    }
  );

  // --- Decision tools ---
  server.tool(
    'add_decision',
    'Record an architectural or design decision',
    {
      projectId: z.string().describe('Project ID'),
      title: z.string().describe('Decision title'),
      description: z.string().describe('What was decided and why'),
      rationale: z.string().optional().describe('Reasoning behind the decision'),
      alternatives: z.string().optional().describe('Alternatives that were considered'),
    },
    async ({ projectId, title, description, rationale, alternatives }) => {
      const decision = await decisions.create({
        projectId,
        title,
        description,
        rationale: rationale ? { text: rationale } : undefined,
        alternatives: alternatives ? { text: alternatives } : undefined,
      });
      return { content: [{ type: 'text', text: `Decision recorded: ${decision.title} (${decision.id})` }] };
    }
  );

  server.tool(
    'update_decision',
    'Update an existing decision',
    {
      id: z.string().describe('Decision ID'),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(['active', 'deprecated', 'superseded']).optional(),
    },
    async ({ id, ...updates }) => {
      const decision = await decisions.update(id, updates);
      return { content: [{ type: 'text', text: `Decision updated: ${decision.title} [${decision.status}]` }] };
    }
  );

  server.tool(
    'remove_decision',
    'Delete a decision record',
    { id: z.string().describe('Decision ID') },
    async ({ id }) => {
      await decisions.delete(id);
      return { content: [{ type: 'text', text: `Decision ${id} removed.` }] };
    }
  );

  server.tool(
    'list_decisions',
    'List all decisions for a project',
    { projectId: z.string().describe('Project ID') },
    async ({ projectId }) => {
      const decs = await decisions.listByProject(projectId);
      if (!decs.length) return { content: [{ type: 'text', text: 'No decisions recorded.' }] };

      const text = decs.map(d =>
        `- **${d.title}** [${d.status}] (id: ${d.id}): ${d.description.substring(0, 120)}${d.description.length > 120 ? '...' : ''}`
      ).join('\n');
      return { content: [{ type: 'text', text }] };
    }
  );

  // --- Export tool ---
  server.tool(
    'export_context',
    'Export project context in various formats (json, markdown, plain, copilot, claude, cursor)',
    {
      projectId: z.string().describe('Project ID'),
      format: z.enum(['json', 'markdown', 'plain', 'copilot', 'claude', 'cursor']).default('markdown').describe('Export format'),
    },
    async ({ projectId, format }) => {
      const project = await projects.get(projectId);
      if (!project) return { content: [{ type: 'text', text: `Project not found: ${projectId}` }] };

      const output = exportProject(project, format as ExportFormat);
      return { content: [{ type: 'text', text: output }] };
    }
  );

  // ─── File tools (workspace-aware) ───────────────────────────

  server.tool(
    'read_file',
    'Read the content of a file from the workspace. Returns text content with line numbers.',
    {
      filePath: z.string().describe('Relative path from workspace root (e.g. "src/index.ts")'),
      startLine: z.number().optional().describe('Start line (1-based, inclusive)'),
      endLine: z.number().optional().describe('End line (1-based, inclusive)'),
    },
    async ({ filePath, startLine, endLine }) => {
      try {
        const root = requireWorkspace();
        const abs = safePath(root, filePath);
        if (!fs.existsSync(abs)) return { content: [{ type: 'text', text: `File not found: ${filePath}` }] };
        if (fs.statSync(abs).isDirectory()) return { content: [{ type: 'text', text: `Path is a directory: ${filePath}` }] };
        const ext = path.extname(abs).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) return { content: [{ type: 'text', text: `Binary file (${ext}): ${filePath}` }] };

        const raw = fs.readFileSync(abs, 'utf-8');
        const lines = raw.split('\n');
        const start = Math.max(1, startLine || 1);
        const end = Math.min(lines.length, endLine || lines.length);
        const slice = lines.slice(start - 1, end);
        const numbered = slice.map((l, i) => `${start + i}: ${l}`).join('\n');
        const header = `File: ${filePath} (lines ${start}-${end} of ${lines.length})`;
        return { content: [{ type: 'text', text: `${header}\n\n${numbered}` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );

  server.tool(
    'write_file',
    'Create or overwrite a file in the workspace. Creates parent directories if needed.',
    {
      filePath: z.string().describe('Relative path from workspace root'),
      content: z.string().describe('File content to write'),
    },
    async ({ filePath, content }) => {
      try {
        const root = requireWorkspace();
        const abs = safePath(root, filePath);
        const dir = path.dirname(abs);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(abs, content, 'utf-8');
        const lines = content.split('\n').length;
        return { content: [{ type: 'text', text: `Written: ${filePath} (${lines} lines)` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );

  server.tool(
    'edit_file',
    'Replace an exact string in a file. The oldString must appear exactly once in the file.',
    {
      filePath: z.string().describe('Relative path from workspace root'),
      oldString: z.string().describe('Exact text to find (must be unique in the file)'),
      newString: z.string().describe('Replacement text'),
    },
    async ({ filePath, oldString, newString }) => {
      try {
        const root = requireWorkspace();
        const abs = safePath(root, filePath);
        if (!fs.existsSync(abs)) return { content: [{ type: 'text', text: `File not found: ${filePath}` }] };
        const raw = fs.readFileSync(abs, 'utf-8');
        const count = raw.split(oldString).length - 1;
        if (count === 0) return { content: [{ type: 'text', text: `String not found in ${filePath}. Check for exact whitespace/indentation match.` }] };
        if (count > 1) return { content: [{ type: 'text', text: `String found ${count} times in ${filePath}. Must be unique — include more context lines.` }] };
        fs.writeFileSync(abs, raw.replace(oldString, newString), 'utf-8');
        return { content: [{ type: 'text', text: `Edited: ${filePath} (replaced 1 occurrence)` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );

  server.tool(
    'list_directory',
    'List files and folders in a workspace directory. Folders end with /.',
    {
      dirPath: z.string().default('.').describe('Relative path from workspace root (default: root)'),
      recursive: z.boolean().default(false).describe('List recursively (max 500 entries)'),
    },
    async ({ dirPath, recursive }) => {
      try {
        const root = requireWorkspace();
        const abs = safePath(root, dirPath);
        if (!fs.existsSync(abs)) return { content: [{ type: 'text', text: `Directory not found: ${dirPath}` }] };

        const results: string[] = [];
        const MAX = 500;

        function walk(dir: string, prefix: string) {
          if (results.length >= MAX) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true })
            .sort((a, b) => {
              if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
          for (const entry of entries) {
            if (results.length >= MAX) break;
            if (IGNORE_DIRS.has(entry.name)) continue;
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
              results.push(`${rel}/`);
              if (recursive) walk(path.join(dir, entry.name), rel);
            } else {
              results.push(rel);
            }
          }
        }
        walk(abs, '');
        const header = recursive ? `Tree: ${dirPath || '.'} (${results.length} entries)` : `Directory: ${dirPath || '.'}`;
        return { content: [{ type: 'text', text: `${header}\n\n${results.join('\n')}` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );

  server.tool(
    'search_in_files',
    'Search for a text pattern (regex or literal) across workspace files. Returns matching lines with context.',
    {
      pattern: z.string().describe('Search pattern (regex supported)'),
      dirPath: z.string().default('.').describe('Directory to search in (relative to workspace root)'),
      filePattern: z.string().optional().describe('Glob-like extension filter, e.g. ".ts,.tsx,.js"'),
      maxResults: z.number().default(30).describe('Maximum number of matches to return'),
    },
    async ({ pattern, dirPath, filePattern, maxResults }) => {
      try {
        const root = requireWorkspace();
        const abs = safePath(root, dirPath);
        const regex = new RegExp(pattern, 'gi');
        const extensions = filePattern ? new Set(filePattern.split(',').map(e => e.trim().startsWith('.') ? e.trim() : `.${e.trim()}`)) : null;
        const matches: string[] = [];

        function search(dir: string) {
          if (matches.length >= maxResults) return;
          let entries: fs.Dirent[];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const entry of entries) {
            if (matches.length >= maxResults) break;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (!IGNORE_DIRS.has(entry.name)) search(full);
            } else {
              const ext = path.extname(entry.name).toLowerCase();
              if (BINARY_EXTENSIONS.has(ext)) continue;
              if (extensions && !extensions.has(ext)) continue;
              try {
                const content = fs.readFileSync(full, 'utf-8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
                  regex.lastIndex = 0;
                  if (regex.test(lines[i])) {
                    const rel = path.relative(root, full).replace(/\\/g, '/');
                    matches.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
                  }
                }
              } catch { /* skip unreadable files */ }
            }
          }
        }
        search(abs);
        if (!matches.length) return { content: [{ type: 'text', text: `No matches for "${pattern}"` }] };
        return { content: [{ type: 'text', text: `Found ${matches.length} match(es):\n\n${matches.join('\n')}` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );

  server.tool(
    'get_project_structure',
    'Get the full directory tree of the workspace as an overview (ignores node_modules, .git, dist, etc).',
    {
      maxDepth: z.number().default(4).describe('Maximum directory depth to show'),
    },
    async ({ maxDepth }) => {
      try {
        const root = requireWorkspace();
        const lines: string[] = [path.basename(root) + '/'];

        function tree(dir: string, prefix: string, depth: number) {
          if (depth >= maxDepth) return;
          let entries: fs.Dirent[];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          entries.sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          const filtered = entries.filter(e => !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.'));
          for (let i = 0; i < filtered.length; i++) {
            const entry = filtered[i];
            const isLast = i === filtered.length - 1;
            const connector = isLast ? '`-- ' : '|-- ';
            const child = isLast ? '    ' : '|   ';
            if (entry.isDirectory()) {
              lines.push(`${prefix}${connector}${entry.name}/`);
              tree(path.join(dir, entry.name), prefix + child, depth + 1);
            } else {
              lines.push(`${prefix}${connector}${entry.name}`);
            }
          }
        }
        tree(root, '', 0);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );

  // ─── Chat tools (AI collaboration) ───────────────────────────

  server.tool(
    'chat_get_history',
    'Get the chat history from the shared ThinkCoffee collaboration chat. Use this to see what the programmer and other AIs have been discussing.',
    {
      limit: z.number().default(50).describe('Max messages to return (most recent)'),
    },
    async ({ limit }) => {
      const msgs = chat.getHistory(limit);
      if (!msgs.length) return { content: [{ type: 'text', text: 'Chat is empty. The programmer has not sent any messages yet.' }] };
      const formatted = msgs.map(m => {
        const sender = m.senderLabel || m.sender;
        const time = new Date(m.timestamp).toLocaleTimeString();
        return `[${time}] **${sender}** (${m.type}): ${m.content}`;
      }).join('\n\n');
      return { content: [{ type: 'text', text: `Chat history (${msgs.length} messages):\n\n${formatted}` }] };
    }
  );

  server.tool(
    'chat_get_pending',
    'Get unread requests from the programmer. These are messages the programmer sent that no AI has responded to yet.',
    {},
    async () => {
      const pending = chat.getUnread();
      if (!pending.length) return { content: [{ type: 'text', text: 'No pending requests from the programmer.' }] };
      const formatted = pending.map(m => `- [${m.id}] ${m.content}`).join('\n');
      return { content: [{ type: 'text', text: `Pending programmer requests (${pending.length}):\n\n${formatted}` }] };
    }
  );

  server.tool(
    'chat_send_message',
    'Send a message to the ThinkCoffee collaboration chat. Use this to respond to the programmer or share information with other AIs.',
    {
      content: z.string().describe('Message content (supports markdown)'),
      type: z.enum(['response', 'info', 'code', 'error']).default('response').describe('Message type'),
      replyTo: z.string().optional().describe('ID of the message this replies to'),
      senderLabel: z.string().default('Claude').describe('Display name for the sender'),
    },
    async ({ content, type, replyTo, senderLabel }) => {
      const msg = chat.send({
        sender: 'claude',
        senderLabel,
        content,
        type,
        replyTo,
      });
      if (replyTo) chat.markRead(replyTo);
      return { content: [{ type: 'text', text: `Message sent (${msg.id})` }] };
    }
  );

  server.tool(
    'chat_execute_and_reply',
    'Execute a shell command in the workspace and post the result to the chat. Use this to run builds, tests, linters, or other dev commands on behalf of the programmer.',
    {
      command: z.string().describe('Shell command to execute'),
      replyTo: z.string().optional().describe('ID of the chat message this is in response to'),
      senderLabel: z.string().default('Claude').describe('Display name'),
    },
    async ({ command, replyTo, senderLabel }) => {
      try {
        const root = getWorkspaceRoot() || process.cwd();
        const output = execSync(command, {
          cwd: root,
          encoding: 'utf-8',
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        });
        const result = output.trim() || '(no output)';
        chat.send({
          sender: 'claude',
          senderLabel,
          content: `Executed: \`${command}\`\n\n\`\`\`\n${result}\n\`\`\``,
          type: 'code',
          replyTo,
        });
        if (replyTo) chat.markRead(replyTo);
        return { content: [{ type: 'text', text: `Command executed. Output:\n${result}` }] };
      } catch (e: any) {
        const errOutput = e.stderr || e.stdout || e.message;
        chat.send({
          sender: 'claude',
          senderLabel,
          content: `Command failed: \`${command}\`\n\n\`\`\`\n${errOutput}\n\`\`\``,
          type: 'error',
          replyTo,
        });
        if (replyTo) chat.markRead(replyTo);
        return { content: [{ type: 'text', text: `Command failed:\n${errOutput}` }] };
      }
    }
  );

  // ─── Prompts ─────────────────────────────────────────────────

  server.prompt(
    'project_context',
    'Get full project context for AI consumption',
    { projectId: z.string().describe('Project ID or name') },
    async ({ projectId }) => {
      let project = await projects.get(projectId);
      if (!project) project = await projects.findByName(projectId);
      if (!project) {
        return { messages: [{ role: 'user', content: { type: 'text', text: `Project "${projectId}" not found.` } }] };
      }

      const md = exportProject(project, 'markdown');
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Here is the full context for project "${project.name}":\n\n${md}\n\nUse this context to inform your responses about this project.`,
          },
        }],
      };
    }
  );

  server.prompt(
    'architecture_summary',
    'Get architecture-specific context for a project',
    { projectId: z.string().describe('Project ID') },
    async ({ projectId }) => {
      const entries = await contexts.listByProject(projectId, 'architecture');
      const decs = await decisions.listByProject(projectId);

      const parts: string[] = ['# Architecture Context', ''];
      if (entries.length) {
        for (const e of entries) {
          parts.push(`## ${e.key}`, '', e.value, '');
        }
      }
      if (decs.length) {
        parts.push('## Key Decisions', '');
        for (const d of decs.filter(d => d.status === 'active')) {
          parts.push(`### ${d.title}`, '', d.description, '');
        }
      }

      return {
        messages: [{
          role: 'user',
          content: { type: 'text', text: parts.join('\n') },
        }],
      };
    }
  );

  // ─── Start server ────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('ThinkCoffee MCP Server failed to start:', err);
  process.exit(1);
});
