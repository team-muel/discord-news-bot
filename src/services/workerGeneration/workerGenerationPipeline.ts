import logger from '../../logger';
import { generateText } from '../llmClient';
import { createApproval, updateApprovalCode, type PendingWorkerApproval } from './workerApprovalStore';
import { cleanupSandbox, validateSandboxCode, writeSandboxFile } from './workerSandbox';

const compact = (v: unknown): string => String(v || '').replace(/\s+/g, ' ').trim();

// ─── Action name derivation ───────────────────────────────────────────────────

export const deriveActionName = (goal: string): string => {
  const base = compact(goal)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join('.');
  return `dynamic.${base || 'worker'}`.slice(0, 60);
};

// ─── Code extraction ──────────────────────────────────────────────────────────

export const extractWorkerCodeBlock = (raw: string): string => {
  const match = raw.match(/```(?:javascript|js|mjs)?\s*([\s\S]+?)```/);
  return match ? match[1].trim() : raw.trim();
};

// ─── Generation prompt ────────────────────────────────────────────────────────

const buildPrompt = (goal: string, actionName: string): { system: string; user: string } => ({
  system: [
    '너는 Discord 봇 자동화 플랫폼의 코드 생성 에이전트다.',
    '사용자의 자동화 요청을 처리할 수 있는 Node.js ESM 워커(.mjs)를 작성한다.',
    '',
    '출력 규칙 (엄수):',
    '- 출력은 반드시 ```javascript 코드블록 하나만이어야 한다.',
    '- export const action = { name, description, execute } 단일 객체를 export한다.',
    `- name: '${actionName}' 로 고정.`,
    '- execute: async ({ goal, args, guildId }) => ({ ok, name, summary, artifacts, verification }) 시그니처.',
    '- ok: boolean, summary: string(2문장 이내), artifacts: string[], verification: string[].',
    '- 외부 IO는 fetch()만 허용. eval/new Function/process.exit/fs.writeFile 사용 금지.',
    '- 에러 발생 시 throw 금지, ok: false + error: string 반환.',
    '- 한국어 주석 허용.',
  ].join('\n'),
  user: [
    `자동화 요청: "${goal}"`,
    '',
    `이 요청을 처리할 수 있는 Node.js ESM 워커를 작성해줘.`,
    `액션 이름: ${actionName}`,
    '외부 API 호출이 필요하면 fetch()를 사용하고, API 키는 args 파라미터 또는 process.env에서 가져오도록 설계해.',
    '반드시 ```javascript 코드블록 형태로만 출력해.',
  ].join('\n'),
});

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export type PipelineResult =
  | { ok: true; approval: PendingWorkerApproval }
  | { ok: false; error: string };

export const runWorkerGenerationPipeline = async (params: {
  goal: string;
  guildId: string;
  requestedBy: string;
}): Promise<PipelineResult> => {
  const actionName = deriveActionName(params.goal);
  logger.info('[WORKER-GEN] pipeline start goal=%.80s actionName=%s', params.goal, actionName);

  // 1. Generate worker code via LLM
  let rawCode: string;
  try {
    const prompt = buildPrompt(params.goal, actionName);
    rawCode = await generateText({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.1,
      maxTokens: 1800,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[WORKER-GEN] LLM generation failed: %s', msg);
    return { ok: false, error: `코드 생성 실패: ${msg}` };
  }

  const code = extractWorkerCodeBlock(rawCode);

  // 2. Static validation (security + structure)
  const validation = validateSandboxCode(code);
  logger.info('[WORKER-GEN] validation ok=%s errors=%o', validation.ok, validation.errors);

  // 3. Write to sandbox
  let sandbox: { sandboxDir: string; filePath: string };
  try {
    sandbox = await writeSandboxFile(code);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[WORKER-GEN] sandbox write failed: %s', msg);
    return { ok: false, error: `샌드박스 저장 실패: ${msg}` };
  }

  // 4. Clean up sandbox immediately if validation failed (don't persist bad code)
  if (!validation.ok) {
    await cleanupSandbox(sandbox.sandboxDir);
  }

  // 5. Create approval record
  const approval = createApproval({
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    goal: params.goal,
    actionName,
    generatedCode: code,
    sandboxDir: validation.ok ? sandbox.sandboxDir : '',
    sandboxFilePath: validation.ok ? sandbox.filePath : '',
    validationPassed: validation.ok,
    validationErrors: validation.errors,
    validationWarnings: validation.warnings,
  });

  return { ok: true, approval };
};

/** Re-run pipeline for an existing approval (refactoring flow). */
export const rerunWorkerPipeline = async (params: {
  approvalId: string;
  goal: string;
  guildId: string;
  requestedBy: string;
  refactorHint?: string;
}): Promise<PipelineResult> => {
  const goalWithHint = params.refactorHint
    ? `${params.goal}\n\n리팩토링 가이드: ${params.refactorHint}`
    : params.goal;

  const result = await runWorkerGenerationPipeline({
    goal: goalWithHint,
    guildId: params.guildId,
    requestedBy: params.requestedBy,
  });

  if (result.ok) {
    // Update the existing approval record with new code
    updateApprovalCode(
      params.approvalId,
      result.approval.generatedCode,
      result.approval.sandboxDir,
      result.approval.sandboxFilePath,
    );
  }

  return result;
};
