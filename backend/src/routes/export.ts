import { Request, Response } from 'express';
import { AppDataSource } from '../data-source';
import { Project } from '../entities/Project';

const projectRepository = AppDataSource.getRepository(Project);

interface ExportRequest extends Request {
  query: {
    format?: 'json' | 'markdown' | 'plain';
  };
  params: {
    projectId: string;
  };
}

export async function exportProjectContext(req: ExportRequest, res: Response) {
  try {
    const { projectId } = req.params;
    const format = (req.query.format as string) || 'markdown';

    if (!['json', 'markdown', 'plain'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format. Use: json, markdown, or plain' });
    }

    const project = await projectRepository.findOne({
      where: { id: projectId },
      relations: ['contextEntries', 'decisions'],
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    let output: string;

    switch (format) {
      case 'json':
        output = exportAsJSON(project);
        res.setHeader('Content-Type', 'application/json');
        break;
      case 'markdown':
        output = exportAsMarkdown(project);
        res.setHeader('Content-Type', 'text/markdown');
        break;
      case 'plain':
        output = exportAsPlain(project);
        res.setHeader('Content-Type', 'text/plain');
        break;
      default:
        return res.status(400).json({ error: 'Invalid format' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${project.name.replace(/\s+/g, '_')}-context.${getExtension(format)}"`);
    res.send(output);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export context' });
  }
}

function exportAsJSON(project: any): string {
  return JSON.stringify(
    {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      contexts: project.contextEntries.map((e: any) => ({
        key: e.key,
        value: e.value,
        category: e.category,
        priority: e.priority,
        metadata: e.metadata,
      })),
      decisions: project.decisions.map((d: any) => ({
        title: d.title,
        description: d.description,
        rationale: d.rationale,
        status: d.status,
        alternatives: d.alternatives,
      })),
      exportedAt: new Date().toISOString(),
    },
    null,
    2
  );
}

function exportAsMarkdown(project: any): string {
  const lines: string[] = [];

  lines.push(`# ${project.name}`);
  if (project.description) {
    lines.push(`\n${project.description}\n`);
  }

  if (project.contextEntries && project.contextEntries.length > 0) {
    lines.push('\n## Context & Architecture\n');
    
    const byCategory: Record<string, any[]> = {};
    project.contextEntries.forEach((e: any) => {
      if (!byCategory[e.category]) byCategory[e.category] = [];
      byCategory[e.category].push(e);
    });

    for (const [category, entries] of Object.entries(byCategory)) {
      lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}\n`);
      (entries as any[]).forEach((entry) => {
        const priority = '⭐'.repeat(entry.priority);
        lines.push(`**${entry.key}** ${priority}`);
        lines.push(`\n${entry.value}\n`);
      });
    }
  }

  if (project.decisions && project.decisions.length > 0) {
    lines.push('\n## Architectural Decisions\n');
    project.decisions.forEach((d: any) => {
      lines.push(`### ${d.title}\n`);
      lines.push(`**Status:** ${d.status}\n`);
      lines.push(`${d.description}\n`);
      if (d.rationale) {
        lines.push(`**Rationale:** ${JSON.stringify(d.rationale)}\n`);
      }
    });
  }

  lines.push(`\n_Exported ${new Date().toLocaleString()}_`);
  return lines.join('\n');
}

function exportAsPlain(project: any): string {
  const lines: string[] = [];

  lines.push(project.name.toUpperCase());
  lines.push('='.repeat(project.name.length));

  if (project.description) {
    lines.push(`\n${project.description}\n`);
  }

  if (project.contextEntries && project.contextEntries.length > 0) {
    lines.push('\nCONTEXT ENTRIES:');
    lines.push('-'.repeat(50));
    project.contextEntries.forEach((entry: any) => {
      lines.push(`\n[${entry.category}] ${entry.key} (Priority: ${entry.priority})`);
      lines.push(entry.value);
    });
  }

  if (project.decisions && project.decisions.length > 0) {
    lines.push('\n\nARCHITECTURAL DECISIONS:');
    lines.push('-'.repeat(50));
    project.decisions.forEach((d: any) => {
      lines.push(`\n${d.title} [${d.status}]`);
      lines.push(d.description);
    });
  }

  return lines.join('\n');
}

function getExtension(format: string): string {
  const extensions: Record<string, string> = {
    json: 'json',
    markdown: 'md',
    plain: 'txt',
  };
  return extensions[format] || 'txt';
}
