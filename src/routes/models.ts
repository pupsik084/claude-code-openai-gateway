import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../server.js';
import { verifyProxyAuth } from '../auth/proxyAuth.js';
import type { OpenAIModel, OpenAIModelList } from '../types/openai.js';

export function registerModelRoutes(app: FastifyInstance, ctx: AppContext): void {
  const created = Math.floor(Date.now() / 1000);

  const toModel = (id: string): OpenAIModel => ({
    id,
    object: 'model',
    created,
    owned_by: 'anthropic',
  });

  app.get('/v1/models', async (req, reply) => {
    verifyProxyAuth(req, ctx.config.PROXY_API_KEY);
    const body: OpenAIModelList = {
      object: 'list',
      data: ctx.modelResolver.listIds().map(toModel),
    };
    return reply.send(body);
  });

  app.get<{ Params: { id: string } }>('/v1/models/:id', async (req, reply) => {
    verifyProxyAuth(req, ctx.config.PROXY_API_KEY);
    return reply.send(toModel(req.params.id));
  });
}
