import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodSchema } from 'zod';
import { identifySchema, trackSchema, batchSchema } from './schemas';
import { ingestIdentify, ingestTrack, ingestBatch } from './dittofeed';

// Require the x-write-key header; 401 if absent.
function requireWriteKey(request: FastifyRequest, reply: FastifyReply): string | null {
  const writeKey = request.headers['x-write-key'];
  if (typeof writeKey !== 'string' || !writeKey) {
    reply.status(401).send({ error: 'missing x-write-key header' });
    return null;
  }
  return writeKey;
}

// Runtime-validate the body with zod; 400 + issues on failure.
function parseBody<T>(schema: ZodSchema<T>, request: FastifyRequest, reply: FastifyReply): T | null {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    reply.status(400).send({ error: 'validation', issues: result.error.issues });
    return null;
  }
  return result.data;
}

function statusOf(error: unknown): number {
  return (error as { status?: number })?.status ?? 500;
}

export const routes = async (server: FastifyInstance) => {
  server.post('/v1/identify', async (request, reply) => {
    const writeKey = requireWriteKey(request, reply);
    if (!writeKey) return;
    const body = parseBody(identifySchema, request, reply);
    if (!body) return;
    if (!body.userId && !body.anonymousId) {
      return reply.status(400).send({ error: 'userId or anonymousId required' });
    }
    try {
      await ingestIdentify(writeKey, body);
      return reply.status(204).send();
    } catch (error) {
      return reply.status(statusOf(error)).send({ error: (error as Error).message });
    }
  });

  server.post('/v1/track', async (request, reply) => {
    const writeKey = requireWriteKey(request, reply);
    if (!writeKey) return;
    const body = parseBody(trackSchema, request, reply);
    if (!body) return;
    if (!body.userId && !body.anonymousId) {
      return reply.status(400).send({ error: 'userId or anonymousId required' });
    }
    try {
      await ingestTrack(writeKey, body);
      return reply.status(204).send();
    } catch (error) {
      return reply.status(statusOf(error)).send({ error: (error as Error).message });
    }
  });

  server.post('/v1/batch', async (request, reply) => {
    const writeKey = requireWriteKey(request, reply);
    if (!writeKey) return;
    const body = parseBody(batchSchema, request, reply);
    if (!body) return;
    try {
      await ingestBatch(writeKey, body.batch);
      return reply.status(204).send();
    } catch (error) {
      return reply.status(statusOf(error)).send({ error: (error as Error).message });
    }
  });
};
