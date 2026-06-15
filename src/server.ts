import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { UpstreamCredentialStore } from './auth/upstreamCreds.js';
import { ModelResolver } from './models/modelMap.js';
import { AnthropicClient } from './upstream/anthropicClient.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerModelRoutes } from './routes/models.js';
import { registerChatRoutes } from './routes/chatCompletions.js';
import { GatewayError } from './util/errors.js';
import { createLogger, type Logger } from './util/logger.js';

export interface AppContext {
  config: Config;
  logger: Logger;
  creds: UpstreamCredentialStore;
  client: AnthropicClient;
  modelResolver: ModelResolver;
}

export function createContext(config: Config, logger: Logger): AppContext {
  const creds = new UpstreamCredentialStore(config, logger);
  const client = new AnthropicClient(config, creds, logger);
  const modelResolver = new ModelResolver({
    defaultModel: config.DEFAULT_MODEL,
    overrides: config.modelMap,
  });
  return { config, logger, creds, client, modelResolver };
}

export async function buildServer(config: Config, logger?: Logger): Promise<FastifyInstance> {
  const log = logger ?? createLogger(config);
  const ctx = createContext(config, log);

  const app = Fastify({
    loggerInstance: log as unknown as FastifyBaseLogger,
    bodyLimit: config.MAX_BODY_BYTES,
    disableRequestLogging: !config.LOG_BODIES,
    genReqId: () => randomUUID(),
  });

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err instanceof GatewayError) {
      const headers: Record<string, string> = {};
      if (err.retryAfter) headers['retry-after'] = err.retryAfter;
      return reply.code(err.status).headers(headers).send(err.toOpenAIBody());
    }
    if ('statusCode' in err && err.statusCode === 413) {
      return reply.code(413).send({
        error: { message: 'Request body too large', type: 'invalid_request_error', code: null },
      });
    }
    log.error({ err }, 'Unhandled error');
    return reply.code(500).send({
      error: { message: 'Internal server error', type: 'api_error', code: null },
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    return reply.code(404).send({
      error: { message: 'Not found', type: 'invalid_request_error', code: null },
    });
  });

  registerHealthRoutes(app, ctx);
  registerModelRoutes(app, ctx);
  registerChatRoutes(app, ctx);

  return app;
}
