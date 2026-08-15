import { buildApp } from './server/app';
import { config } from './config/env';
import { logger } from './lib/logger';
import { connectDatabase, disconnectDatabase } from './database/prisma';
import { registerBackgroundJobs } from './jobs';
import { queue } from './infra/queue';
import { startSimulationEngine, stopSimulationEngine } from './modules/simulation/simulator.service';

async function start(): Promise<void> {
  await connectDatabase();

  const app = await buildApp();

  registerBackgroundJobs();
  startSimulationEngine();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down Saarthi API');
    try {
      stopSimulationEngine();
      await queue.stop();
      await app.close();
      await disconnectDatabase();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception — exiting');
    process.exit(1);
  });

  await app.listen({ host: config.server.host, port: config.server.port });

  logger.info(
    {
      url: config.server.apiUrl,
      env: config.env,
      demoMode: config.demo.enabled,
      storage: config.storage.provider,
      gps: config.providers.gps,
      ai: config.ai.provider,
    },
    `Saarthi API listening on http://localhost:${config.server.port}`,
  );
}

start().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start Saarthi API');
  process.exit(1);
});
