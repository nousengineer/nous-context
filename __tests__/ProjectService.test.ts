import { DataSource } from 'typeorm';
import { ProjectService } from '../src/services/ProjectService';
import { Project } from '../src/entities/Project';

describe('ProjectService', () => {
  let db: DataSource;
  let service: ProjectService;

  beforeAll(async () => {
    db = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [Project],
      synchronize: true,
    });
    await db.initialize();
    service = new ProjectService(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('should create a project', async () => {
    const project = await service.create({ name: 'Test Project', description: 'Test Description' });
    expect(project.id).toBeDefined();
    expect(project.name).toBe('Test Project');
  });

  it('should list projects', async () => {
    await service.create({ name: 'Another Project', description: 'Another Description' });
    const projects = await service.list();
    expect(projects.length).toBeGreaterThan(0);
  });
});