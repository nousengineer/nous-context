import express from 'express';
import projectRoutes from './routes/projectRoutes';

const app = express();
const port = 3000;

// Middleware
app.use(express.json());

// Routes
app.use('/projects', projectRoutes);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});