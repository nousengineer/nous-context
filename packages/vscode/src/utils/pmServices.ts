/**
 * Minimal file-based helpers that mirror the ChatService / PipelineService contracts
 * from @thinkcoffee/core without requiring a cross-package import or built dist files.
 *
 * Paths are intentionally identical to what the core services use so that messages
 * written here are visible to MCP tools, the REST API, and any other consumer.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// ─── Types ────────────────────────────────────────────────────

export interface ChatEntry {
  id: string;
  timestamp: string;
  sender: string;
  content: string;
  type: 'request' | 'response' | 'info' | 'error';
  projectId?: string;
}

export type PhaseStatus = 'pending' | 'in-progress' | 'awaiting-approval' | 'approved' | 'completed' | 'failed';
export type PipelineStatus = 'active' | 'completed' | 'failed';

export interface PipelinePhase {
  id: string;
  name: string;
  order: number;
  status: PhaseStatus;
  agents: string[];
}

export interface Pipeline {
  id: string;
  projectId: string;
  workspace: string;
  objective: string;
  status: PipelineStatus;
  currentPhase: number;
  phases: PipelinePhase[];
  createdAt: string;
  updatedAt: string;
}

// ─── Chat helpers ─────────────────────────────────────────────

function chatFile(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(os.homedir(), '.thinkcoffee', 'chat');
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return path.join(dir, `${safe}.jsonl`);
}

/** Append a chat message to the project JSONL channel. */
export function appendChatMessage(
  projectId: string,
  sender: string,
  type: ChatEntry['type'],
  content: string,
): ChatEntry {
  const entry: ChatEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender,
    content,
    type,
    projectId,
  };
  try {
    fs.appendFileSync(chatFile(projectId), JSON.stringify(entry) + '\n', 'utf-8');
  } catch { /* ignore write errors — chat log is best-effort */ }
  return entry;
}

// ─── Pipeline helpers ─────────────────────────────────────────

const DEFAULT_PHASES: Array<{ name: string; agents: string[] }> = [
  { name: 'Planning',        agents: ['product-manager'] },
  { name: 'Architecture',    agents: ['architect'] },
  { name: 'Implementation',  agents: ['backend', 'frontend', 'devops'] },
  { name: 'Testing',         agents: ['qa'] },
  { name: 'Code Review',     agents: ['code-review'] },
];

function pipelinesDir(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(os.homedir(), '.thinkcoffee', 'pipelines', safe);
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

function savePipeline(p: Pipeline): void {
  const file = path.join(pipelinesDir(p.projectId), `${p.id}.json`);
  try { fs.writeFileSync(file, JSON.stringify(p, null, 2), 'utf-8'); } catch { /* ignore */ }
}

function loadPipeline(projectId: string, id: string): Pipeline | null {
  const file = path.join(pipelinesDir(projectId), `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) as Pipeline; } catch { return null; }
}

/** Create a new pipeline for a project and persist it. */
export function createPipeline(projectId: string, objective: string, workspace: string): Pipeline {
  const now = new Date().toISOString();
  const phases: PipelinePhase[] = DEFAULT_PHASES.map((pt, idx) => ({
    id: crypto.randomUUID(),
    name: pt.name,
    order: idx,
    status: idx === 0 ? 'in-progress' : 'pending',
    agents: pt.agents,
  }));
  const pipeline: Pipeline = {
    id: crypto.randomUUID(),
    projectId,
    workspace,
    objective,
    status: 'active',
    currentPhase: 0,
    phases,
    createdAt: now,
    updatedAt: now,
  };
  savePipeline(pipeline);
  return pipeline;
}

/** Return the most recent active pipeline for a project, or null. */
export function getActivePipeline(projectId: string): Pipeline | null {
  const dir = pipelinesDir(projectId);
  let files: string[];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); }
  catch { return null; }

  const pipelines: Pipeline[] = [];
  for (const f of files) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as Pipeline;
      pipelines.push(p);
    } catch { /* skip */ }
  }
  return (
    pipelines
      .filter(p => p.status === 'active')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

/** Approve the current phase of a pipeline and advance to the next. */
export function approveCurrentPhase(projectId: string, pipelineId: string): Pipeline | null {
  const p = loadPipeline(projectId, pipelineId);
  if (!p) return null;

  const phase = p.phases[p.currentPhase];
  if (!phase) return p;

  phase.status = 'approved';
  p.updatedAt = new Date().toISOString();

  const next = p.currentPhase + 1;
  if (next < p.phases.length) {
    p.currentPhase = next;
    p.phases[next].status = 'in-progress';
  } else {
    p.status = 'completed';
  }

  savePipeline(p);
  return p;
}

/** Mark the current phase as failed so it can be reworked. */
export function rejectCurrentPhase(projectId: string, pipelineId: string): Pipeline | null {
  const p = loadPipeline(projectId, pipelineId);
  if (!p) return null;

  const phase = p.phases[p.currentPhase];
  if (!phase) return p;

  phase.status = 'failed';
  p.updatedAt = new Date().toISOString();
  savePipeline(p);
  return p;
}

/** Build a short human-readable status line for a pipeline. */
export function formatPipelineStatus(p: Pipeline): string {
  const phase = p.phases[p.currentPhase];
  const phaseName = phase?.name ?? 'unknown';
  const agents = phase?.agents.join(', ') ?? '-';
  return [
    `Pipeline: ${p.id.slice(0, 8)}…`,
    `Objective: ${p.objective}`,
    `Status: ${p.status}`,
    `Current phase (${p.currentPhase + 1}/${p.phases.length}): ${phaseName}`,
    `Agents: ${agents}`,
  ].join('\n');
}
