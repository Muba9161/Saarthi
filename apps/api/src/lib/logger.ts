import pino, { type LoggerOptions } from 'pino';
import { config } from '../config/env';

/**
 * Structured logging. Sensitive fields are redacted at the transport level so
 * a careless `log.info({ body })` can never leak a password or token.
 */
const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  '*.password',
  '*.passwordHash',
  '*.refreshToken',
  '*.accessToken',
];

const options: LoggerOptions = {
  level: config.isTest ? 'silent' : config.log.level,
  redact: { paths: redactPaths, censor: '[redacted]' },
  base: { service: 'saarthi-api', env: config.env },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
};

export const logger = config.log.pretty
  ? pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname,service,env',
          singleLine: false,
        },
      },
    })
  : pino(options);

export type Logger = typeof logger;

export function childLogger(module: string) {
  return logger.child({ module });
}
