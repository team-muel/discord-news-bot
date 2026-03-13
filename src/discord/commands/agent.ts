import type { ChatInputCommandInteraction } from 'discord.js';
import type { AgentSession } from '../../services/multiAgentService';
import {
  cancelAgentSession,
  getAgentPolicy,
  getAgentSession,
  getMultiAgentRuntimeSnapshot,
  listAgentSkills,
  listGuildAgentSessions,
  startAgentSession,
} from '../../services/multiAgentService';
import { getAgentOpsSnapshot, triggerDailyLearningRun, triggerGuildOnboardingSession } from '../../services/agentOpsService';
import { buildAdminCard, buildSimpleEmbed, EMBED_ERROR, EMBED_INFO, EMBED_SUCCESS, EMBED_WARN } from '../ui';

export const formatAgentSessionLine = (session: AgentSession) => {
  const safeGoal = String(session.goal || '').replace(/\s+/g, ' ').slice(0, 48);
  return `${session.id} | ${session.status} | priority=${session.priority} | ${session.updatedAt} | ${safeGoal}`;
};

type AgentDeps = {
  client: { guilds: { cache: unknown } } & Record<string, any>;
  hasAdminPermission: (interaction: ChatInputCommandInteraction) => Promise<boolean>;
  handleGroupedSubscribeCommand: (interaction: ChatInputCommandInteraction) => Promise<void>;
  inferSessionSkill: (text: string) => 'ops-plan' | 'ops-execution' | 'ops-critique' | 'guild-onboarding-blueprint' | 'incident-review' | 'webhook';
  streamSessionProgress: (sink: { update: (content: string) => Promise<unknown> }, sessionId: string, goal: string, options: { showDebugBlocks: boolean; maxLinks: number }) => Promise<void>;
  getRuntimeStatusLines: (guildId: string | null) => Promise<string[]>;
  getErrorMessage: (error: unknown) => string;
  getChain: (sessionId: string) => Array<{ sessionId: string; goalSummary: string; codeBlocks: string[]; threadId?: string; createdAt: string }>;
  listGuildArtifacts: (guildId: string, limit?: number) => Array<{ sessionId: string; goalSummary: string; codeBlocks: string[]; threadId?: string; createdAt: string }>;
};

export const createAgentHandlers = (deps: AgentDeps) => {
  const handleSessionCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!(await deps.hasAdminPermission(interaction))) {
      await interaction.reply({ ...buildAdminCard('권한 오류', 'Admin permission is required.', ['요구 권한: Administrator'], EMBED_ERROR), ephemeral: true });
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({ ...buildAdminCard('사용 위치 오류', '서버 채널에서만 사용할 수 있습니다.', [], EMBED_WARN), ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === '추가') {
      const shared = (interaction.options.getString('공개범위') || 'private') === 'public';
      await interaction.deferReply({ ephemeral: !shared });

      const skill = (interaction.options.getString('스킬') || '').trim();
      const request = (interaction.options.getString('요청') || '').trim();
      const description = (interaction.options.getString('설명') || '').trim();
      const combinedText = [request, description].filter(Boolean).join('\n').trim();
      const selectedSkill = skill || deps.inferSessionSkill(combinedText);
      const baseRequest = request || '현재 길드 기준 자동화 실행안을 제안하고 즉시 적용 순서를 정리해줘.';
      const goal = [
        `세션 스킬 실행: ${selectedSkill}`,
        `요청: ${baseRequest}`,
        description ? `설명: ${description}` : '설명: 없음',
        selectedSkill === 'webhook' ? '요청: 웹훅 자동화 관점으로 실행안을 작성' : '',
      ].filter(Boolean).join('\n');

      let session: AgentSession;
      try {
        session = startAgentSession({ guildId: interaction.guildId, requestedBy: interaction.user.id, goal, skillId: selectedSkill, priority: 'balanced' });
      } catch (error) {
        await interaction.editReply(buildAdminCard('세션 추가 실패', deps.getErrorMessage(error), [`skill=${skill}`], EMBED_ERROR));
        return;
      }

      await interaction.editReply(buildAdminCard('세션 추가 완료', `세션 ${session.id} 실행을 시작했습니다.`, [`skill=${selectedSkill}`, `session=${session.id}`, `requestedBy=${interaction.user.id}`], EMBED_SUCCESS));
      await deps.streamSessionProgress({ update: (content) => interaction.editReply(buildAdminCard('세션 진행 상태', content, [`session=${session.id}`], EMBED_INFO)) }, session.id, session.goal, { showDebugBlocks: session.priority === 'precise' && !shared, maxLinks: 4 });
      return;
    }

    if (sub === '조회') {
      await interaction.deferReply({ ephemeral: true });
      const sessionId = (interaction.options.getString('세션아이디') || '').trim();
      if (sessionId) {
        const session = getAgentSession(sessionId);
        if (!session || session.guildId !== interaction.guildId) {
          await interaction.editReply(buildAdminCard('세션 조회 실패', '해당 세션을 찾을 수 없습니다.', [`session=${sessionId}`], EMBED_WARN));
          return;
        }
        await interaction.editReply(buildAdminCard('세션 조회', `상태: ${session.status}`, [`session=${session.id}`, `priority=${session.priority}`, `goal=${session.goal.slice(0, 240)}`, session.error ? `error=${session.error.slice(0, 180)}` : 'error=none'], EMBED_INFO));
        return;
      }
      const sessions = listGuildAgentSessions(interaction.guildId, 10);
      if (sessions.length === 0) {
        await interaction.editReply(buildAdminCard('세션 조회', '최근 세션이 없습니다.', [`guild=${interaction.guildId}`], EMBED_INFO));
        return;
      }
      await interaction.editReply(buildAdminCard('최근 세션 조회', `총 ${sessions.length}개`, sessions.map((s) => `${s.id} | ${s.status} | ${s.updatedAt}`), EMBED_INFO));
      return;
    }

    if (sub === '구독') {
      await deps.handleGroupedSubscribeCommand(interaction);
      return;
    }

    if (sub === '제거') {
      await interaction.deferReply({ ephemeral: true });
      const sessionId = interaction.options.getString('세션아이디', true).trim();
      const session = getAgentSession(sessionId);
      if (!session || session.guildId !== interaction.guildId) {
        await interaction.editReply(buildAdminCard('세션 제거 실패', '해당 세션을 찾을 수 없습니다.', [`session=${sessionId}`], EMBED_WARN));
        return;
      }
      const result = cancelAgentSession(sessionId);
      await interaction.editReply(buildAdminCard(result.ok ? '세션 제거 요청 수락' : '세션 제거 실패', result.ok ? '중지 요청을 전달했습니다.' : result.message, [`session=${sessionId}`], result.ok ? EMBED_SUCCESS : EMBED_ERROR));
      return;
    }

    await interaction.reply({ ...buildAdminCard('명령 오류', '지원되지 않는 세션 서브명령입니다.', [], EMBED_WARN), ephemeral: true });
  };

  const handleAgentCommand = async (interaction: ChatInputCommandInteraction, forcedSub?: string) => {
    if (!(await deps.hasAdminPermission(interaction))) {
      await interaction.reply({ ...buildAdminCard('권한 오류', 'Admin permission is required.', ['요구 권한: Administrator'], EMBED_ERROR), ephemeral: true });
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({ ...buildAdminCard('사용 위치 오류', '서버 채널에서만 사용할 수 있습니다.', [], EMBED_WARN), ephemeral: true });
      return;
    }

    const sub = forcedSub || interaction.options.getSubcommand();

    if (sub === '실행' || sub === '시작') {
      const shared = (interaction.options.getString('공개범위') || 'private') === 'public';
      await interaction.deferReply({ ephemeral: !shared });
      const goal = interaction.options.getString('목표', true).trim();
      const skillId = (interaction.options.getString('스킬') || '').trim();
      const priority = (interaction.options.getString('우선순위') || 'balanced').trim();
      if (!goal) {
        await interaction.editReply(buildAdminCard('입력 오류', '목표를 입력해주세요.', ['파라미터: 목표'], EMBED_WARN));
        return;
      }

      let session: AgentSession;
      try {
        session = startAgentSession({ guildId: interaction.guildId, requestedBy: interaction.user.id, goal, skillId: skillId || null, priority });
      } catch (error) {
        await interaction.editReply(buildAdminCard('세션 시작 실패', deps.getErrorMessage(error), [`guild=${interaction.guildId}`], EMBED_ERROR));
        return;
      }

      await interaction.editReply(buildAdminCard('요청 수락', ['요청을 수락했습니다.', `세션: ${session.id}`, `목표: ${session.goal}`, `우선순위: ${session.priority}`, '진행 상황을 실시간으로 표시합니다...'].join('\n'), [`session=${session.id}`, `requestedBy=${interaction.user.id}`], EMBED_INFO));
      await deps.streamSessionProgress({ update: (content) => interaction.editReply(buildAdminCard('진행 상태', content, [`session=${session.id}`], EMBED_INFO)) }, session.id, session.goal, { showDebugBlocks: session.priority === 'precise' && !shared, maxLinks: 4 });
      return;
    }

    if (sub === '온보딩') {
      await interaction.deferReply({ ephemeral: true });
      const result = triggerGuildOnboardingSession({ guildId: interaction.guildId, guildName: interaction.guild?.name, requestedBy: interaction.user.id, reason: 'slash-command-onboarding' });
      await interaction.editReply(buildSimpleEmbed(result.ok ? '온보딩 세션 시작' : '온보딩 실행 안됨', result.ok ? `세션: ${result.sessionId}` : result.message, result.ok ? EMBED_SUCCESS : EMBED_WARN));
      return;
    }

    if (sub === '학습') {
      await interaction.deferReply({ ephemeral: true });
      const customGoal = (interaction.options.getString('목표') || '').trim();
      if (customGoal) {
        try {
          const session = startAgentSession({ guildId: interaction.guildId, requestedBy: interaction.user.id, goal: customGoal, skillId: 'incident-review', priority: 'balanced' });
          await interaction.editReply(buildSimpleEmbed('학습 세션 시작', `세션: ${session.id}`, EMBED_SUCCESS));
        } catch (error) {
          await interaction.editReply(buildSimpleEmbed('학습 실행 실패', deps.getErrorMessage(error), EMBED_ERROR));
        }
        return;
      }
      const result = triggerDailyLearningRun(deps.client as any, interaction.guildId);
      await interaction.editReply(buildSimpleEmbed(result.ok ? '학습 실행 결과' : '학습 실행 실패', result.message, result.ok ? EMBED_SUCCESS : EMBED_ERROR));
      return;
    }

    if (sub === '스킬목록') {
      await interaction.deferReply({ ephemeral: true });
      const skills = listAgentSkills();
      await interaction.editReply(buildSimpleEmbed('스킬 목록', `사용 가능한 스킬 ${skills.length}개\n${skills.map((s) => `${s.id} | ${s.title} | ${s.description}`).join('\n')}`, EMBED_INFO));
      return;
    }

    if (sub === '정책') {
      await interaction.deferReply({ ephemeral: true });
      const policy = getAgentPolicy();
      const ops = getAgentOpsSnapshot();
      await interaction.editReply(buildAdminCard('정책 상태', [`동시 세션 한도: ${policy.maxConcurrentSessions}`, `목표 최대 길이: ${policy.maxGoalLength}`, `제한 스킬: ${policy.restrictedSkills.join(', ') || '없음'}`, `자동 온보딩: ${String(ops.autoOnboardingEnabled)}`, `일일 학습 루프: ${String(ops.dailyLearningEnabled)} (hour=${ops.dailyLearningHour})`].join('\n'), [`guild=${interaction.guildId}`], EMBED_INFO));
      return;
    }

    if (sub === '상태') {
      await interaction.deferReply({ ephemeral: true });
      const statusType = (interaction.options.getString('종류') || 'all').trim();
      const sessionId = (interaction.options.getString('세션아이디') || '').trim();
      const includeRuntime = statusType === 'all' || statusType === 'runtime';
      const includeSession = statusType === 'all' || statusType === 'session';

      if (!includeSession) {
        const runtimeLines = await deps.getRuntimeStatusLines(interaction.guildId);
        await interaction.editReply(buildSimpleEmbed('상태', runtimeLines.join('\n'), EMBED_INFO));
        return;
      }

      if (sessionId) {
        const session = getAgentSession(sessionId);
        if (!session || session.guildId !== interaction.guildId) {
          await interaction.editReply(buildSimpleEmbed('조회 실패', '해당 세션을 찾을 수 없습니다.', EMBED_WARN));
          return;
        }

        const steps = session.steps.map((step, index) => `${index + 1}. ${step.role}(${step.status}) - ${step.title}`).join('\n');
        const runtime = getMultiAgentRuntimeSnapshot();
        const runtimeLines = includeRuntime ? await deps.getRuntimeStatusLines(interaction.guildId) : [];

        await interaction.editReply(buildSimpleEmbed('세션 상태', [
          ...runtimeLines,
          '[세션 상태]',
          `세션: ${session.id}`,
          `상태: ${session.status}`,
          `우선순위: ${session.priority}`,
          `생성: ${session.createdAt}`,
          `목표: ${session.goal}`,
          '',
          '[스텝]',
          `스텝:\n${steps}`,
          session.error ? `오류: ${session.error}` : '',
          '',
          '[결과]',
          session.result ? `결과 요약:\n${session.result.slice(0, 1200)}` : '결과: 아직 생성 중입니다.',
          '',
          '[런타임 요약]',
          `런타임: running=${runtime.runningSessions}, completed=${runtime.completedSessions}, failed=${runtime.failedSessions}`,
        ].filter(Boolean).join('\n\n'), EMBED_INFO));
        return;
      }

      const sessions = listGuildAgentSessions(interaction.guildId, 8);
      const runtime = getMultiAgentRuntimeSnapshot();
      const runtimeLines = includeRuntime ? await deps.getRuntimeStatusLines(interaction.guildId) : [];
      if (sessions.length === 0) {
        await interaction.editReply(buildSimpleEmbed('세션 상태', [...runtimeLines, '최근 에이전트 세션이 없습니다.', `런타임: running=${runtime.runningSessions}, completed=${runtime.completedSessions}, failed=${runtime.failedSessions}`].join('\n'), EMBED_INFO));
        return;
      }

      await interaction.editReply(buildSimpleEmbed('세션 상태', [
        ...runtimeLines,
        '[세션 상태: 최근 목록]',
        '최근 세션 목록:',
        sessions.map((session) => formatAgentSessionLine(session)).join('\n'),
        '',
        '[런타임 요약]',
        `런타임: running=${runtime.runningSessions}, completed=${runtime.completedSessions}, failed=${runtime.failedSessions}`,
        '상세 조회: /상태 세션아이디:<ID>',
      ].join('\n'), EMBED_INFO));
      return;
    }

    if (sub === '중지') {
      await interaction.deferReply({ ephemeral: true });
      const sessionId = interaction.options.getString('세션아이디', true).trim();
      const session = getAgentSession(sessionId);
      if (!session || session.guildId !== interaction.guildId) {
        await interaction.editReply(buildSimpleEmbed('중지 실패', '해당 세션을 찾을 수 없습니다.', EMBED_WARN));
        return;
      }
      const result = cancelAgentSession(sessionId);
      await interaction.editReply(buildSimpleEmbed(result.ok ? '중지 요청 수락' : '중지 실패', result.ok ? `세션: ${sessionId}` : result.message, result.ok ? EMBED_SUCCESS : EMBED_ERROR));
      return;
    }

    if (sub === '이력') {
      if (!interaction.guildId) {
        await interaction.reply({ content: '서버 채널에서만 사용할 수 있습니다.', ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const sessionId = (interaction.options.getString('세션아이디') || '').trim();
      if (sessionId) {
        const chain = deps.getChain(sessionId);
        if (chain.length === 0) {
          await interaction.editReply(buildSimpleEmbed('이력 조회', '해당 세션의 아티팩트 이력이 없습니다.', EMBED_WARN));
          return;
        }
        const chainLines = chain.map((e, i) => `${i === 0 ? '🌱 원본' : `↳ v${i + 1}`} [${e.sessionId.slice(0, 8)}] ${e.goalSummary} | 파일 ${e.codeBlocks.length}개${e.threadId ? ' 🧵 스레드 있음' : ''} | ${e.createdAt.slice(0, 10)}`);
        await interaction.editReply(buildSimpleEmbed(`코드 이력 체인 (${chain.length}개)`, chainLines.join('\n'), EMBED_INFO));
        return;
      }
      const recent = deps.listGuildArtifacts(interaction.guildId, 10);
      if (recent.length === 0) {
        await interaction.editReply(buildSimpleEmbed('이력 조회', '이 서버의 코드 아티팩트 이력이 없습니다.\n코드 요청 후 스레드가 생성되면 여기에 기록됩니다.', EMBED_INFO));
        return;
      }
      const recentLines = recent.map((e) => `[${e.sessionId.slice(0, 8)}] ${e.goalSummary} | 파일 ${e.codeBlocks.length}개${e.threadId ? ' 🧵' : ''} | ${e.createdAt.slice(0, 10)}`);
      await interaction.editReply(buildSimpleEmbed(`최근 코드 아티팩트 (${recent.length}개)`, `${recentLines.join('\n')}\n\n세션아이디를 지정하면 수정 체인 전체를 볼 수 있습니다.`, EMBED_INFO));
      return;
    }

    await interaction.reply({ ...buildSimpleEmbed('명령 오류', '지원되지 않는 명령입니다.', EMBED_WARN), ephemeral: true });
  };

  return { handleSessionCommand, handleAgentCommand };
};
