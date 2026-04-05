import { describe, it, expect } from 'vitest';
import { exportProject, getExportFilename } from '../index';
import type { Project } from '../../entities/Project';

describe('Export Module', () => {
  const mockProject: any = {
    id: '123-456',
    name: 'Test Project',
    description: 'A project for testing exports',
    status: 'active',
    contextEntries: [
      {
        id: 'ctx-1',
        key: 'tech-stack',
        value: 'Node.js, TypeScript, SQLite',
        category: 'architecture',
        priority: 3,
      },
      {
        id: 'ctx-2',
        key: 'api-style',
        value: 'RESTful with Express',
        category: 'standards',
        priority: 2,
      },
    ],
    decisions: [
      {
        id: 'dec-1',
        title: 'Use TypeORM',
        description: 'We chose TypeORM for database abstraction',
        status: 'active',
        rationale: { reason: 'Good TypeScript support' },
      },
    ],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
  };

  describe('exportProject - markdown', () => {
    it('should export project to markdown format', () => {
      const result = exportProject(mockProject, 'markdown');

      expect(result).toContain('# Test Project');
      expect(result).toContain('A project for testing exports');
      expect(result).toContain('## Context');
      expect(result).toContain('### tech-stack');
      expect(result).toContain('Node.js, TypeScript, SQLite');
      expect(result).toContain('## Decisions');
      expect(result).toContain('### Use TypeORM');
    });

    it('should handle project without description', () => {
      const project = { ...mockProject, description: null };
      const result = exportProject(project, 'markdown');

      expect(result).toContain('# Test Project');
      expect(result).not.toContain('undefined');
    });

    it('should group context by category', () => {
      const result = exportProject(mockProject, 'markdown');

      expect(result).toContain('**Category**: architecture');
      expect(result).toContain('**Category**: standards');
    });
  });

  describe('exportProject - json', () => {
    it('should export project to valid JSON', () => {
      const result = exportProject(mockProject, 'json');
      const parsed = JSON.parse(result);

      expect(parsed.project.name).toBe('Test Project');
      expect(parsed.context).toHaveLength(2);
      expect(parsed.decisions).toHaveLength(1);
    });

    it('should include all project fields', () => {
      const result = exportProject(mockProject, 'json');
      const parsed = JSON.parse(result);

      expect(parsed.project).toHaveProperty('id');
      expect(parsed.project).toHaveProperty('name');
      expect(parsed.project).toHaveProperty('status');
      expect(parsed.project).toHaveProperty('createdAt');
    });
  });

  describe('exportProject - plain', () => {
    it('should export project to plain text', () => {
      const result = exportProject(mockProject, 'plain');

      expect(result).toContain('TEST PROJECT');
      expect(result).toContain('tech-stack');
      expect(result).toContain('Use TypeORM');
    });

    it('should be uppercase', () => {
      const result = exportProject(mockProject, 'plain');
      expect(result).toBe(result.toUpperCase());
    });
  });

  describe('exportProject - copilot', () => {
    it('should export in GitHub Copilot format', () => {
      const result = exportProject(mockProject, 'copilot');

      expect(result).toContain('# GitHub Copilot Instructions');
      expect(result).toContain('Test Project');
      expect(result).toContain('tech-stack');
    });

    it('should include context and decisions', () => {
      const result = exportProject(mockProject, 'copilot');

      expect(result).toContain('Node.js, TypeScript, SQLite');
      expect(result).toContain('Use TypeORM');
    });
  });

  describe('exportProject - claude', () => {
    it('should export in Claude format', () => {
      const result = exportProject(mockProject, 'claude');

      expect(result).toContain('# Project Context for Claude');
      expect(result).toContain('Test Project');
    });

    it('should structure data for Claude', () => {
      const result = exportProject(mockProject, 'claude');

      expect(result).toContain('## Technical Context');
      expect(result).toContain('## Key Decisions');
    });
  });

  describe('exportProject - cursor', () => {
    it('should export in Cursor format', () => {
      const result = exportProject(mockProject, 'cursor');

      expect(result).toContain('Test Project');
      expect(result).toContain('tech-stack');
    });

    it('should format for .cursorrules file', () => {
      const result = exportProject(mockProject, 'cursor');
      
      expect(result).toContain('Node.js, TypeScript, SQLite');
      expect(result).toContain('Use TypeORM');
    });
  });

  describe('getExportFilename', () => {
    it('should return correct filename for markdown', () => {
      const filename = getExportFilename('markdown', 'my-project');
      expect(filename).toBe('my-project-context.md');
    });

    it('should return correct filename for json', () => {
      const filename = getExportFilename('json', 'my-project');
      expect(filename).toBe('my-project-context.json');
    });

    it('should return correct filename for plain', () => {
      const filename = getExportFilename('plain', 'my-project');
      expect(filename).toBe('my-project-context.txt');
    });

    it('should return correct filename for copilot', () => {
      const filename = getExportFilename('copilot', 'my-project');
      expect(filename).toBe('.github/copilot-instructions.md');
    });

    it('should return correct filename for claude', () => {
      const filename = getExportFilename('claude', 'my-project');
      expect(filename).toBe('CLAUDE.md');
    });

    it('should return correct filename for cursor', () => {
      const filename = getExportFilename('cursor', 'my-project');
      expect(filename).toBe('.cursorrules');
    });

    it('should sanitize project name', () => {
      const filename = getExportFilename('markdown', 'My Project With Spaces!');
      expect(filename).toBe('my-project-with-spaces-context.md');
    });
  });

  describe('edge cases', () => {
    it('should handle empty context entries', () => {
      const project = { ...mockProject, contextEntries: [] };
      const result = exportProject(project, 'markdown');
      
      expect(result).toContain('# Test Project');
      expect(result).toContain('No context entries');
    });

    it('should handle empty decisions', () => {
      const project = { ...mockProject, decisions: [] };
      const result = exportProject(project, 'markdown');
      
      expect(result).toContain('# Test Project');
      expect(result).toContain('No decisions');
    });

    it('should handle project with no data', () => {
      const project = {
        ...mockProject,
        description: null,
        contextEntries: [],
        decisions: [],
      };
      const result = exportProject(project, 'json');
      const parsed = JSON.parse(result);

      expect(parsed.project.name).toBe('Test Project');
      expect(parsed.context).toEqual([]);
      expect(parsed.decisions).toEqual([]);
    });
  });
});
