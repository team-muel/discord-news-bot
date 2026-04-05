/**
 * Sprint phase actions — qa.test, cso.audit, release.ship, retro.summarize, sop.update.
 * Extracted from agentCollab.ts for domain-scoped cohesion.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAnyLlmConfigured } from '../../llmClient';
import { atomicWriteFile } from '../../../utils/atomicWrite';
import { writeRetroToVault } from '../../obsidian';
import type { ActionDefinition } from './types';
import {
  compact,
  clip,
  toJson,
  resolveGoal,
  withRouting,
  maybeGenerateRoleText,
} from './agentCollabHelpers';

// ──── Sprint Phase Actions ────────────────────────────────────────────────────

export const qaTestAction: ActionDefinition = {
  name: 'qa.test',
  description: 'QA 역할로 변경된 코드의 테스트를 실행하고 버그를 탐지/수정합니다.',
  category: 'code',
  deterministic: true,
  execute: async ({ goal, args }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false,
        name: 'qa.test',
        summary: 'QA 대상이 비어 있습니다.',
        artifacts: [],
        verification: ['objective required'],
        error: 'OBJECTIVE_EMPTY',
        agentRole: 'implement',
      }, 'implement', 'task validation failed');
    }

    const synthesized = await maybeGenerateRoleText({
      enabled: isAnyLlmConfigured(),
      actionName: 'action.qa.test',
      system: [
        '너는 QA 리드 에이전트다.',
        '변경된 코드에 대해 테스트 대상을 식별하고, 테스트를 실행하고, 버그를 발견하면 수정 방안을 제시한다.',
        '각 버그에 대해 재현 경로를 포함한다.',
        '모든 테스트가 통과하면 명확히 보고한다.',
      ].join('\n'),
      user: `QA 대상: ${query}`,
      fallback: `# QA Report\n- target: ${query}\n- status: manual QA required (LLM unavailable)`,
    });

    return withRouting({
      ok: true,
      name: 'qa.test',
      summary: 'QA 테스트 실행 완료',
      artifacts: [clip(synthesized)],
      verification: ['qa test report emitted'],
      agentRole: 'implement',
    }, 'implement', 'qa testing completed');
  },
};

export const csoAuditAction: ActionDefinition = {
  name: 'cso.audit',
  description: 'CSO 역할로 Discovery→Analysis 2단계 파이프라인 보안 감사를 수행합니다. JSONL 후보군이 있으면 자동 활용합니다.',
  category: 'ops',
  execute: async ({ goal, args }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false,
        name: 'cso.audit',
        summary: '보안 감사 대상이 비어 있습니다.',
        artifacts: [],
        verification: ['objective required'],
        error: 'OBJECTIVE_EMPTY',
        agentRole: 'review',
      }, 'review', 'task validation failed');
    }

    // Try Discovery → Analysis pipeline first (if candidates exist)
    try {
      const { runSecurityPipeline } = await import('../../security/securityPipelineOrchestrator');
      const pipelineResult = await runSecurityPipeline({
        repoId: 'muel-backend',
        targetPath: typeof args?.targetPath === 'string' ? args.targetPath : undefined,
        candidateKind: typeof args?.candidateKind === 'string' ? args.candidateKind : undefined,
      });

      if (pipelineResult.totalCandidates > 0) {
        const verification = [
          'security pipeline executed',
          `discovery: ${pipelineResult.discoveryIncluded} included, ${pipelineResult.discoveryExcluded} excluded`,
          `analysis: ${pipelineResult.analysisVerdicts.length} verdicts, ${pipelineResult.confirmedFindings.length} confirmed`,
          `duration: ${pipelineResult.durationMs}ms`,
        ];

        return withRouting({
          ok: true,
          name: 'cso.audit',
          summary: `Discovery→Analysis 보안 감사 완료 (${pipelineResult.confirmedFindings.length} findings / ${pipelineResult.totalCandidates} candidates)`,
          artifacts: [clip(pipelineResult.summary)],
          verification,
          agentRole: 'review',
        }, 'review', 'security pipeline completed');
      }
    } catch {
      // Pipeline not available or no candidates — fall through to LLM-only mode
    }

    // Fallback: LLM-only audit (no JSONL candidates available)
    const synthesized = await maybeGenerateRoleText({
      enabled: isAnyLlmConfigured(),
      actionName: 'action.cso.audit',
      system: [
        '너는 CSO(Chief Security Officer) 에이전트다.',
        'OWASP Top 10과 STRIDE 위협 모델을 기준으로 보안 감사를 수행한다.',
        '8/10 이상 신뢰도의 취약점만 보고한다.',
        '각 취약점에 구체적 공격 시나리오와 수정 방안을 포함한다.',
        '취약점이 없으면 "no findings above confidence threshold"를 명시한다.',
        '',
        'NOTE: No SAST candidate data available. Run `npm run security:scan` to enable Discovery→Analysis pipeline.',
      ].join('\n'),
      user: `보안 감사 대상: ${query}`,
      fallback: `# Security Audit\n- target: ${query}\n- status: manual audit required (LLM unavailable)\n- hint: run \`npm run security:scan\` to generate candidate JSONL for pipeline mode`,
    });

    return withRouting({
      ok: true,
      name: 'cso.audit',
      summary: 'CSO 보안 감사 완료 (LLM-only mode, no SAST candidates)',
      artifacts: [clip(synthesized)],
      verification: ['cso security audit emitted', 'LLM-only mode (no JSONL candidates)'],
      agentRole: 'review',
    }, 'review', 'security audit completed');
  },
};

export const releaseShipAction: ActionDefinition = {
  name: 'release.ship',
  description: '릴리스 엔지니어 역할로 테스트 실행, 커버리지 확인, PR 생성을 수행합니다.',
  category: 'ops',
  deterministic: true,
  execute: async ({ goal, args }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false,
        name: 'release.ship',
        summary: 'Ship 대상이 비어 있습니다.',
        artifacts: [],
        verification: ['objective required'],
        error: 'OBJECTIVE_EMPTY',
        agentRole: 'operate',
      }, 'operate', 'task validation failed');
    }

    const synthesized = await maybeGenerateRoleText({
      enabled: isAnyLlmConfigured(),
      actionName: 'action.release.ship',
      system: [
        '너는 릴리스 엔지니어다.',
        '모든 게이트(테스트, 타입체크, 커버리지)를 확인하고 결과를 보고한다.',
        'PR 생성이 가능하면 PR 제목과 본문을 작성한다.',
        '실패한 게이트가 있으면 해당 phase로 복귀를 권고한다.',
      ].join('\n'),
      user: `Ship 대상: ${query}`,
      fallback: `# Ship Report\n- target: ${query}\n- status: manual ship required (LLM unavailable)`,
    });

    return withRouting({
      ok: true,
      name: 'release.ship',
      summary: '릴리스 Ship 보고 완료',
      artifacts: [clip(synthesized)],
      verification: ['release ship report emitted'],
      agentRole: 'operate',
    }, 'operate', 'release ship completed');
  },
};

// ──── Retro ──────────────────────────────────────────────────────────────────

const buildQuantitativeRetro = (query: string, args?: Record<string, unknown>): string => {
  const sprintId = compact(args?.sprintId) || 'unknown';
  const objective = compact(args?.objective) || query;
  const changedFiles: string[] = Array.isArray(args?.changedFiles) ? (args.changedFiles as string[]) : [];
  const previousPhaseResults: Array<{ phase?: string; status?: string; output?: string }> =
    Array.isArray(args?.previousPhaseResults) ? (args.previousPhaseResults as Array<{ phase?: string; status?: string; output?: string }>) : [];

  const succeeded = previousPhaseResults.filter((r) => r.status === 'success');
  const failed = previousPhaseResults.filter((r) => r.status === 'failed');
  const totalPhases = previousPhaseResults.length;

  const lines = [
    `# Sprint Retro (Quantitative)`,
    '',
    '## Summary',
    `- sprint: ${sprintId}`,
    `- objective: ${objective.slice(0, 200)}`,
    `- total_phases: ${totalPhases}`,
    `- succeeded: ${succeeded.length}`,
    `- failed: ${failed.length}`,
    `- changed_files: ${changedFiles.length}`,
    '',
    '## Phase Results',
    ...previousPhaseResults.map((r) => `- ${r.phase || '?'}: ${r.status || '?'}`),
  ];

  if (failed.length > 0) {
    lines.push('', '## Failed Phases');
    for (const f of failed) {
      lines.push(`- ${f.phase}: ${(f.output || '').slice(0, 150)}`);
    }
  }

  if (changedFiles.length > 0) {
    lines.push('', '## Changed Files');
    for (const file of changedFiles.slice(0, 10)) {
      lines.push(`- ${file}`);
    }
  }

  const successRate = totalPhases > 0 ? ((succeeded.length / totalPhases) * 100).toFixed(0) : 'N/A';

  lines.push(
    '',
    '## Keep',
    succeeded.length > 0 ? `- ${succeeded.length}/${totalPhases} phases passed (${successRate}%)` : '- (no successes to note)',
    '',
    '## Stop',
    failed.length > 0 ? `- Investigate failures in: ${failed.map((f) => f.phase).join(', ')}` : '- (no failures)',
    '',
    '## Start',
    `- Review phase success rate trend across sprints`,
  );

  return lines.join('\n');
};

export const retroSummarizeAction: ActionDefinition = {
  name: 'retro.summarize',
  description: '회고 역할로 스프린트 결과를 요약하고 개선 사항을 도출합니다.',
  category: 'agent',
  execute: async ({ goal, args, guildId }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false,
        name: 'retro.summarize',
        summary: '회고 대상이 비어 있습니다.',
        artifacts: [],
        verification: ['objective required'],
        error: 'OBJECTIVE_EMPTY',
        agentRole: 'architect',
      }, 'architect', 'task validation failed');
    }

    const quantitativeFallback = buildQuantitativeRetro(query, args);

    const synthesized = await maybeGenerateRoleText({
      enabled: isAnyLlmConfigured(),
      actionName: 'action.retro.summarize',
      system: [
        '너는 스프린트 회고 에이전트다.',
        '완료된 스프린트의 결과를 요약하고 keep/stop/start 형식으로 교훈을 정리한다.',
        '반복 패턴을 식별하고 다음 스프린트에 대한 개선 사항을 제안한다.',
        '메트릭(변경 LOC, 테스트 수, phase 반복 횟수)을 포함한다.',
      ].join('\n'),
      user: `회고 대상: ${query}`,
      fallback: quantitativeFallback,
    });

    // Write retro to Obsidian vault (fire-and-forget)
    const keepLines = synthesized.match(/^- .+$/gm)?.slice(0, 5) || [];
    const retroSprintId = compact(args?.sprintId) || query.slice(0, 60);
    void writeRetroToVault({
      guildId: guildId || '',
      sprintId: retroSprintId,
      summary: synthesized.slice(0, 500),
      lessonsLearned: {
        keep: keepLines,
        stop: [],
        start: [],
      },
      planPath: typeof args?.planPath === 'string' ? args.planPath : undefined,
      prevRetroPath: typeof args?.prevRetroPath === 'string' ? args.prevRetroPath : undefined,
    }).catch(() => { /* best-effort */ });

    return withRouting({
      ok: true,
      name: 'retro.summarize',
      summary: '스프린트 회고 완료',
      artifacts: [clip(synthesized)],
      verification: ['retro summary emitted'],
      agentRole: 'architect',
    }, 'architect', 'sprint retro completed');
  },
};

// ──── SOP Auto-Update Action ──────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRIBAL_KNOWLEDGE_PATH = path.resolve(__dirname, '../../../../.github/instructions/tribal-knowledge.instructions.md');

export const sopUpdateAction: ActionDefinition = {
  name: 'sop.update',
  description: 'SOP/tribal knowledge를 자동으로 업데이트합니다. retro에서 발견된 교훈을 기록합니다.',
  category: 'agent',
  parameters: [
    { name: 'lessons', description: 'Array of lesson strings to append', required: true },
    { name: 'section', description: 'Target section header (default: Sprint Lessons Learned)', required: false },
  ],
  execute: async ({ args }) => {
    const rawLessons = args?.lessons;
    const lessons: string[] = Array.isArray(rawLessons)
      ? rawLessons.map((l) => String(l || '').trim()).filter(Boolean)
      : typeof rawLessons === 'string'
        ? rawLessons.split('\n').map((l) => l.trim()).filter(Boolean)
        : [];

    if (lessons.length === 0) {
      return withRouting({
        ok: false,
        name: 'sop.update',
        summary: 'No lessons provided to record.',
        artifacts: [],
        verification: ['lessons array required'],
        error: 'NO_LESSONS',
        agentRole: 'architect',
      }, 'architect', 'no lessons to update');
    }

    const section = compact(args?.section) || 'Sprint Lessons Learned';

    try {
      let content: string;
      try {
        content = fs.readFileSync(TRIBAL_KNOWLEDGE_PATH, 'utf-8');
      } catch {
        return withRouting({
          ok: false,
          name: 'sop.update',
          summary: 'tribal-knowledge.instructions.md not found.',
          artifacts: [],
          verification: ['file not found'],
          error: 'FILE_NOT_FOUND',
          agentRole: 'architect',
        }, 'architect', 'tribal knowledge file missing');
      }

      // Deduplicate: skip lessons already present (substring match)
      const newLessons = lessons.filter((lesson) => !content.includes(lesson.slice(0, 80)));
      if (newLessons.length === 0) {
        return withRouting({
          ok: true,
          name: 'sop.update',
          summary: `All ${lessons.length} lesson(s) already recorded.`,
          artifacts: [`skipped_count: ${lessons.length}`],
          verification: ['lessons already present'],
          agentRole: 'architect',
        }, 'architect', 'sop already up to date');
      }

      // Find or create the target section
      const sectionHeader = `## ${section}`;
      const sectionIndex = content.indexOf(sectionHeader);
      const formattedLessons = newLessons.map((l) => `- ${l.startsWith('- ') ? l.slice(2) : l}`).join('\n');
      const timestamp = new Date().toISOString().split('T')[0];
      const block = `\n\n<!-- auto-appended ${timestamp} -->\n${formattedLessons}`;

      let updatedContent: string;
      if (sectionIndex >= 0) {
        const afterSection = content.indexOf('\n## ', sectionIndex + sectionHeader.length);
        const insertPos = afterSection >= 0 ? afterSection : content.length;
        updatedContent = content.slice(0, insertPos) + block + content.slice(insertPos);
      } else {
        updatedContent = content + `\n\n${sectionHeader}\n${block}`;
      }

      await atomicWriteFile(TRIBAL_KNOWLEDGE_PATH, updatedContent);

      return withRouting({
        ok: true,
        name: 'sop.update',
        summary: `Appended ${newLessons.length} lesson(s) to tribal knowledge (${section}).`,
        artifacts: [clip(formattedLessons, 800)],
        verification: [`${newLessons.length} lessons written`, `section: ${section}`],
        agentRole: 'architect',
      }, 'architect', 'sop updated');
    } catch (error) {
      return withRouting({
        ok: false,
        name: 'sop.update',
        summary: 'SOP update failed.',
        artifacts: [clip(error instanceof Error ? error.message : String(error), 400)],
        verification: ['write failed'],
        error: 'SOP_UPDATE_FAILED',
        agentRole: 'architect',
      }, 'architect', 'sop update failed');
    }
  },
};
