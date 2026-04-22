import { Request, Response } from 'express';
import { ProjectService } from '../services/ProjectService';

export class ProjectController {
  constructor(private projectService: ProjectService) {}

  async list(req: Request, res: Response) {
    const projects = await this.projectService.list();
    res.json(projects);
  }

  async create(req: Request, res: Response) {
    const project = await this.projectService.create(req.body);
    res.status(201).json(project);
  }
}