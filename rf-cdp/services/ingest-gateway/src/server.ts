import fastify from 'fastify';
import { routes } from './routes';
import { config } from './config';
import pino from 'pino';

const logger = pino({ level: 'info' });

const server = fastify({
  logger,
  bodyLimit: 1048576 // 1 MB limit
});

// CORS — let the storefront (different origin) POST events with the x-write-key header.
// '*' in ALLOWED_ORIGINS => reflect any origin; otherwise an explicit allow-list.
const origins = config.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
server.register(require('@fastify/cors'), {
  origin: origins.includes('*') ? true : origins,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-write-key'],
  maxAge: 86400,
});

// Registering routes
server.register(routes);

// Health check endpoint
server.get('/healthz', async () => {
  return { status: 'ok' };
});

// Start the server
const start = async () => {
  try {
    await server.listen({ port: parseInt(config.PORT, 10) });
    logger.info(`Server listening on ${server.server.address().port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();