import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../server.js';

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_req, reply) => {
    const creds = ctx.creds.current();
    const ready = creds.mode === 'oauth' ? Boolean(creds.oauthToken) : Boolean(creds.apiKey);
    if (!ready) {
      return reply.code(503).send({ status: 'not_ready', reason: 'missing upstream credentials' });
    }
    return reply.send({ status: 'ready', upstreamMode: creds.mode });
  });
}
