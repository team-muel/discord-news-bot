import { requireAdmin } from '../../middleware/auth';
import { getToolRuntimeStatus, getExternalToolsStatus, getExternalAdaptersStatus } from '../../services/tools/toolRouter';

import { BotAgentRouteDeps } from './types';

export function registerBotAgentToolsRoutes(deps: BotAgentRouteDeps): void {
  const { router } = deps;

  router.get('/agent/tools/status', requireAdmin, (_req, res) => {
    return res.json({
      ok: true,
      runtime: getToolRuntimeStatus(),
    });
  });

  router.get('/agent/tools/external', requireAdmin, async (_req, res) => {
    const probe = await getExternalToolsStatus();
    return res.json({ ok: true, ...probe });
  });

  router.get('/agent/tools/adapters', requireAdmin, async (_req, res) => {
    const adapters = await getExternalAdaptersStatus();
    return res.json({ ok: true, adapters });
  });
}