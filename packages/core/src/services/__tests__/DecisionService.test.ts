import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataSource } from 'typeorm';
import { DecisionService } from '../DecisionService';
import { ProjectService } from '../ProjectService';
import { Project } from '../../entities/Project';
import { ContextEntry } from '../../entities/ContextEntry';
import { Decision } from '../../entities/Decision';

describe('DecisionService', () => {
  let dataSource: DataSource;
  let service: DecisionService;
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
    service = new DecisionService(dataSource);
    projectService = new ProjectService(dataSource);
    testProject = await projectService.create({ name: 'Decision Test Project' });
  });

  afterEach(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  describe('create', () => {
    it('should create a decision with all fields', async () => {
      const decision = await service.create({
        projectId: testProject.id,
        title: 'Use TypeScript',
        description: 'We will use TypeScript for type safety and better DX',
        rationale: { factors: ['type safety', 'tooling'] },
        alternatives: { considered: ['JavaScript', 'Flow'] },
      });

      expect(decision.id).toBeDefined();
      expect(decision.title).toBe('Use TypeScript');
      expect(decision.description).toBe('We will use TypeScript for type safety and better DX');
      expect(decision.status).toBe('active');
      expect(decision.rationale).toEqual({ factors: ['type safety', 'tooling'] });
      expect(decision.alternatives).toEqual({ considered: ['JavaScript', 'Flow'] });
    });

    it('should create a decision with minimal fields', async () => {
      const decision = await service.create({
        projectId: testProject.id,
        title: 'Simple Decision',
        description: 'A simple decision without extra metadata',
      });

      expect(decision.id).toBeDefined();
      expect(decision.title).toBe('Simple Decision');
      expect(decision.status).toBe('active');
    });

    it('should throw error for non-existent project', async () => {
      await expect(
        service.create({
          projectId: '00000000-0000-0000-0000-000000000000',
          title: 'Invalid',
          description: 'This will fail',
        })
      ).rejects.toThrow('Project not found');
    });
  });

  describe('get', () => {
    it('should retrieve a decision by id', async () => {
      const created = await service.create({
        projectId: testProject.id,
        title: 'Test Decision',
        description: 'For testing get method',
      });

      const retrieved = await service.get(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe('Test Decision');
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
        title: 'Decision 1',
        description: 'First decision',
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      await service.create({
        projectId: testProject.id,
        title: 'Decision 2',
        description: 'Second decision',
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      await service.create({
        projectId: testProject.id,
        title: 'Decision 3',
        description: 'Third decision',
      });
    });

    it('should list all decisions for a project', async () => {
      const decisions = await service.listByProject(testProject.id);
      expect(decisions).toHaveLength(3);
    });

    it('should order by createdAt DESC', async () => {
      const decisions = await service.listByProject(testProject.id);
      expect(decisions[0].title).toBe('Decision 3');
      expect(decisions[1].title).toBe('Decision 2');
      expect(decisions[2].title).toBe('Decision 1');
    });

    it('should return empty array for project with no decisions', async () => {
      const newProject = await projectService.create({ name: 'Empty Project' });
      const decisions = await service.listByProject(newProject.id);
      expect(decisions).toEqual([]);
    });

    it('should filter by status', async () => {
      const d1 = await service.create({
        projectId: testProject.id,
        title: 'Active',
        description: 'Active decision',
      });
      await service.create({
        projectId: testProject.id,
        title: 'Deprecated',
        description: 'Deprecated decision',
      });
      await service.update(d1.id, { status: 'deprecated' });

      const active = await service.listByProject(testProject.id, 'active');
      const deprecated = await service.listByProject(testProject.id, 'deprecated');

      expect(active).toHaveLength(3); // original 3 + new deprecated = 4, minus 1 moved = 3
      expect(deprecated).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('should update decision fields', async () => {
      const decision = await service.create({
        projectId: testProject.id,
        title: 'Original Title',
        description: 'Original description',
      });

      const updated = await service.update(decision.id, {
        title: 'Updated Title',
        status: 'deprecated',
        rationale: { reason: 'no longer needed' },
      });

      expect(updated.title).toBe('Updated Title');
      expect(updated.status).toBe('deprecated');
      expect(updated.rationale).toEqual({ reason: 'no longer needed' });
    });

    it('should preserve unchanged fields', async () => {
      const decision = await service.create({
        projectId: testProject.id,
        title: 'Title',
        description: 'Description',
      });

      const updated = await service.update(decision.id, { status: 'superseded' });

      expect(updated.status).toBe('superseded');
      expect(updated.title).toBe('Title');
      expect(updated.description).toBe('Description');
    });

    it('should throw error for non-existent decision', async () => {
      await expect(
        service.update('00000000-0000-0000-0000-000000000000', { title: 'New' })
      ).rejects.toThrow('Decision not found');
    });
  });

  describe('delete', () => {
    it('should delete existing decision', async () => {
      const decision = await service.create({
        projectId: testProject.id,
        title: 'To Delete',
        description: 'Will be removed',
      });

      const result = await service.delete(decision.id);
      expect(result).toBe(true);

      const check = await service.get(decision.id);
      expect(check).toBeNull();
    });

    it('should throw error for non-existent decision', async () => {
      await expect(
        service.delete('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Decision not found');
    });
  });
});
