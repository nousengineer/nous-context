import { Router } from 'express';
import { ProjectController } from '../controllers/ProjectController';
import { ProjectService } from '../services/ProjectService';
import { createConnection } from 'typeorm';

const router = Router();

createConnection().then(connection => {
  const projectService = new ProjectService(connection);
  const projectController = new ProjectController(projectService);

  router.get('/', (req, res) => projectController.list(req, res));
  router.post('/', (req, res) => projectController.create(req, res));
});

export default router;