import 'dotenv/config';
import { client, startBot } from './src/bot';
import { setDefaultResultOrder } from 'dns';

setDefaultResultOrder('ipv4first');

process.on('unhandledRejection', (reason) => {
  console.error('[PROCESS] Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[PROCESS] Uncaught exception:', error);
});

const handleShutdownSignal = (signal: NodeJS.Signals) => {
  console.log(`[PROCESS] Received ${signal}, shutting down Discord client...`);
  try {
    if (client.isReady()) {
      client.destroy();
    }
  } catch (error) {
    console.error('[PROCESS] Failed during Discord client shutdown:', error);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => handleShutdownSignal('SIGINT'));
process.on('SIGTERM', () => handleShutdownSignal('SIGTERM'));

const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;

// 개발환경에서만 간단히 존재 여부를 남깁니다(길이 등 민감정보는 노출하지 않음).
console.log('DEBUG: DISCORD token present?', !!token);

if (!token) {
  console.error('DISCORD token not provided. Set DISCORD_TOKEN or DISCORD_BOT_TOKEN.');
  process.exit(1);
}

// 안전한 비동기 시작: startBot이 Promise를 반환하더라도 정상 동작하도록 await 처리합니다.
(async () => {
  try {
    await startBot(token);
    console.log('Muel bot is initiating...');
  } catch (err) {
    console.error('Failed to start bot:', err);
    process.exit(1);
  }
})();

const handleShutdownSignal = async (signal: NodeJS.Signals) => {
  console.log(`[PROCESS] Received ${signal}, shutting down Discord client...`);
  try {
    if (client && typeof (client as any).isReady === 'function' && (client as any).isReady()) {
      // client.destroy() may be synchronous or return a Promise; wrap with Promise.resolve to await both cases.
      await Promise.resolve((client as any).destroy());
    }
  } catch (error) {
    console.error('[PROCESS] Failed during Discord client shutdown:', error);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => { handleShutdownSignal('SIGINT').catch(e => console.error(e)); });
process.on('SIGTERM', () => { handleShutdownSignal('SIGTERM').catch(e => console.error(e)); });