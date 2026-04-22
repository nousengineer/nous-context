import express from 'express';
import projectRoutes from './routes/projectRoutes';
import { AppDataSource } from './config/data-source';
import { errorHandler } from './middlewares/errorHandler';

const app = express();
const port = 3000;

app.use(express.json());

AppDataSource.initialize()
  .then(() => {
    app.use('/projects', projectRoutes);
    app.use(errorHandler);
    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error('Database initialization failed:', err);
    process.exit(1);
  });
