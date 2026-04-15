import express from 'express';
import { createConnection } from 'typeorm';
import { ProjectService } from './services/ProjectService';

const app = express();
const port = 3000;

// Middleware
app.use(express.json());

// Database connection
createConnection().then(async (connection) => {
  console.log('Database connected');

  const projectService = new ProjectService(connection);

  // Endpoints
  app.get('/projects', async (req, res) => {
    const projects = await projectService.list();
    res.json(projects);
  });

  app.post('/projects', async (req, res) => {
    const project = await projectService.create(req.body);
    res.status(201).json(project);
  });

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}).catch((error) => console.error('Database connection error:', error));