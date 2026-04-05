import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import express, { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import { json } from 'body-parser';
import 'reflect-metadata';

import { AppDataSource } from './data-source';
import { typeDefs } from './graphql/schema';
import { resolvers } from './graphql/resolvers';
import { graphqlRateLimiter } from './middleware/rateLimiter';
import { exportProjectContext } from './routes/export';

async function startServer() {
  // Initialize database
  await AppDataSource.initialize()
    .then(() => {
      console.log('✅ Database initialized');
    })
    .catch((error) => {
      console.error('❌ Database error:', error);
      throw error;
    });

  const app = express();
  const httpServer = http.createServer(app);

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  }));
  app.use(json());

  // Rate limiting on GraphQL endpoint
  app.use('/graphql', graphqlRateLimiter);

  // Create Apollo Server
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
    includeStacktraceInErrorResponses: process.env.NODE_ENV === 'development',
  });

  await server.start();

  // Apply Apollo middleware
  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: async ({ req }: { req: Request }) => ({ req }),
    }),
  );

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV
    });
  });

  // Context export endpoint
  app.get('/api/projects/:projectId/export', exportProjectContext as any);

  const PORT = process.env.PORT || 4000;

  await new Promise<void>((resolve) => {
    httpServer.listen({ port: PORT }, resolve);
  });

  console.log(`\n🚀 Server ready at http://localhost:${PORT}/graphql`);
  console.log(`🏥 Health check at http://localhost:${PORT}/health`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}\n`);
}

startServer().catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});