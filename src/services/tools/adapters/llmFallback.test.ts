import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../logger', () => ({
  default: {
    debug: vi.fn(),
  },
}));

vi.mock('../../llmClient', () => ({
  isAnyLlmConfigured: vi.fn(() => false),
  generateText: vi.fn(async () => ''),
}));

const { runAdapterLlmFallback } = await import('./llmFallback');
const llmClient = await import('../../llmClient');
const { default: logger } = await import('../../../logger');

describe('runAdapterLlmFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no LLM is configured', async () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(false);

    const result = await runAdapterLlmFallback({
      actionName: 'agent.chat',
      system: 'system',
      user: 'hello',
      debugLabel: '[TEST]',
    });

    expect(result).toBeNull();
    expect(llmClient.generateText).not.toHaveBeenCalled();
  });

  it('returns limited lines when LLM succeeds', async () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);
    vi.mocked(llmClient.generateText).mockResolvedValue('line1\nline2\nline3');

    const result = await runAdapterLlmFallback({
      actionName: 'agent.chat',
      system: 'system',
      user: 'hello',
      lineLimit: 2,
      debugLabel: '[TEST]',
    });

    expect(result).toEqual(['line1', 'line2']);
  });

  it('logs and returns null when the fallback call fails', async () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);
    vi.mocked(llmClient.generateText).mockRejectedValue(new Error('llm fail'));

    const result = await runAdapterLlmFallback({
      actionName: 'agent.chat',
      system: 'system',
      user: 'hello',
      debugLabel: '[TEST]',
    });

    expect(result).toBeNull();
    expect(logger.debug).toHaveBeenCalledWith('%s llm fallback failed: %s', '[TEST]', 'llm fail');
  });
});