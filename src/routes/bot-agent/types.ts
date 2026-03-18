import { type RequestHandler, type Router } from 'express';

export type BotAgentRouteDeps = {
  router: Router;
  adminActionRateLimiter: RequestHandler;
  adminIdempotency: RequestHandler;
  opencodeIdempotency: RequestHandler;
};
