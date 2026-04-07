import { createLogger, format, transports } from 'winston';
import { parseStringEnv } from './utils/env';

const logger = createLogger({
  level: parseStringEnv(process.env.LOG_LEVEL, 'info'),
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.splat(),
    format.json(),
  ),
  transports: [new transports.Console()],
});

export default logger;
