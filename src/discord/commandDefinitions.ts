/**
 * Slash command definitions.
 * Reads feature-flag env vars at module load time and returns the filtered command list.
 * No service imports.
 */
import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { parseBooleanEnv } from '../utils/env';

export const SIMPLE_COMMANDS_ENABLED = !['0', 'false', 'no', 'off']
  .includes(String(process.env.DISCORD_SIMPLE_COMMANDS_ENABLED || 'true').toLowerCase());
export const SIMPLE_COMMAND_ALLOWLIST = new Set([
  'ping',
  'help',
  '도움말',
  '로그인',
  '뮤엘',
  '구독',
  '해줘',
  '만들어줘',
  '주가',
  '차트',
  '상태',
  '설정',
  '정책',
  '세션',
  '관리설정',
]);
export const LEGACY_SESSION_COMMANDS_ENABLED = parseBooleanEnv(
  process.env.LEGACY_SESSION_COMMANDS_ENABLED,
  false,
);
export const LEGACY_SESSION_COMMAND_NAMES = new Set([
  '시작', '스킬목록', '온보딩', '학습', '중지',
]);
export const LEGACY_SUBSCRIBE_COMMAND_ENABLED = parseBooleanEnv(
  process.env.LEGACY_SUBSCRIBE_COMMAND_ENABLED,
  true,
);
export const CODE_THREAD_ENABLED = parseBooleanEnv(
  process.env.CODE_THREAD_ENABLED,
  true,
);
export const CODING_INTENT_PATTERN =
  /(코드|코딩|구현|함수|클래스|버그|리팩터|script|typescript|javascript|python|sql|api\s*만들|코드\s*짜|만들어|짜줘|작성해줘)/i;
export const AUTOMATION_INTENT_PATTERN =
  /(자동화|봇|워커|연동|알림|크롤|webhook|api.*만들|자동.*전송|데이터.*수집|주기적|스케줄)/i;
export const WORKER_APPROVAL_CHANNEL_ID = String(
  process.env.WORKER_APPROVAL_CHANNEL_ID || '',
).trim();

const CLEAR_GUILD_SCOPED_COMMANDS_ON_GLOBAL_SYNC = !['0', 'false', 'no', 'off']
  .includes(
    String(process.env.DISCORD_CLEAR_GUILD_COMMANDS_ON_GLOBAL_SYNC || 'true').toLowerCase(),
  );
export { CLEAR_GUILD_SCOPED_COMMANDS_ON_GLOBAL_SYNC };

const ALL_COMMANDS = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is responsive'),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('사용 가능한 명령어 안내'),
  new SlashCommandBuilder()
    .setName('도움말')
    .setDescription('사용 가능한 명령어 안내'),
  new SlashCommandBuilder()
    .setName('설정')
    .setDescription('봇 상태와 사용법을 한눈에 확인')
    .addStringOption((o) =>
      o.setName('항목').setDescription('확인할 설정 항목 (비우면 모드)').setRequired(false)
        .addChoices(
          { name: '모드', value: 'mode' },
          { name: '명령어', value: 'commands' },
          { name: '자동화', value: 'automation' },
        ),
    ),
  new SlashCommandBuilder()
    .setName('로그인')
    .setDescription('내 계정으로 봇 기능 사용 가능 여부를 진단합니다')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('뮤엘')
    .setDescription('Muel과 바로 대화합니다')
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName('요청').setDescription('예: 오늘 해야 할 일 정리해줘').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('공개범위').setDescription('응답을 나만 볼지 채널에 공유할지 선택')
        .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('주가')
    .setDescription('주식 현재 가격 조회')
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
    .setDescription('주식 30일 차트 조회')
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
    .setDescription('영상/게시글/뉴스를 구독합니다')
    .addStringOption((o) =>
      o.setName('동작').setDescription('무엇을 할지 선택').setRequired(false)
        .addChoices(
          { name: '추가', value: 'add' },
          { name: '해제', value: 'remove' },
          { name: '목록', value: 'list' },
        ),
    )
    .addStringOption((o) =>
      o.setName('종류').setDescription('구독 종류 선택').setRequired(false)
        .addChoices(
          { name: '영상 + 링크', value: 'videos' },
          { name: '게시글 + 링크', value: 'posts' },
          { name: '뉴스 (구글 금융 고정)', value: 'news' },
        ),
    )
    .addStringOption((o) =>
      o.setName('링크').setDescription('영상/게시글일 때 YouTube 채널 링크 또는 UC... 채널 ID').setRequired(false),
    )
    .addChannelOption((o) =>
      o.setName('디스코드채널')
        .setDescription('추가/해제 대상 Discord 채널 (목록은 생략 가능)')
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
          ChannelType.AnnouncementThread,
        )
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('물어봐')
    .setDescription('Obsidian 문서 기반으로 질문에 답해드립니다')
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
    .setName('문서')
    .setDescription('Obsidian vault에서 관련 문서를 검색합니다')
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName('검색어').setDescription('예: 아키텍처, 트레이딩, 온보딩').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('공개범위').setDescription('응답을 나만 볼지 채널에 공유할지 선택')
        .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('해줘')
    .setDescription('자연어로 요청하면 작업을 알아서 진행합니다')
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName('요청').setDescription('예: 고양이 영상 찾아줘, 이번주 애플 주가 요약해줘').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('공개범위').setDescription('응답을 나만 볼지 채널에 공유할지 선택')
        .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('만들어줘')
    .setDescription('코드·스크립트·자동화 로직을 만들어드립니다')
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
    .setName('세션')
    .setDescription('현재 서버 세션 조회/제거')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub.setName('조회').setDescription('현재 서버에서 작동 중인 세션 조회'),
    )
    .addSubcommand((sub) =>
      sub.setName('제거').setDescription('현재 서버에서 작동 중인 세션 제거'),
    ),
  new SlashCommandBuilder()
    .setName('시작')
    .setDescription('세션 시작(호환 명령)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName('목표').setDescription('예: 온보딩 자동화 정책 설계').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('스킬').setDescription('특정 스킬을 지정해 단일 실행')
        .addChoices(
          { name: 'ops-plan', value: 'ops-plan' },
          { name: 'ops-execution', value: 'ops-execution' },
          { name: 'ops-critique', value: 'ops-critique' },
          { name: 'guild-onboarding-blueprint', value: 'guild-onboarding-blueprint' },
          { name: 'incident-review', value: 'incident-review' },
          { name: 'webhook', value: 'webhook' },
        )
        .setRequired(false),
    )
    .addStringOption((o) =>
      o.setName('우선순위').setDescription('실행 전략: 빠름/균형/정밀')
        .addChoices(
          { name: '빠름', value: 'fast' },
          { name: '균형', value: 'balanced' },
          { name: '정밀', value: 'precise' },
        )
        .setRequired(false),
    )
    .addStringOption((o) =>
      o.setName('공개범위').setDescription('응답을 나만 볼지 채널에 공유할지 선택')
        .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('상태')
    .setDescription('봇과 자동화 상태 확인')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('정책')
    .setDescription('현재 서버 동시 세션 한도 및 운영 정책 조회')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('관리설정')
    .setDescription('서버 데이터 학습 허용 설정')
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
    .setName('온보딩')
    .setDescription('현재 길드 온보딩 분석 실행')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('학습')
    .setDescription('현재 길드 일일 학습/회고 실행')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName('목표').setDescription('선택: 기본 회고 목표 대신 사용자 지정 목표').setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('중지')
    .setDescription('실행 중 세션 중지 요청')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName('세션아이디').setDescription('중지할 세션 ID').setRequired(true),
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
    ),
];

export const commandDefinitions = ALL_COMMANDS
  .map((d) => d.toJSON())
  .filter((d) => {
    const name = String((d as any).name || '');
    if (!LEGACY_SUBSCRIBE_COMMAND_ENABLED && name === '구독') return false;
    if (!LEGACY_SESSION_COMMANDS_ENABLED && LEGACY_SESSION_COMMAND_NAMES.has(name)) return false;
    return !SIMPLE_COMMANDS_ENABLED || SIMPLE_COMMAND_ALLOWLIST.has(name);
  });
