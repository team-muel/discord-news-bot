import { requireAdmin } from '../../middleware/auth';
import { getToolRuntimeStatus } from '../../services/tools/toolRouter';

import { BotAgentRouteDeps } from './types';

export function registerBotAgentToolsRoutes(deps: BotAgentRouteDeps): void {
  const { router } = deps;

  router.get('/agent/tools/status', requireAdmin, (_req, res) => {
    return res.json({
      ok: true,
      runtime: getToolRuntimeStatus(),
    });
  });
}