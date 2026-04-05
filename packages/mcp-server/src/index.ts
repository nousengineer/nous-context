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
  PipelineService,
  AGENT_META,
} from '@thinkcoffee/core';
import type { ChatMessage, AgentRole } from '@thinkcoffee/core';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const CATEGORIES = ['architecture', 'requirements', 'dependencies', 'standards', 'general'] as const;

// ─── Workspace sandbox helpers ─────────────────────────────────
function getWorkspaceRoot(): string | null {
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

// ─── Project templates ────────────────────────────────────────
const PROJECT_TEMPLATES: Record<string, { contexts: { key: string; value: string; category: string; priority: number }[] }> = {
  'flutter-app': {
    contexts: [
      { key: 'Stack', value: 'Flutter (frontend) + backend a definir. Arquitetura por módulos funcionais.', category: 'architecture', priority: 4 },
      { key: 'Módulos', value: 'auth, core, features (um por domínio), shared/widgets', category: 'architecture', priority: 3 },
      { key: 'Estado', value: 'Gerenciamento de estado: a definir (Bloc / Riverpod / Provider)', category: 'requirements', priority: 3 },
      { key: 'Plataformas alvo', value: 'Android, iOS, Desktop — definir prioridade', category: 'requirements', priority: 2 },
    ],
  },
  'backend-api': {
    contexts: [
      { key: 'Stack', value: 'API REST. Linguagem/framework a definir.', category: 'architecture', priority: 4 },
      { key: 'Auth', value: 'Autenticação JWT ou OAuth2 — a definir', category: 'requirements', priority: 4 },
      { key: 'Banco de dados', value: 'Relacional ou NoSQL — a definir conforme domínio', category: 'architecture', priority: 3 },
      { key: 'Padrão de resposta', value: '{ data, error, meta } em todas as rotas', category: 'standards', priority: 3 },
    ],
  },
  'artigo-academico': {
    contexts: [
      { key: 'Formatação', value: 'ABNT NBR 6023/6024/10520. Fonte Times New Roman 12, espaço 1,5.', category: 'standards', priority: 4 },
      { key: 'Estrutura', value: 'Introdução → Referencial Teórico → Metodologia → Resultados → Conclusão → Referências', category: 'requirements', priority: 4 },
      { key: 'Resumo', value: 'Resumo e Abstract obrigatórios. Palavras-chave: 3–5.', category: 'requirements', priority: 3 },
      { key: 'Ferramentas', value: 'LaTeX ou Word com plugin ABNT. Gerenciador: Zotero ou Mendeley.', category: 'dependencies', priority: 2 },
    ],
  },
  'electron-app': {
    contexts: [
      { key: 'Stack', value: 'Electron + React + TypeScript. SQLite local ou PostgreSQL remoto.', category: 'architecture', priority: 4 },
      { key: 'Processos', value: 'Main process (Node): acesso a FS, DB, IPC. Renderer process (React): UI apenas.', category: 'architecture', priority: 4 },
      { key: 'IPC', value: 'Comunicação via ipcMain/ipcRenderer com preload script. Sem expor Node ao renderer.', category: 'standards', priority: 3 },
      { key: 'Distribuição', value: 'electron-builder. Auto-update via electron-updater.', category: 'dependencies', priority: 3 },
    ],
  },
  'visual-novel': {
    contexts: [
      { key: 'Engine', value: "Engine a definir (Ren'Py, Unity, Godot ou custom)", category: 'architecture', priority: 4 },
      { key: 'Narrativa', value: 'Sistema de escolhas com histórico de decisões afetando rota. Múltiplos finais.', category: 'requirements', priority: 4 },
      { key: 'Personagens', value: 'Definir protagonistas, NPCs e sistema de afinidade/relações', category: 'general', priority: 3 },
      { key: 'Assets', value: 'Sprites, backgrounds, BGM, SFX — pipeline de produção a definir', category: 'dependencies', priority: 2 },
    ],
  },
};

async function main() {
  const db = await getDatabase();
  const projects = new ProjectService(db);
  const contexts = new ContextService(db);
  const decisions = new DecisionService(db);
  const chat = new ChatService('default');
  const pipelines = new PipelineService();

  // ─── Helpers ───────────────────────────────────────────────

  /** Resolve project by ID or name */
  async function findProject(idOrName: string) {
    let project = await projects.get(idOrName);
    if (!project) project = await projects.findByName(idOrName);
    return project;
  }

  function notFound(entity: string, id: string) {
    return { content: [{ type: 'text' as const, text: `${entity} not found: ${id}` }] };
  }

  const server = new McpServer({
    name: 'thinkcoffee',
    version: '2.0.0',
  });

  // ─── Resources ───────────────────────────────────────────────
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
    'create_project_from_template',
    'Create a project pre-populated with context from a template. Available: flutter-app, backend-api, artigo-academico, electron-app, visual-novel',
    {
      name: z.string().describe('Project name'),
      description: z.string().optional().describe('Project description'),
      template: z.enum(['flutter-app', 'backend-api', 'artigo-academico', 'electron-app', 'visual-novel']).describe('Template to use'),
    },
    async ({ name, description, template }) => {
      const project = await projects.create({ name, description });
      const tpl = PROJECT_TEMPLATES[template];
      const added: string[] = [];
      for (const ctx of tpl.contexts) {
        await contexts.create({ projectId: project.id, ...ctx } as any);
        added.push(`[${ctx.category}] ${ctx.key}`);
      }
      return {
        content: [{
          type: 'text',
          text: `Project created from template "${template}": ${project.name} (${project.id})\n\nPre-populated contexts:\n${added.map(a => `- ${a}`).join('\n')}`,
        }],
      };
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
    'update_project',
    'Update a project: rename, change description, or change status (active, archived, inactive)',
    {
      projectId: z.string().describe('Project ID'),
      name: z.string().optional().describe('New project name'),
      description: z.string().optional().describe('New project description'),
      status: z.enum(['active', 'archived', 'inactive']).optional().describe('New status'),
    },
    async ({ projectId, ...updates }) => {
      const project = await projects.update(projectId, updates);
      return { content: [{ type: 'text', text: `Project updated: ${project.name} [${project.status}]` }] };
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
    'bulk_add_context',
    'Add multiple context entries to a project in a single call',
    {
      projectId: z.string().describe('Project ID'),
      entries: z.array(z.object({
        key: z.string().describe('Short label'),
        value: z.string().describe('Context content'),
        category: z.enum(CATEGORIES).default('general'),
        priority: z.number().min(1).max(4).default(1),
      })).describe('Array of context entries to add'),
    },
    async ({ projectId, entries }) => {
      const added: string[] = [];
      for (const e of entries) {
        const entry = await contexts.create({ projectId, ...e });
        added.push(`[${entry.category}] ${entry.key} (priority: ${entry.priority})`);
      }
      return {
        content: [{
          type: 'text',
          text: `Added ${added.length} context entries:\n${added.map(a => `- ${a}`).join('\n')}`,
        }],
      };
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
    'search_all_projects',
    'Search context entries across ALL projects by keyword. Useful to find patterns or reuse across projects.',
    {
      query: z.string().describe('Search keyword'),
      category: z.enum(CATEGORIES).optional().describe('Optionally filter by category'),
    },
    async ({ query, category }) => {
      const all = await projects.list();
      const results: string[] = [];
      for (const project of all) {
        const entries = await contexts.search(project.id, query);
        const filtered = category ? entries.filter(e => e.category === category) : entries;
        for (const e of filtered) {
          results.push(`**[${project.name}]** [${e.category}] ${e.key} (priority: ${e.priority})\n${e.value}`);
        }
      }
      if (!results.length) return { content: [{ type: 'text', text: `No results for "${query}" across any project.` }] };
      return { content: [{ type: 'text', text: `Found ${results.length} result(s) across all projects:\n\n${results.join('\n\n---\n\n')}` }] };
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
        const parts = raw.split(oldString);
        const count = parts.length - 1;
        if (count === 0) return { content: [{ type: 'text', text: `String not found in ${filePath}. Check for exact whitespace/indentation match.` }] };
        if (count > 1) return { content: [{ type: 'text', text: `String found ${count} times in ${filePath}. Must be unique — include more context lines.` }] };
        fs.writeFileSync(abs, parts.join(newString), 'utf-8');
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

  // ─── Pipeline / Agent Tools ─────────────────────────────────

  const agentRoles = ['product-manager', 'architect', 'backend', 'frontend', 'devops', 'qa', 'code-review'] as const;

  server.tool(
    'pipeline_create',
    'Create a new development pipeline from an objective. This starts the PM agent phase automatically.',
    {
      projectId: z.string().describe('Project ID'),
      objective: z.string().describe('The development goal, e.g. "criar sistema de login com OAuth"'),
    },
    async ({ projectId, objective }) => {
      const project = await findProject(projectId);
      if (!project) return notFound('Project', projectId);
      const ws = getWorkspaceRoot() || process.cwd();
      const p = pipelines.create(project.id, objective, ws);
      chat.send({
        sender: 'system',
        senderLabel: 'Pipeline',
        content: `New pipeline created: **${objective}**\n\nPhase 1/5: **Planning** (Product Manager)\nPipeline ID: \`${p.id}\``,
        type: 'info',
      });
      return { content: [{ type: 'text', text: `Pipeline created: ${p.id}\n\nObjective: ${objective}\nStatus: ${p.status}\nCurrent phase: ${p.phases[0].name}\n\nThe Product Manager agent should now start working on requirements.` }] };
    }
  );

  server.tool(
    'pipeline_status',
    'Get the current status of a pipeline including all phases and tasks.',
    {
      projectId: z.string().describe('Project ID'),
      pipelineId: z.string().optional().describe('Pipeline ID (optional — uses active pipeline if omitted)'),
    },
    async ({ projectId, pipelineId }) => {
      const project = await findProject(projectId);
      if (!project) return notFound('Project', projectId);
      const p = pipelineId
        ? pipelines.get(project.id, pipelineId)
        : pipelines.getActive(project.id);
      if (!p) return { content: [{ type: 'text', text: 'No active pipeline found. Create one with pipeline_create.' }] };
      return { content: [{ type: 'text', text: pipelines.getStatusSummary(project.id, p.id) }] };
    }
  );

  server.tool(
    'pipeline_list',
    'List all pipelines for a project.',
    { projectId: z.string().describe('Project ID') },
    async ({ projectId }) => {
      const project = await findProject(projectId);
      if (!project) return notFound('Project', projectId);
      const list = pipelines.list(project.id);
      if (!list.length) return { content: [{ type: 'text', text: 'No pipelines yet.' }] };
      const lines = list.map(p => `- [${p.status}] ${p.objective} (${p.id})`).join('\n');
      return { content: [{ type: 'text', text: `Pipelines (${list.length}):\n\n${lines}` }] };
    }
  );

  server.tool(
    'pipeline_my_tasks',
    'Get your current tasks in the active pipeline. Use this to check what work you need to do.',
    {
      projectId: z.string().describe('Project ID'),
      agent: z.enum(agentRoles).describe('Your agent role'),
      pipelineId: z.string().optional().describe('Pipeline ID (optional)'),
    },
    async ({ projectId, agent, pipelineId }) => {
      const project = await findProject(projectId);
      if (!project) return notFound('Project', projectId);
      const p = pipelineId
        ? pipelines.get(project.id, pipelineId)
        : pipelines.getActive(project.id);
      if (!p) return { content: [{ type: 'text', text: 'No active pipeline.' }] };

      const tasks = pipelines.getAgentTasks(project.id, p.id, agent as AgentRole);
      if (!tasks.length) return { content: [{ type: 'text', text: `No tasks for ${AGENT_META[agent as AgentRole].label} in the current phase (${p.phases[p.currentPhase].name}).` }] };

      const lines = tasks.map(t => {
        let line = `- [${t.status}] ${t.title} (${t.id})\n  ${t.description.split('\n')[0]}`;
        if (t.output) line += `\n  Output: ${t.output.substring(0, 150)}...`;
        return line;
      }).join('\n');

      return { content: [{ type: 'text', text: `Your tasks in phase "${p.phases[p.currentPhase].name}":\n\n${lines}` }] };
    }
  );

  server.tool(
    'pipeline_start_task',
    'Start working on a task. Call this before you begin your work.',
    {
      projectId: z.string().describe('Project ID'),
      taskId: z.string().describe('Task ID to start'),
      pipelineId: z.string().optional().describe('Pipeline ID (optional)'),
    },
    async ({ projectId, taskId, pipelineId }) => {
      const project = await findProject(projectId);
      if (!project) return notFound('Project', projectId);
      const pid = pipelineId || pipelines.getActive(project.id)?.id;
      if (!pid) return { content: [{ type: 'text', text: 'No active pipeline.' }] };

      const p = pipelines.startTask(project.id, pid, taskId);
      if (!p) return notFound('Pipeline', pid);

      const task = p.phases.flatMap(ph => ph.tasks).find(t => t.id === taskId);
      if (task) {
        chat.send({
          sender: 'system',
          senderLabel: 'Pipeline',
          content: `**${AGENT_META[task.agent].label}** started: ${task.title}`,
          type: 'info',
        });
      }
      return { content: [{ type: 'text', text: `Task started: ${taskId}` }] };
    }
  );

  server.tool(
    'pipeline_complete_task',
    'Complete a task with your output/deliverables. Include a summary of what you produced and any files created/modified.',
    {
      projectId: z.string().describe('Project ID'),
      taskId: z.string().describe('Task ID to complete'),
      output: z.string().describe('Summary of what was produced (markdown supported)'),
      artifacts: z.array(z.string()).optional().describe('List of file paths created or modified'),
      pipelineId: z.string().optional().describe('Pipeline ID (optional)'),
    },
    async ({ projectId, taskId, output, artifacts, pipelineId }) => {
      const project = await findProject(projectId);
      if (!project) return notFound('Project', projectId);
      const pid = pipelineId || pipelines.getActive(project.id)?.id;
      if (!pid) return { content: [{ type: 'text', text: 'No active pipeline.' }] };

      const p = pipelines.completeTask(project.id, pid, taskId, output, artifacts);
      if (!p) return notFound('Pipeline', pid);

      // Auto-save agent output as context + decision for project history
      try {
        await pipelines.saveAgentHistory(project.id, pid, taskId, contexts, decisions);
      } catch (err) {
        console.error('[ThinkCoffee] Failed to save agent history:', (err as Error).message);
      }

      const task = p.phases.flatMap(ph => ph.tasks).find(t => t.id === taskId);
      const phase = p.phases[p.currentPhase];

      if (task) {
        chat.send({
          sender: 'system',
          senderLabel: 'Pipeline',
          content: `**${AGENT_META[task.agent].label}** completed: ${task.title}\n\n${output.substring(0, 300)}${output.length > 300 ? '...' : ''}`,
          type: 'response',
        });
      }

      if (phase?.status === 'awaiting-approval') {
        chat.send({
          sender: 'system',
          senderLabel: 'Pipeline',
          content: `Phase **${phase.name}** is complete and awaiting programmer approval.\n\nUse \`pipeline_approve\` or the VS Code extension to review and approve.`,
          type: 'request',
        });
      }

      return { content: [{ type: 'text', text: `Task completed. Phase status: ${phase?.status || 'unknown'}` }] };
    }
  );

  server.tool(
    'pipeline_fail_task',
    'Report that a task has failed. Include the reason and enough context for the issue to be resolved.',
    {
      projectId: z.string().describe('Project ID'),
      taskId: z.string().describe('Task ID'),
      reason: z.string().describe('Why the task failed'),
      pipelineId: z.string().optional().describe('Pipeline ID (optional)'),
    },
    async ({ projectId, taskId, reason, pipelineId }) => {
      const project = await findProject(projectId);
      if (!project) return notFound('Project', projectId);
      const pid = pipelineId || pipelines.getActive(project.id)?.id;
      if (!pid) return { content: [{ type: 'text', text: 'No active pipeline.' }] };

      const p = pipelines.failTask(project.id, pid, taskId, reason);
      chat.send({
        sender: 'system',
        senderLabel: 'Pipeline',
        content: `Task failed: ${reason}`,
        type: 'error',
      });
      return { content: [{ type: 'text', text: `Task marked as failed. Pipeline status: ${p?.status}` }] };
    }
  );

  server.tool(
    'pipeline_approve',
    'Approve the current phase and advance to the next one. Only the programmer should do this after reviewing the deliverables.',
    {
      projectId: z.string().describe('Project ID'),
      pipelineId: z.string().optional().describe('Pipeline ID (optional)'),
    },
    async ({ projectId, pipelineId }) => {
      const project = await findProject(projectId);
      if (!project) return notFound('Project', projectId);
      const pid = pipelineId || pipelines.getActive(project.id)?.id;
      if (!pid) return { content: [{ type: 'text', text: 'No active pipeline.' }] };

      const p = pipelines.approvePhase(project.id, pid);
      if (!p) return notFound('Pipeline', pid);

      const nextPhase = p.phases[p.currentPhase];
      const msg = p.status === 'completed'
        ? 'Pipeline completed! All phases approved.'
        : `Phase approved. Next: **${nextPhase.name}** (${nextPhase.agents.map(a => AGENT_META[a].label).join(', ')})`;

      chat.send({
        sender: 'system',
        senderLabel: 'Pipeline',
        content: msg,
        type: 'info',
      });

      return { content: [{ type: 'text', text: msg }] };
    }
  );

  server.tool(
    'pipeline_reject',
    'Reject the current phase with feedback. Tasks will be reset so agents can redo them.',
    {
      projectId: z.string().describe('Project ID'),
      feedback: z.string().describe('What needs to be changed or improved'),
      pipelineId: z.string().optional().describe('Pipeline ID (optional)'),
    },
    async ({ projectId, feedback, pipelineId }) => {
      const project = await findProject(projectId);
      if (!project) return notFound('Project', projectId);
      const pid = pipelineId || pipelines.getActive(project.id)?.id;
      if (!pid) return { content: [{ type: 'text', text: 'No active pipeline.' }] };

      const p = pipelines.rejectPhase(project.id, pid, feedback);
      if (!p) return notFound('Pipeline', pid);

      chat.send({
        sender: 'programmer',
        senderLabel: 'You',
        content: `Phase rejected. Feedback:\n\n${feedback}`,
        type: 'request',
      });

      return { content: [{ type: 'text', text: `Phase rejected and reset. Agents should address the feedback and retry.` }] };
    }
  );

  server.tool(
    'pipeline_get_phase_output',
    'Get the full output from all completed tasks in a specific phase. Useful for agents that need to read previous phase deliverables.',
    {
      projectId: z.string().describe('Project ID'),
      phaseIndex: z.number().min(0).max(4).describe('Phase index (0=Planning, 1=Architecture, 2=Implementation, 3=Testing, 4=Code Review)'),
      pipelineId: z.string().optional().describe('Pipeline ID (optional)'),
    },
    async ({ projectId, phaseIndex, pipelineId }) => {
      const project = await findProject(projectId);
      if (!project) return notFound('Project', projectId);
      const pid = pipelineId || pipelines.getActive(project.id)?.id;
      if (!pid) return { content: [{ type: 'text', text: 'No active pipeline.' }] };

      const p = pipelines.get(project.id, pid);
      if (!p) return notFound('Pipeline', pid);

      const phase = p.phases[phaseIndex];
      if (!phase) return { content: [{ type: 'text', text: `Phase ${phaseIndex} not found.` }] };

      const outputs = phase.tasks
        .filter(t => t.output)
        .map(t => `## ${AGENT_META[t.agent].label}: ${t.title}\n\n${t.output}\n\nArtifacts: ${(t.artifacts || []).join(', ') || 'none'}`)
        .join('\n\n---\n\n');

      return { content: [{ type: 'text', text: outputs || `Phase "${phase.name}" has no output yet.` }] };
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
