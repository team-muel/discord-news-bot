import express, { Express } from 'express';
import cors from 'cors';

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  // CORS: 프론트엔드 도메인만 허용하도록 환경변수로 설정합니다.
  // 예: FRONTEND_ORIGIN=https://muel-front.vercel.app
  const frontendOrigin = process.env.FRONTEND_ORIGIN || '';
  if (frontendOrigin) {
    app.use(
      cors({
        origin: frontendOrigin,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      }),
    );
  } else {
    // 개발 편의를 위해 명시적 허용 도메인이 없으면 제한적 허용
    app.use(cors());
  }

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/', (_req, res) => res.send('Muel bot server running'));

  return app;
}

export default createApp;
