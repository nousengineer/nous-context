import { Router } from 'express';
import { ProjectController } from '../controllers/ProjectController';
import { ProjectService } from '../services/ProjectService';
import { AppDataSource } from '../config/data-source';
import { validationMiddleware } from '../middlewares/validationMiddleware';
import { ProjectInput } from '../entities/ProjectInput';

const router = Router();

const projectService = new ProjectService(AppDataSource);
const projectController = new ProjectController(projectService);

router.get('/', (req, res) => projectController.list(req, res));
router.post('/', validationMiddleware(ProjectInput), (req, res) => projectController.create(req, res));

export default router;