import pino from 'pino';
import { config } from './config.js';

const options: pino.LoggerOptions = {
  level: config.isTest ? 'silent' : config.LOG_LEVEL,
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'password', '*.password', '*.token', '*.secret'],
    censor: '[redacted]',
  },
};

// The desktop app writes JSON logs to a file in its data directory (there is no console).
export const logger = config.LOG_FILE
  ? pino(options, pino.destination({ dest: config.LOG_FILE, mkdir: true, sync: false }))
  : pino({
      ...options,
      transport:
        !config.isProd && !config.isTest
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    });
