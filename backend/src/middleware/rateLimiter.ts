import rateLimit from 'express-rate-limit';

/**
 * In-memory store for development
 * In production, consider using Redis for distributed rate limiting
 */

export const createRateLimiter = (options?: {
  windowMs?: number;
  max?: number;
  keyGenerator?: (req: any) => string;
}) => {
  return rateLimit({
    windowMs: options?.windowMs || 15 * 60 * 1000, // 15 minutes
    max: options?.max || 100, // limit each IP to 100 requests per windowMs
    keyGenerator: options?.keyGenerator || ((req: any) => {
      // Use API key if available, fallback to IP
      return req.headers['x-api-key'] || req.ip;
    }),
    message: {
      error: 'Too many requests, please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 900 // seconds
    },
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    skip: (req: any) => {
      // Skip rate limiting for health checks
      return req.path === '/health';
    }
  });
};

/**
 * GraphQL-specific rate limiter
 * Applied to /graphql endpoint
 */
export const graphqlRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  keyGenerator: (req: any) => {
    // Use API key from GraphQL requests
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return req.ip;
  }
});

/**
 * Production rate limiter with Redis
 * Uncomment and configure for production
 */
/*
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

export const createRedisRateLimiter = (options?: {
  windowMs?: number;
  max?: number;
}) => {
  return rateLimit({
    store: new RedisStore({
      client: redisClient,
      prefix: 'rate-limit:',
    }),
    windowMs: options?.windowMs || 15 * 60 * 1000,
    max: options?.max || 100,
    keyGenerator: (req: any) => {
      return req.headers['x-api-key'] || req.ip;
    },
  });
};
*/