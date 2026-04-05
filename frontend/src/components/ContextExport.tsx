import React from 'react';
import { Project, ContextEntry, Decision } from '../types';

interface ContextExportProps {
  project: Project;
  contextEntries: ContextEntry[];
  decisions: Decision[];
}

type ExportFormat = 'json' | 'markdown' | 'plain';

// Convert string to URL-friendly slug
const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
};

export default function ContextExport({ project, contextEntries, decisions }: ContextExportProps) {
  const [format, setFormat] = React.useState<ExportFormat>('markdown');
  const [copied, setCopied] = React.useState(false);

  const generateJSON = () => {
    const data = {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        createdAt: project.createdAt,
      },
      contexts: contextEntries.map(e => ({
        key: e.key,
        value: e.value,
        category: e.category,
        priority: e.priority,
      })),
      decisions: decisions.map(d => ({
        title: d.title,
        description: d.description,
        status: d.status,
      })),
    };
    return JSON.stringify(data, null, 2);
  };

  const generateMarkdown = () => {
    const lines: string[] = [];
    lines.push(`# ${project.name}`);
    if (project.description) {
      lines.push(`\n${project.description}\n`);
    }

    if (contextEntries.length > 0) {
      lines.push('\n## Context Entries\n');
      const byCategory = contextEntries.reduce((acc, e) => {
        if (!acc[e.category]) acc[e.category] = [];
        acc[e.category].push(e);
        return acc;
      }, {} as Record<string, ContextEntry[]>);

      for (const [category, entries] of Object.entries(byCategory)) {
        lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}\n`);
        for (const entry of entries) {
          const priority = '[' + '*'.repeat(entry.priority) + ']';
          lines.push(`- **${entry.key}** ${priority}`);
          lines.push(`  ${entry.value}\n`);
        }
      }
    }

    if (decisions.length > 0) {
      lines.push('\n## Architectural Decisions\n');
      for (const decision of decisions) {
        lines.push(`### ${decision.title}`);
        lines.push(`- **Status**: ${decision.status}`);
        lines.push(`- **Description**: ${decision.description}\n`);
      }
    }

    return lines.join('\n');
  };

  const generatePlain = () => {
    const lines: string[] = [];
    lines.push(project.name.toUpperCase());
    lines.push('='.repeat(project.name.length));
    
    if (project.description) {
      lines.push(`\n${project.description}\n`);
    }

    if (contextEntries.length > 0) {
      lines.push('\nCONTEXT ENTRIES:');
      lines.push('-'.repeat(20));
      for (const entry of contextEntries) {
        lines.push(`\n${entry.key} (${entry.category})`);
        lines.push(entry.value);
      }
    }

    if (decisions.length > 0) {
      lines.push('\n\nDECISIONS:');
      lines.push('-'.repeat(20));
      for (const decision of decisions) {
        lines.push(`\n${decision.title}`);
        lines.push(`Status: ${decision.status}`);
        lines.push(decision.description);
      }
    }

    return lines.join('\n');
  };

  const getContent = () => {
    switch (format) {
      case 'json':
        return generateJSON();
      case 'markdown':
        return generateMarkdown();
      case 'plain':
        return generatePlain();
      default:
        return '';
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getContent());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const content = getContent();
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(project.name)}-context.${format === 'json' ? 'json' : format === 'markdown' ? 'md' : 'txt'}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 space-y-4">
      <div>
        <h3 className="text-xl font-semibold mb-4">Export Context</h3>
        
        <div className="flex gap-2 mb-4">
          {(['json', 'markdown', 'plain'] as ExportFormat[]).map((fmt) => (
            <button
              key={fmt}
              onClick={() => setFormat(fmt)}
              className={`px-4 py-2 rounded transition ${
                format === fmt
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
              }`}
            >
              {fmt === 'json' ? 'JSON' : fmt === 'markdown' ? 'Markdown' : 'Plain Text'}
            </button>
          ))}
        </div>

        <textarea
          value={getContent()}
          readOnly
          className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white font-mono text-sm h-64 focus:outline-none resize-none"
        />

        <div className="flex gap-2 mt-4">
          <button
            onClick={handleCopy}
            className="flex-1 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded transition font-medium"
          >
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
          <button
            onClick={handleDownload}
            className="flex-1 bg-green-600 hover:bg-green-700 px-4 py-2 rounded transition font-medium"
          >
            Download File
          </button>
        </div>
      </div>

      <div className="bg-slate-700 rounded p-3 text-sm text-slate-300">
        <p>
          <strong>Tip:</strong> Use the exported content to provide context to AI tools. 
          Copy as JSON for API integration, or Markdown for prompt injection.
        </p>
      </div>
    </div>
  );
}
