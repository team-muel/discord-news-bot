import { describe, expect, it } from 'vitest';

import {
  buildKnowledgePathIndex,
  describeKnowledgePath,
  isTrackedPath,
  normalizePath,
  resolveKnowledgeArtifactPath,
} from './obsidianPathUtils';

describe('obsidianPathUtils', () => {
  it('normalizes separators and generated artifact aliases', () => {
    expect(normalizePath('\\ops\\control-tower\\BLUEPRINT.md')).toBe('ops/control-tower/BLUEPRINT.md');
    expect(resolveKnowledgeArtifactPath('blueprint')).toBe('ops/control-tower/BLUEPRINT.md');
    expect(resolveKnowledgeArtifactPath('topic:Shared MCP')).toBe('ops/knowledge-control/topics/shared-mcp.md');
    expect(resolveKnowledgeArtifactPath('entity:chat/thread-1')).toBe('ops/knowledge-control/entities/chat-thread-1.md');
    expect(resolveKnowledgeArtifactPath('../outside')).toBeNull();
  });

  it('classifies control, runtime, and guild paths consistently', () => {
    expect(describeKnowledgePath('ops/quality/RUBRIC.md')).toEqual({
      plane: 'control',
      concern: 'quality-control',
    });
    expect(describeKnowledgePath('ops/services/unified-mcp/PROFILE.md')).toEqual({
      plane: 'runtime',
      concern: 'service-memory',
    });
    expect(describeKnowledgePath('guilds/123/customer/PROFILE.md')).toEqual({
      plane: 'record',
      concern: 'customer-operating-memory',
    });
    expect(describeKnowledgePath('guilds/123/sprint-journal/20260418_demo.md')).toEqual({
      plane: 'learning',
      concern: 'recursive-improvement',
    });
  });

  it('dedupes indexed paths after normalization', () => {
    const index = buildKnowledgePathIndex([
      { path: '\\ops\\control-tower\\BLUEPRINT.md', generated: false },
      { path: '/ops/control-tower/BLUEPRINT.md', generated: true },
      { path: 'ops/knowledge-control/INDEX.md', generated: true },
    ]);

    expect(index).toEqual([
      {
        path: 'ops/control-tower/BLUEPRINT.md',
        generated: false,
        plane: 'control',
        concern: 'control-tower',
      },
      {
        path: 'ops/knowledge-control/INDEX.md',
        generated: true,
        plane: 'record',
        concern: 'knowledge-control',
      },
    ]);
  });

  it('recognizes tracked knowledge roots', () => {
    expect(isTrackedPath('ops/playbooks/unified-mcp-recovery.md', '')).toBe(true);
    expect(isTrackedPath('guilds/123456789/retros/2026-04-18.md', '123456789')).toBe(true);
    expect(isTrackedPath('tmp/scratch.md', '123456789')).toBe(false);
  });
});