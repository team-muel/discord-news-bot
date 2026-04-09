/**
 * Slash command definitions.
 * Reads feature-flag env vars at module load time and returns the filtered command list.
 * No service imports.
 */
import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import {
  DISCORD_SIMPLE_COMMANDS_ENABLED as CFG_SIMPLE_COMMANDS_ENABLED,
  CODE_THREAD_ENABLED as CFG_CODE_THREAD_ENABLED,
  WORKER_APPROVAL_CHANNEL_ID as CFG_WORKER_APPROVAL_CHANNEL_ID,
  DISCORD_CLEAR_GUILD_COMMANDS_ON_GLOBAL_SYNC as CFG_CLEAR_GUILD_COMMANDS,
} from '../config';
import {
  AUTOMATION_INTENT_PATTERN as RUNTIME_AUTOMATION_INTENT_PATTERN,
  CODING_INTENT_PATTERN as RUNTIME_CODING_INTENT_PATTERN,
  SIMPLE_COMMAND_ALLOWLIST,
} from './runtimePolicy';

export const SIMPLE_COMMANDS_ENABLED = CFG_SIMPLE_COMMANDS_ENABLED;
export { SIMPLE_COMMAND_ALLOWLIST };
export const CODE_THREAD_ENABLED = CFG_CODE_THREAD_ENABLED;
export const CODING_INTENT_PATTERN = RUNTIME_CODING_INTENT_PATTERN;
export const AUTOMATION_INTENT_PATTERN = RUNTIME_AUTOMATION_INTENT_PATTERN;
export const WORKER_APPROVAL_CHANNEL_ID = CFG_WORKER_APPROVAL_CHANNEL_ID;
export const CLEAR_GUILD_SCOPED_COMMANDS_ON_GLOBAL_SYNC = CFG_CLEAR_GUILD_COMMANDS;

const ALL_COMMANDS = [
  new SlashCommandBuilder()
    .setName('도움말')
    .setDescription('사용 가능한 명령어를 한눈에 안내합니다'),
  new SlashCommandBuilder()
    .setName('주가')
    .setDescription('주식 현재 가격을 조회합니다')
    .addStringOption((o) =>
      o.setName('symbol').setDescription('예: AAPL, TSLA, MSFT').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('응답방식').setDescription('응답을 나만 볼지, 채널에 공유할지 선택')
        .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('차트')
    .setDescription('주식 30일 차트를 조회합니다')
    .addStringOption((o) =>
      o.setName('symbol').setDescription('예: AAPL, TSLA, MSFT').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('응답방식').setDescription('응답을 나만 볼지, 채널에 공유할지 선택')
        .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('분석')
    .setDescription('AI 투자 관점 분석')
    .addStringOption((o) =>
      o.setName('query').setDescription('기업/종목/테마 입력').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('응답방식').setDescription('응답을 나만 볼지, 채널에 공유할지 선택')
        .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('구독')
    .setDescription('영상/게시글/뉴스 자동 구독을 관리합니다 (현재 채널에 등록)')
    .addStringOption((o) =>
      o.setName('동작').setDescription('조회 / 추가 / 제거').setRequired(false)
        .addChoices(
          { name: '추가', value: 'add' },
          { name: '해제', value: 'remove' },
          { name: '목록', value: 'list' },
        ),
    )
    .addStringOption((o) =>
      o.setName('종류').setDescription('선택!').setRequired(false)
        .addChoices(
          { name: '영상', value: 'videos' },
          { name: '게시글', value: 'posts' },
          { name: '뉴스', value: 'news' },
        ),
    )
    .addStringOption((o) =>
      o.setName('링크').setDescription('영상/게시글일 때 YouTube 채널 링크 또는 UC... 채널 ID').setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('해줘')
    .setDescription('뮤엘에게 작업을 요청합니다 — 문서·메모·지식 기반으로 답변합니다')
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName('질문').setDescription('예: 트레이딩 전략이 어떻게 구성되어 있나요?').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('공개범위').setDescription('응답을 나만 볼지 채널에 공유할지 선택')
        .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('만들어줘')
    .setDescription('코드·스크립트·자동화를 스레드로 협업 생성합니다')
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName('요청').setDescription('예: Express 라우터 만들어줘, Python 크롤러 만들어줘').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('공개범위').setDescription('응답을 나만 볼지 채널에 공유할지 선택')
        .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
        .setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName('상태')
    .setDescription('봇과 자동화 런타임 상태를 확인합니다')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('정책')
    .setDescription('서버 운영 정책을 조회하고 설정합니다')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub.setName('조회').setDescription('현재 서버 정책 전체 조회 (세션 한도, 도메인 허용 목록 등)'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('도메인추가')
        .setDescription('뉴스 자동 캡처 허용 도메인 추가')
        .addStringOption((o) =>
          o.setName('도메인').setDescription('예: reuters.com, bloomberg.com').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('도메인삭제')
        .setDescription('뉴스 자동 캡처 허용 목록에서 도메인 삭제')
        .addStringOption((o) =>
          o.setName('도메인').setDescription('삭제할 도메인').setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName('관리설정')
    .setDescription('서버 데이터 학습 허용(on/off)을 설정합니다')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName('학습').setDescription('학습 허용 on/off')
        .addChoices(
          { name: 'on', value: 'on' },
          { name: 'off', value: 'off' },
        )
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('잊어줘')
    .setDescription('잊혀질 권리: 유저/길드 데이터 삭제를 요청합니다')
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName('동작').setDescription('미리보기 또는 실행')
        .addChoices(
          { name: '미리보기', value: 'preview' },
          { name: '실행', value: 'execute' },
        )
        .setRequired(false),
    )
    .addStringOption((o) =>
      o.setName('범위').setDescription('삭제 범위')
        .addChoices(
          { name: '내 데이터(user)', value: 'user' },
          { name: '서버 데이터(guild)', value: 'guild' },
        )
        .setRequired(false),
    )
    .addUserOption((o) =>
      o.setName('대상유저').setDescription('관리자 전용: 다른 유저 데이터 삭제 대상').setRequired(false),
    )
    .addStringOption((o) =>
      o.setName('확인문구').setDescription('실행 시: FORGET_USER / FORGET_USER_ADMIN / FORGET_GUILD').setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('프로필')
    .setDescription('유저의 관계/기억 기반 프로필 스냅샷을 조회합니다')
    .setDMPermission(false)
    .addUserOption((o) =>
      o.setName('유저').setDescription('조회할 유저 (생략 시 내 프로필)').setRequired(false),
    )
    .addStringOption((o) =>
      o.setName('공개범위').setDescription('응답 공개 범위')
        .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('메모')
    .setDescription('유저 메모를 추가하거나 조회합니다')
    .setDMPermission(false)
    .addUserOption((o) =>
      o.setName('유저').setDescription('대상 유저').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('내용').setDescription('메모 내용 (생략 시 기존 메모 조회)').setRequired(false).setMaxLength(1200),
    )
    .addStringOption((o) =>
      o.setName('공개범위').setDescription('메모 가시성')
        .addChoices({ name: '나만 보기', value: 'private' }, { name: '서버 공용 맥락', value: 'public' })
        .setRequired(false),
    ),
  new ContextMenuCommandBuilder()
    .setName('유저 프로필 보기')
    .setType(ApplicationCommandType.User),
  new ContextMenuCommandBuilder()
    .setName('유저 메모 추가')
    .setType(ApplicationCommandType.User),
  new SlashCommandBuilder()
    .setName('변경사항')
    .setDescription('뮤엘 최근 업데이트 내역을 확인합니다')
    .setDMPermission(false)
    .addIntegerOption((o) =>
      o.setName('개수').setDescription('표시할 항목 수 (기본 3, 최대 5)').setMinValue(1).setMaxValue(5).setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('관리자')
    .setDescription('관리자 도구 모음')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub.setName('상태').setDescription('봇/자동화 런타임 상태 확인'),
    )
    .addSubcommand((sub) =>
      sub.setName('자동화실행')
        .setDescription('자동화 잡 즉시 실행')
        .addStringOption((o) =>
          o.setName('잡이름').setDescription('실행할 잡 이름').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('즉시전송').setDescription('즉시 전송 요청'),
    )
    .addSubcommand((sub) =>
      sub.setName('재연결').setDescription('Discord 연결 재시도'),
    )
    .addSubcommand((sub) =>
      sub.setName('채널아이디')
        .setDescription('채널 ID 확인')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('대상 채널').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('포럼아이디')
        .setDescription('포럼 ID 확인')
        .addChannelOption((o) =>
          o.setName('forum').setDescription('대상 포럼').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('동기화').setDescription('슬래시 커맨드 강제 동기화'),
    )
    .addSubcommand((sub) =>
      sub.setName('세션이력').setDescription('최근 완료된 AI 세션 산출물 이력 조회'),
    ),
  new SlashCommandBuilder()
    .setName('유저')
    .setDescription('내 프로필과 활동 통계를 확인합니다')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('통계')
    .setDescription('관리자: 특정 유저의 CRM 프로필과 활동 정보를 조회합니다')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((o) =>
      o.setName('유저').setDescription('조회할 대상 유저').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('공개범위').setDescription('응답을 나만 볼지, 채널에 공유할지 선택')
        .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('지표리뷰')
    .setDescription('관리자: Metric Review — KR별 지표 현황, 리스크, 활성 Intent 요약')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

export const commandDefinitions = ALL_COMMANDS
  .map((d) => d.toJSON())
  .filter((d) => {
    const name = String(d.name || '');
    return !SIMPLE_COMMANDS_ENABLED || SIMPLE_COMMAND_ALLOWLIST.has(name);
  });
