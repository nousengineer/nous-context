import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataSource } from 'typeorm';
import { ProjectService } from '../ProjectService';
import { Project } from '../../entities/Project';
import { ContextEntry } from '../../entities/ContextEntry';
import { Decision } from '../../entities/Decision';

describe('ProjectService', () => {
  let dataSource: DataSource;
  let service: ProjectService;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      synchronize: true,
      entities: [Project, ContextEntry, Decision],
    });
    await dataSource.initialize();
    service = new ProjectService(dataSource);
  });

  afterEach(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  describe('create', () => {
    it('should create a project with valid input', async () => {
      const input = { name: 'Test Project', description: 'A test project' };
      const project = await service.create(input);

      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.description).toBe('A test project');
      expect(project.status).toBe('active');
    });

    it('should create a project without description', async () => {
      const input = { name: 'Minimal Project' };
      const project = await service.create(input);

      expect(project.id).toBeDefined();
      expect(project.name).toBe('Minimal Project');
      expect(project.description).toBeNull();
    });
  });

  describe('get', () => {
    it('should retrieve a project by id', async () => {
      const created = await service.create({ name: 'Get Test', description: 'Test' });
      const retrieved = await service.get(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.name).toBe('Get Test');
    });

    it('should return null for non-existent id', async () => {
      const result = await service.get('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });

    it('should load related entities', async () => {
      const project = await service.create({ name: 'With Relations' });
      const retrieved = await service.get(project.id);

      expect(retrieved?.contextEntries).toBeDefined();
      expect(retrieved?.decisions).toBeDefined();
      expect(Array.isArray(retrieved?.contextEntries)).toBe(true);
      expect(Array.isArray(retrieved?.decisions)).toBe(true);
    });
  });

  describe('findByName', () => {
    it('should find a project by exact name', async () => {
      await service.create({ name: 'Unique Name' });
      const found = await service.findByName('Unique Name');

      expect(found).toBeDefined();
      expect(found?.name).toBe('Unique Name');
    });

    it('should return null for non-existent name', async () => {
      const result = await service.findByName('Does Not Exist');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('should return empty array when no projects exist', async () => {
      const projects = await service.list();
      expect(projects).toEqual([]);
    });

    it('should list all projects', async () => {
      await service.create({ name: 'Project 1' });
      await service.create({ name: 'Project 2' });
      await service.create({ name: 'Project 3' });

      const projects = await service.list();
      expect(projects).toHaveLength(3);
    });

    it('should order by createdAt DESC', async () => {
      const p1 = await service.create({ name: 'First' });
      await new Promise(resolve => setTimeout(resolve, 10));
      const p2 = await service.create({ name: 'Second' });

      const projects = await service.list();
      expect(projects[0].id).toBe(p2.id);
      expect(projects[1].id).toBe(p1.id);
    });
  });

  describe('update', () => {
    it('should update project name', async () => {
      const project = await service.create({ name: 'Original Name' });
      const updated = await service.update(project.id, { name: 'New Name' });

      expect(updated.name).toBe('New Name');
      expect(updated.id).toBe(project.id);
    });

    it('should update project status', async () => {
      const project = await service.create({ name: 'Active Project' });
      const updated = await service.update(project.id, { status: 'archived' });

      expect(updated.status).toBe('archived');
    });

    it('should throw error for non-existent project', async () => {
      await expect(
        service.update('00000000-0000-0000-0000-000000000000', { name: 'New' })
      ).rejects.toThrow('Project not found');
    });

    it('should preserve unchanged fields', async () => {
      const project = await service.create({ name: 'Original', description: 'Desc' });
      const updated = await service.update(project.id, { name: 'Changed' });

      expect(updated.name).toBe('Changed');
      expect(updated.description).toBe('Desc');
    });
  });

  describe('delete', () => {
    it('should delete existing project', async () => {
      const project = await service.create({ name: 'To Delete' });
      const result = await service.delete(project.id);

      expect(result).toBe(true);
      const check = await service.get(project.id);
      expect(check).toBeNull();
    });

    it('should throw error for non-existent project', async () => {
      await expect(
        service.delete('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Project not found');
    });
  });

  describe('workspace operations', () => {
    it('should link workspace to project', async () => {
      const project = await service.create({ name: 'Workspace Test' });
      const workspace = '/home/user/projects/test';
      
      const updated = await service.linkWorkspace(project.id, workspace);
      
      expect(updated.metadata).toBeDefined();
      expect((updated.metadata as any).workspace).toBe(workspace);
    });

    it('should find project by workspace path', async () => {
      const project = await service.create({ name: 'Find By WS' });
      await service.linkWorkspace(project.id, '/home/user/my-project');

      const found = await service.findByWorkspace('/home/user/my-project');
      expect(found).toBeDefined();
      expect(found?.id).toBe(project.id);
    });

    it('should normalize paths when finding by workspace', async () => {
      const project = await service.create({ name: 'Normalize Test' });
      await service.linkWorkspace(project.id, '/home/user/project/');

      const found1 = await service.findByWorkspace('/home/user/project');
      const found2 = await service.findByWorkspace('/home/user/project/');
      const found3 = await service.findByWorkspace('\\home\\user\\project\\');

      expect(found1?.id).toBe(project.id);
      expect(found2?.id).toBe(project.id);
      expect(found3?.id).toBe(project.id);
    });

    it('should return null when workspace not found', async () => {
      const found = await service.findByWorkspace('/non/existent/path');
      expect(found).toBeNull();
    });
  });
});
