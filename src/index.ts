import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { createLogger } from './util/logger.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // Config errors happen before the logger exists; print and exit.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const logger = createLogger(config);

  if (config.HOST === '0.0.0.0') {
    logger.warn(
      'HOST=0.0.0.0 exposes the gateway on all interfaces. Ensure PROXY_API_KEY is strong.',
    );
    const weak = config.PROXY_API_KEY.some((k) => k.length < 16 || k === 'changeme-local-key');
    if (weak) {
      logger.error('Refusing to bind 0.0.0.0 with a weak/default PROXY_API_KEY.');
      process.exit(1);
    }
  }

  const app = await buildServer(config, logger);

  logger.info(
    {
      port: config.PORT,
      host: config.HOST,
      upstreamMode: config.UPSTREAM_AUTH_MODE,
      claudeCodeVersion: config.CLAUDE_CODE_VERSION,
    },
    'Starting claude-code-openai-gateway',
  );

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
