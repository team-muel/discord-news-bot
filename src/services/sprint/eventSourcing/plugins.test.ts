import { describe, it, expect, vi } from 'vitest';
import { createMetricsPlugin, createLifecycleHooksPlugin, auditLogPlugin, createSignalBusPlugin } from './plugins';

describe('Ventyd Plugins', () => {
  describe('MetricsPlugin', () => {
    it('should call recordPipelineCreated on created event', async () => {
      const recordPipelineCreated = vi.fn();
      const plugin = createMetricsPlugin({
        recordPhaseMetric: vi.fn(),
        recordLoopBack: vi.fn(),
        recordPipelineCreated,
      });

      await plugin.onCommitted!({
        entityName: 'sprint_pipeline',
        entityId: 'test-1',
        events: [{ eventName: 'sprint_pipeline:created', body: {} }] as any,
        state: {} as any,
      });

      expect(recordPipelineCreated).toHaveBeenCalledOnce();
    });

    it('should call recordPhaseMetric on phase_completed event', async () => {
      const recordPhaseMetric = vi.fn();
      const plugin = createMetricsPlugin({
        recordPhaseMetric,
        recordLoopBack: vi.fn(),
        recordPipelineCreated: vi.fn(),
      });

      await plugin.onCommitted!({
        entityName: 'sprint_pipeline',
        entityId: 'test-1',
        events: [{
          eventName: 'sprint_pipeline:phase_completed',
          body: {
            phase: 'plan',
            status: 'success',
            startedAt: '2026-04-04T10:00:00Z',
            completedAt: '2026-04-04T10:05:00Z',
          },
        }] as any,
        state: {} as any,
      });

      expect(recordPhaseMetric).toHaveBeenCalledWith('plan', 300_000, false);
    });

    it('should call recordLoopBack on looped_back event', async () => {
      const recordLoopBack = vi.fn();
      const plugin = createMetricsPlugin({
        recordPhaseMetric: vi.fn(),
        recordLoopBack,
        recordPipelineCreated: vi.fn(),
      });

      await plugin.onCommitted!({
        entityName: 'sprint_pipeline',
        entityId: 'test-1',
        events: [{
          eventName: 'sprint_pipeline:looped_back',
          body: { fromPhase: 'review', toPhase: 'implement', loopCount: 1 },
        }] as any,
        state: {} as any,
      });

      expect(recordLoopBack).toHaveBeenCalledOnce();
    });
  });

  describe('LifecycleHooksPlugin', () => {
    it('should fire SprintStart on created event', async () => {
      const executeHooks = vi.fn().mockResolvedValue({});
      const plugin = createLifecycleHooksPlugin({ executeHooks });

      await plugin.onCommitted!({
        entityName: 'sprint_pipeline',
        entityId: 'sprint-42',
        events: [{
          eventName: 'sprint_pipeline:created',
          body: { triggerType: 'manual', objective: 'Fix bug', guildId: 'g1' },
        }] as any,
        state: {} as any,
      });

      expect(executeHooks).toHaveBeenCalledWith(expect.objectContaining({
        hookPoint: 'SprintStart',
        sprintId: 'sprint-42',
      }));
    });

    it('should fire SprintComplete on completed event', async () => {
      const executeHooks = vi.fn().mockResolvedValue({});
      const plugin = createLifecycleHooksPlugin({ executeHooks });

      await plugin.onCommitted!({
        entityName: 'sprint_pipeline',
        entityId: 'sprint-42',
        events: [{ eventName: 'sprint_pipeline:completed', body: {} }] as any,
        state: {
          objective: 'Test',
          changedFiles: ['a.ts'],
          totalPhasesExecuted: 5,
        } as any,
      });

      expect(executeHooks).toHaveBeenCalledWith(expect.objectContaining({
        hookPoint: 'SprintComplete',
        sprintId: 'sprint-42',
      }));
    });
  });

  describe('AuditLogPlugin', () => {
    it('should log events without throwing', async () => {
      await expect(
        auditLogPlugin.onCommitted!({
          entityName: 'sprint_pipeline',
          entityId: 'test-1',
          events: [{ eventName: 'sprint_pipeline:created', body: { objective: 'test' } }] as any,
          state: {} as any,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
