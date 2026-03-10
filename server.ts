import { createApp } from './src/app';
import { client, startBot } from './src/bot';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const app = createApp();

const toBool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return fallback;
};

const START_BOT = toBool(process.env.START_BOT, true);

const bootstrapPrimaryBot = () => {
  if (!START_BOT) {
    console.log('[RENDER_EVENT] BOT_START_SKIPPED reason=START_BOT_disabled');
    return false;
  }

  const token = (process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || '').trim();
  startBot(token);
  return true;
};

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[RENDER_EVENT] SERVER_READY port=${PORT}`);
  console.log(`Server running on http://localhost:${PORT}`);

  bootstrapPrimaryBot();
});

const gracefulShutdown = async (signal: NodeJS.Signals) => {
  console.log(`[RENDER_EVENT] SERVER_SHUTDOWN signal=${signal}`);
  try {
    if (client.isReady()) {
      client.destroy();
    }
  } catch (error) {
    console.error('[RENDER_EVENT] BOT_PRIMARY_DESTROY_FAILED', error);
  }
  process.exit(0);
};

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});
