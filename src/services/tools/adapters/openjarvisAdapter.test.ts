import { describe, it, expect } from 'vitest';
import {
  buildJarvisAgentMessagePayload,
  buildJarvisAskCliArgs,
  buildJarvisManagedAgentCreatePayload,
  buildJarvisManagedAgentMessagePayload,
  buildJarvisManagedAgentTasksPath,
  buildJarvisManagedAgentTracePath,
  buildJarvisManagedAgentTracesPath,
  buildJarvisServeChatPayload,
  buildOptimizeCliArgs,
  openjarvisAdapter,
  parseBenchResult,
} from './openjarvisAdapter';

describe('openjarvisAdapter lite capabilities', () => {
  it('exposes a safe operator-focused lite subset', () => {
    expect(openjarvisAdapter.liteCapabilities).toEqual(expect.arrayContaining([
      'jarvis.ask',
      'jarvis.server.info',
      'jarvis.models.list',
      'jarvis.tools.list',
      'jarvis.agents.health',
      'jarvis.recommended-model',
      'jarvis.agent.list',
      'jarvis.memory.search',
      'jarvis.telemetry',
      'jarvis.scheduler.list',
      'jarvis.skill.search',
    ]));
  });

  it('advertises managed agent control in full capabilities', () => {
    expect(openjarvisAdapter.capabilities).toEqual(expect.arrayContaining([
      'jarvis.agents.health',
      'jarvis.recommended-model',
      'jarvis.agent.get',
      'jarvis.agent.create',
      'jarvis.agent.delete',
      'jarvis.agent.pause',
      'jarvis.agent.resume',
      'jarvis.agent.run',
      'jarvis.agent.recover',
      'jarvis.agent.message',
      'jarvis.agent.state',
      'jarvis.agent.messages.list',
      'jarvis.agent.tasks.list',
      'jarvis.agent.traces.list',
      'jarvis.agent.trace.get',
    ]));
  });
});

describe('buildOptimizeCliArgs', () => {
  it('builds config-driven optimize args with local engines', () => {
    expect(buildOptimizeCliArgs({
      config: 'config/runtime/openjarvis-local-first-optimize.toml',
      optimizerModel: 'qwen2.5:7b-instruct',
      optimizerEngine: 'ollama',
      judgeModel: 'qwen2.5:7b-instruct',
      judgeEngine: 'ollama',
      trials: 1,
      maxSamples: 1,
    })).toEqual([
      'optimize',
      'run',
      '--config',
      'config/runtime/openjarvis-local-first-optimize.toml',
      '--trials',
      '1',
      '--max-samples',
      '1',
      '--optimizer-model',
      'qwen2.5:7b-instruct',
      '--optimizer-engine',
      'ollama',
      '--judge-model',
      'qwen2.5:7b-instruct',
      '--judge-engine',
      'ollama',
    ]);
  });

  it('builds benchmark-driven optimize args without optional fields', () => {
    expect(buildOptimizeCliArgs({ benchmark: 'supergpqa' })).toEqual([
      'optimize',
      'run',
      '--benchmark',
      'supergpqa',
    ]);
  });
});

describe('buildJarvisAskCliArgs', () => {
  it('builds documented agent/tools/no-context CLI args', () => {
    expect(buildJarvisAskCliArgs({
      question: 'Find coverage gaps',
      engine: 'ollama',
      model: 'qwen3:8b',
      temperature: 0.2,
      maxTokens: 512,
      agent: 'orchestrator',
      tools: ['calculator', 'think'],
      noContext: true,
    })).toEqual([
      'ask',
      '--no-stream',
      '--engine',
      'ollama',
      '--model',
      'qwen3:8b',
      '--temperature',
      '0.2',
      '--max-tokens',
      '512',
      '--agent',
      'orchestrator',
      '--tools',
      'calculator,think',
      '--no-context',
      'Find coverage gaps',
    ]);
  });
});

describe('buildJarvisServeChatPayload', () => {
  it('builds direct serve payload with system prompt and tool definitions', () => {
    expect(buildJarvisServeChatPayload({
      question: 'What is 2+2?',
      model: 'qwen3:8b',
      systemPrompt: 'Be concise.',
      temperature: 0.1,
      maxTokens: 256,
      tools: [{ type: 'function', function: { name: 'calculator' } }],
      toolChoice: 'auto',
    })).toEqual({
      model: 'qwen3:8b',
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'What is 2+2?' },
      ],
      temperature: 0.1,
      max_tokens: 256,
      tools: [{ type: 'function', function: { name: 'calculator' } }],
      tool_choice: 'auto',
    });
  });

  it('preserves explicit messages and does not inject an agent field', () => {
    const payload = buildJarvisServeChatPayload({
      model: 'qwen3:8b',
      agent: 'orchestrator',
      messages: [
        { role: 'system', content: 'Guardrails' },
        { role: 'user', content: 'Hello' },
      ],
    });

    expect(payload).toEqual({
      model: 'qwen3:8b',
      messages: [
        { role: 'system', content: 'Guardrails' },
        { role: 'user', content: 'Hello' },
      ],
    });
    expect(payload).not.toHaveProperty('agent');
  });
});

describe('buildJarvisAgentMessagePayload', () => {
  it('uses the upstream message key for agent endpoints', () => {
    expect(buildJarvisAgentMessagePayload('hello')).toEqual({ message: 'hello' });
  });
});

describe('buildJarvisManagedAgentCreatePayload', () => {
  it('builds the managed agent create payload with config and template', () => {
    expect(buildJarvisManagedAgentCreatePayload({
      name: 'researcher',
      agentType: 'monitor_operative',
      templateId: 'deep-research',
      config: { schedule_type: 'manual' },
    })).toEqual({
      name: 'researcher',
      agent_type: 'monitor_operative',
      template_id: 'deep-research',
      config: { schedule_type: 'manual' },
    });
  });
});

describe('buildJarvisManagedAgentMessagePayload', () => {
  it('builds a non-streaming immediate message payload', () => {
    expect(buildJarvisManagedAgentMessagePayload({
      content: 'run the task',
      mode: 'queued',
    })).toEqual({
      content: 'run the task',
      mode: 'queued',
      stream: false,
    });
  });
});

describe('managed agent path builders', () => {
  it('builds the tasks path with an optional status filter', () => {
    expect(buildJarvisManagedAgentTasksPath({
      agentId: 'agent-1',
      status: 'Active',
    })).toBe('/v1/managed-agents/agent-1/tasks?status=active');
  });

  it('builds the traces path with a clamped limit', () => {
    expect(buildJarvisManagedAgentTracesPath({
      agentId: 'agent-1',
      limit: 200,
    })).toBe('/v1/managed-agents/agent-1/traces?limit=50');
  });

  it('builds the trace detail path from agent and trace ids', () => {
    expect(buildJarvisManagedAgentTracePath({
      agentId: 'agent/1',
      traceId: 'trace/9',
    })).toBe('/v1/managed-agents/agent%2F1/traces/trace%2F9');
  });
});

describe('parseBenchResult', () => {
  it('parses valid JSON bench output', () => {
    const result = parseBenchResult([
      '{"score": 0.85, "latency_ms": 120, "throughput": 42.5}',
    ]);
    expect(result.benchScore).toBe(0.85);
    expect(result.latencyMs).toBe(120);
    expect(result.throughput).toBe(42.5);
    expect(result.raw.length).toBe(1);
  });

  it('returns null scores on empty output', () => {
    const result = parseBenchResult([]);
    expect(result.benchScore).toBeNull();
    expect(result.latencyMs).toBeNull();
    expect(result.throughput).toBeNull();
  });

  it('returns null scores on whitespace-only output', () => {
    const result = parseBenchResult(['', '  ']);
    expect(result.benchScore).toBeNull();
  });

  it('extracts score from non-JSON "score: 0.75" format', () => {
    const result = parseBenchResult(['Benchmark complete', 'score: 0.75', 'done']);
    expect(result.benchScore).toBe(0.75);
    expect(result.latencyMs).toBeNull();
  });

  it('handles score with colon-space format', () => {
    const result = parseBenchResult(['SCORE: 92']);
    expect(result.benchScore).toBe(92);
  });

  it('handles malformed JSON gracefully (falls back to regex)', () => {
    const result = parseBenchResult(['{invalid json, score: 0.6']);
    expect(result.benchScore).toBe(0.6);
  });

  it('handles JSON with missing optional fields', () => {
    const result = parseBenchResult(['{"score": 0.9}']);
    expect(result.benchScore).toBe(0.9);
    expect(result.latencyMs).toBeNull();
    expect(result.throughput).toBeNull();
  });

  it('rejects NaN/Infinity scores from JSON', () => {
    const result = parseBenchResult(['{"score": "not-a-number"}']);
    expect(result.benchScore).toBeNull();
  });

  it('handles multi-line JSON output', () => {
    const result = parseBenchResult([
      '{',
      '  "score": 0.88,',
      '  "latency_ms": 200',
      '}',
    ]);
    expect(result.benchScore).toBe(0.88);
    expect(result.latencyMs).toBe(200);
  });

  it('limits raw to 20 lines', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const result = parseBenchResult(lines);
    expect(result.raw.length).toBe(20);
  });

  it('parses benchmark-array JSON wrapped by CLI banner output', () => {
    const result = parseBenchResult([
      'OpenJarvis benchmark banner',
      '{',
      '  "benchmark_count": 1,',
      '  "benchmarks": [',
      '    {',
      '      "name": "latency",',
      '      "metrics": {',
      '        "mean_latency": 3.32,',
      '        "p95_latency": 4.56',
      '      }',
      '    }',
      '  ]',
      '}',
    ]);
    expect(result.benchScore).toBeNull();
    expect(result.latencyMs).toBe(4.56);
  });
});
