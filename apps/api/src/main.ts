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

  // Said on every restart, not once at install: a deployment that vouches for
  // drivers no authority has checked should never be a quiet fact somebody has
  // to go looking for.
  if (config.verification.unverifiedDriversAllowed) {
    logger.warn(
      { allowUnverifiedDrivers: true },
      'Driver verification is OFF in production (ALLOW_UNVERIFIED_DRIVERS=true). ' +
        'Every driver is marked verified with no licence, Aadhaar, PAN or Voter ID confirmed. ' +
        'Intended for pre-launch testing only — turn this off before real drivers exist.',
    );
  }

  logger.info(
    {
      url: config.server.apiUrl,
      env: config.env,
      demoMode: config.demo.enabled,
      storage: config.storage.provider,
      gps: config.providers.gps,
      ai: config.ai.provider,
      driverChecks: config.verification.driverChecksEnforced ? 'enforced' : 'OFF',
    },
    `Saarthi API listening on http://localhost:${config.server.port}`,
  );
}

start().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start Saarthi API');
  process.exit(1);
});
