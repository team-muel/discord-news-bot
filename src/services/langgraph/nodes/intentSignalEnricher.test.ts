import { describe, it, expect } from 'vitest';
import { enrichIntentSignals, collectGraphNeighborTags } from './intentSignalEnricher';
import type { PromptCompileResult } from '../../infra/promptCompiler';

const mockCompiled: PromptCompileResult = {
  originalGoal: 'test',
  normalizedGoal: 'test',
  executionGoal: 'test',
  compiledGoal: 'test',
  intentTags: ['coding'],
  directives: [],
  droppedNoise: false,
};

describe('intentSignalEnricher', () => {
  describe('collectGraphNeighborTags', () => {
    it('returns empty for null metadata', () => {
      const result = collectGraphNeighborTags(['trading'], null);
      expect(result.tags).toEqual([]);
      expect(result.clusterHint).toBeNull();
    });

    it('collects tags from keyword-matched nodes', () => {
      const graph = {
        'docs/trading-strategy.md': {
          tags: ['trading', 'strategy'],
          backlinks: [],
        },
        'docs/unrelated.md': {
          tags: ['other'],
          backlinks: [],
        },
      };
      const result = collectGraphNeighborTags(['trading'], graph);
      expect(result.tags).toContain('trading');
      expect(result.tags).toContain('strategy');
      expect(result.tags).not.toContain('other');
    });

    it('follows 1-hop backlinks for tags', () => {
      const graph: Record<string, { tags: string[]; backlinks: string[] }> = {
        'docs/cvd.md': {
          tags: ['analysis'],
          backlinks: ['docs/trading.md'],
        },
        'docs/trading.md': {
          tags: ['trading', 'market'],
          backlinks: [],
        },
      };
      const result = collectGraphNeighborTags(['cvd'], graph);
      expect(result.tags).toContain('analysis');
      expect(result.tags).toContain('trading');
      expect(result.tags).toContain('market');
    });

    it('produces clusterHint when a tag appears 2+ times', () => {
      const graph = {
        'docs/trading-a.md': {
          tags: ['trading', 'binance'],
          backlinks: [],
        },
        'docs/trading-b.md': {
          tags: ['trading', 'strategy'],
          backlinks: [],
        },
      };
      const result = collectGraphNeighborTags(['trading'], graph);
      expect(result.clusterHint).toBe('trading');
    });
  });

  describe('enrichIntentSignals', () => {
    it('returns a complete signal bundle with no deps', async () => {
      const result = await enrichIntentSignals({
        guildId: 'g1',
        requestedBy: 'u1',
        goal: 'test goal',
        compiledPrompt: mockCompiled,
        memoryHints: ['hint1'],
      });

      expect(result.message).toBe('test');
      expect(result.compiledPrompt).toBe(mockCompiled);
      expect(result.recentTurns).toEqual([]);
      expect(result.turnPosition).toBe(0);
      expect(result.graphNeighborTags).toEqual([]);
      expect(result.graphClusterHint).toBeNull();
      expect(result.memoryHints).toEqual(['hint1']);
    });

    it('loads recent turns when dep is provided', async () => {
      const result = await enrichIntentSignals({
        guildId: 'g1',
        requestedBy: 'u1',
        goal: 'test goal',
        compiledPrompt: mockCompiled,
        memoryHints: [],
        deps: {
          loadRecentTurns: async () => [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' },
          ],
        },
      });

      expect(result.recentTurns).toHaveLength(2);
      expect(result.turnPosition).toBe(1); // 1 user turn
    });
  });
});
