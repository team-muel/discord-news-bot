// Context entrypoint: automation and bot runtime operations.
export {
  getAutomationRuntimeSnapshot,
  isAutomationEnabled,
  registerAutomationManualTrigger,
  startAutomationJobs,
  startAutomationModules,
  triggerAutomationJob,
  type AutomationJobName,
  type AutomationRuntimeSnapshot,
} from '../services/automationBot';

export {
  getNewsSentimentMonitorSnapshot,
  isNewsSentimentMonitorEnabled,
  startNewsSentimentMonitor,
  stopNewsSentimentMonitor,
  triggerNewsSentimentMonitor,
} from '../services/news/newsSentimentMonitor';

export {
  getYouTubeSubscriptionsMonitorSnapshot,
  startYouTubeSubscriptionsMonitor,
  stopYouTubeSubscriptionsMonitor,
  triggerYouTubeSubscriptionsMonitor,
} from '../services/news/youtubeSubscriptionsMonitor';

export { startRuntimeAlerts, stopRuntimeAlerts } from '../services/runtime/runtimeAlertService';
