import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataSource } from 'typeorm';
import { ContextService } from '../ContextService';
import { ProjectService } from '../ProjectService';
import { Project } from '../../entities/Project';
import { ContextEntry } from '../../entities/ContextEntry';
import { Decision } from '../../entities/Decision';

describe('ContextService', () => {
  let dataSource: DataSource;
  let service: ContextService;
  let projectService: ProjectService;
  let testProject: Project;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      synchronize: true,
      entities: [Project, ContextEntry, Decision],
    });
    await dataSource.initialize();
    service = new ContextService(dataSource);
    projectService = new ProjectService(dataSource);
    testProject = await projectService.create({ name: 'Test Project' });
  });

  afterEach(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  describe('create', () => {
    it('should create a context entry with all fields', async () => {
      const entry = await service.create({
        projectId: testProject.id,
        key: 'tech-stack',
        value: 'Node.js, TypeScript',
        category: 'architecture',
        priority: 3,
        metadata: { tags: ['backend'] },
      });

      expect(entry.id).toBeDefined();
      expect(entry.key).toBe('tech-stack');
      expect(entry.value).toBe('Node.js, TypeScript');
      expect(entry.category).toBe('architecture');
      expect(entry.priority).toBe(3);
      expect(entry.metadata).toEqual({ tags: ['backend'] });
    });

    it('should use default values when optional fields omitted', async () => {
      const entry = await service.create({
        projectId: testProject.id,
        key: 'simple-key',
        value: 'simple value',
      });

      expect(entry.category).toBe('general');
      expect(entry.priority).toBe(1);
    });

    it('should throw error for non-existent project', async () => {
      await expect(
        service.create({
          projectId: '00000000-0000-0000-0000-000000000000',
          key: 'key',
          value: 'value',
        })
      ).rejects.toThrow('Project not found');
    });
  });

  describe('get', () => {
    it('should retrieve a context entry by id', async () => {
      const created = await service.create({
        projectId: testProject.id,
        key: 'test-key',
        value: 'test value',
      });

      const retrieved = await service.get(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.key).toBe('test-key');
    });

    it('should return null for non-existent id', async () => {
      const result = await service.get('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  describe('listByProject', () => {
    beforeEach(async () => {
      await service.create({
        projectId: testProject.id,
        key: 'arch-1',
        value: 'Architecture info',
        category: 'architecture',
        priority: 3,
      });
      await service.create({
        projectId: testProject.id,
        key: 'req-1',
        value: 'Requirement info',
        category: 'requirements',
        priority: 2,
      });
      await service.create({
        projectId: testProject.id,
        key: 'arch-2',
        value: 'More architecture',
        category: 'architecture',
        priority: 4,
      });
    });

    it('should list all entries for a project', async () => {
      const entries = await service.listByProject(testProject.id);
      expect(entries).toHaveLength(3);
    });

    it('should filter by category', async () => {
      const entries = await service.listByProject(testProject.id, 'architecture');
      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.category === 'architecture')).toBe(true);
    });

    it('should order by priority DESC then createdAt DESC', async () => {
      const entries = await service.listByProject(testProject.id);
      expect(entries[0].key).toBe('arch-2'); // priority 4
      expect(entries[1].key).toBe('arch-1'); // priority 3
      expect(entries[2].key).toBe('req-1');  // priority 2
    });

    it('should return empty array for project with no entries', async () => {
      const newProject = await projectService.create({ name: 'Empty' });
      const entries = await service.listByProject(newProject.id);
      expect(entries).toEqual([]);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await service.create({
        projectId: testProject.id,
        key: 'database',
        value: 'PostgreSQL for main storage',
      });
      await service.create({
        projectId: testProject.id,
        key: 'cache',
        value: 'Redis for caching',
      });
      await service.create({
        projectId: testProject.id,
        key: 'postgresql-config',
        value: 'Connection pool size: 20',
      });
    });

    it('should find entries by key match', async () => {
      const results = await service.search(testProject.id, 'postgresql');
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('postgresql-config');
    });

    it('should find entries by value match', async () => {
      const results = await service.search(testProject.id, 'PostgreSQL');
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('database');
    });

    it('should be case-insensitive', async () => {
      const results = await service.search(testProject.id, 'REDIS');
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('cache');
    });

    it('should return empty array for no matches', async () => {
      const results = await service.search(testProject.id, 'nonexistent');
      expect(results).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update entry fields', async () => {
      const entry = await service.create({
        projectId: testProject.id,
        key: 'original-key',
        value: 'original value',
        priority: 1,
      });

      const updated = await service.update(entry.id, {
        key: 'new-key',
        value: 'new value',
        priority: 3,
        category: 'architecture',
      });

      expect(updated.key).toBe('new-key');
      expect(updated.value).toBe('new value');
      expect(updated.priority).toBe(3);
      expect(updated.category).toBe('architecture');
    });

    it('should preserve unchanged fields', async () => {
      const entry = await service.create({
        projectId: testProject.id,
        key: 'key',
        value: 'value',
        priority: 2,
        category: 'requirements',
      });

      const updated = await service.update(entry.id, { priority: 4 });

      expect(updated.priority).toBe(4);
      expect(updated.key).toBe('key');
      expect(updated.value).toBe('value');
      expect(updated.category).toBe('requirements');
    });

    it('should throw error for non-existent entry', async () => {
      await expect(
        service.update('00000000-0000-0000-0000-000000000000', { key: 'new' })
      ).rejects.toThrow('Context entry not found');
    });
  });

  describe('delete', () => {
    it('should delete existing entry', async () => {
      const entry = await service.create({
        projectId: testProject.id,
        key: 'to-delete',
        value: 'will be removed',
      });

      const result = await service.delete(entry.id);
      expect(result).toBe(true);

      const check = await service.get(entry.id);
      expect(check).toBeNull();
    });

    it('should throw error for non-existent entry', async () => {
      await expect(
        service.delete('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Context entry not found');
    });
  });
});
