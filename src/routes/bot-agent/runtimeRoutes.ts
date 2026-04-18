import { requireAdmin } from '../../middleware/auth';
import { registerBotAgentInfrastructureRoutes } from './runtime-subareas/infrastructureRoutes';
import { registerBotAgentOpenjarvisRoutes } from './runtime-subareas/openjarvisRoutes';
import { registerBotAgentSnapshotRoutes } from './runtime-subareas/snapshotRoutes';
import { registerBotAgentWorkerHealthRoutes } from './runtime-subareas/workerHealthRoutes';
import { BotAgentRouteDeps } from './types';

export {
  buildActiveWorkset,
  buildOperatorSnapshot,
} from './runtime-builders/snapshotReports';

export function registerBotAgentRuntimeRoutes(deps: BotAgentRouteDeps): void {
  registerBotAgentWorkerHealthRoutes(deps);
  registerBotAgentInfrastructureRoutes(deps);
  registerBotAgentOpenjarvisRoutes(deps);
  registerBotAgentSnapshotRoutes(deps);
}
