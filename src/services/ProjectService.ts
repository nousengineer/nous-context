import { DataSource } from 'typeorm';
import { Project } from '../entities/Project';

export class ProjectService {
  private repo;

  constructor(private db: DataSource) {
    this.repo = db.getRepository(Project);
  }

  async list() {
    return this.repo.find();
  }

  async create(data: Partial<Project>) {
    const project = this.repo.create(data);
    return this.repo.save(project);
  }
}