/**
 * Slash command definitions.
 * Reads feature-flag env vars at module load time and returns the filtered command list.
 * No service imports.
 */
import {
  ApplicationCommandType,
  ChannelType,
  ContextMenuCommandBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { parseBooleanEnv } from '../utils/env';
import {
  AUTOMATION_INTENT_PATTERN as RUNTIME_AUTOMATION_INTENT_PATTERN,
  CODING_INTENT_PATTERN as RUNTIME_CODING_INTENT_PATTERN,
  SIMPLE_COMMAND_ALLOWLIST,
} from './runtimePolicy';

export const SIMPLE_COMMANDS_ENABLED = !['0', 'false', 'no', 'off']
  .includes(String(process.env.DISCORD_SIMPLE_COMMANDS_ENABLED || 'true').toLowerCase());
export { SIMPLE_COMMAND_ALLOWLIST };
export const CODE_THREAD_ENABLED = parseBooleanEnv(
  process.env.CODE_THREAD_ENABLED,
  true,
);
export const CODING_INTENT_PATTERN = RUNTIME_CODING_INTENT_PATTERN;
export const AUTOMATION_INTENT_PATTERN = RUNTIME_AUTOMATION_INTENT_PATTERN;
export const WORKER_APPROVAL_CHANNEL_ID = String(
  process.env.WORKER_APPROVAL_CHANNEL_ID || '',
).trim();

const CLEAR_GUILD_SCOPED_COMMANDS_ON_GLOBAL_SYNC = !['0', 'false', 'no', 'off']
  .includes(
    String(process.env.DISCORD_CLEAR_GUILD_COMMANDS_ON_GLOBAL_SYNC || 'false').toLowerCase(),
  );
export { CLEAR_GUILD_SCOPED_COMMANDS_ON_GLOBAL_SYNC };

const ALL_COMMANDS = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('봇 응답 속도를 확인합니다'),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('사용 가능한 명령어를 한눈에 안내합니다'),
  new SlashCommandBuilder()
    .setName('도움말')
    .setDescription('사용 가능한 명령어를 한눈에 안내합니다'),
  new SlashCommandBuilder()
    .setName('설정')
    .setDescription('뮤엘 대시보드로 이동합니다'),
  new SlashCommandBuilder()
    .setName('로그인')
    .setDescription('내 계정 권한과 기능 사용 가능 여부를 확인합니다')
    .setDMPermission(false),
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
    .setDescription('영상/게시글/뉴스 자동 구독을 관리합니다')
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
    .setDescription('실행형 요청을 능동적으로 처리합니다')
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
    .setName('세션')
    .setDescription('현재 서버 세션 조회/제거를 수행합니다')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub.setName('조회').setDescription('현재 서버에서 작동 중인 세션 조회'),
    )
    .addSubcommand((sub) =>
      sub.setName('이력').setDescription('최근 완료된 세션 산출물 이력 조회'),
    )
    .addSubcommand((sub) =>
      sub.setName('제거').setDescription('현재 서버에서 작동 중인 세션 제거'),
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
    .setName('학습')
    .setDescription('내 학습 자동 메모리 저장 설정을 조회하거나 변경합니다')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub.setName('조회').setDescription('내 학습 저장 활성화 여부 확인'),
    )
    .addSubcommand((sub) =>
      sub.setName('활성화').setDescription('내 대화 내용을 학습 메모리에 자동 저장합니다'),
    )
    .addSubcommand((sub) =>
      sub.setName('비활성화').setDescription('내 대화 내용을 학습 메모리에 저장하지 않습니다 (임시 옵트아웃)'),
    ),
  new SlashCommandBuilder()
    .setName('유저')
    .setDescription('유저 프로필 조회와 개인화 메모를 관리합니다')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub.setName('프로필')
        .setDescription('특정 유저의 관계/기억 기반 프로필 스냅샷을 조회합니다')
        .addUserOption((o) =>
          o.setName('유저').setDescription('조회할 대상 유저').setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('공개범위').setDescription('응답 공개 범위')
            .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('메모추가')
        .setDescription('유저 개인화 코멘트를 추가합니다')
        .addUserOption((o) => o.setName('유저').setDescription('대상 유저').setRequired(true))
        .addStringOption((o) => o.setName('코멘트').setDescription('저장할 개인화 코멘트').setRequired(true).setMaxLength(1200))
        .addStringOption((o) =>
          o.setName('공개범위').setDescription('코멘트 가시성')
            .addChoices({ name: '나만 보기', value: 'private' }, { name: '서버 공용 맥락', value: 'public' })
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('메모조회')
        .setDescription('유저 개인화 코멘트를 조회합니다')
        .addUserOption((o) => o.setName('유저').setDescription('대상 유저').setRequired(true))
        .addIntegerOption((o) => o.setName('개수').setDescription('최대 조회 개수(1~8)').setMinValue(1).setMaxValue(8).setRequired(false))
        .addStringOption((o) =>
          o.setName('공개범위').setDescription('응답 공개 범위')
            .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
            .setRequired(false),
        ),
    ),
  new ContextMenuCommandBuilder()
    .setName('유저 프로필 보기')
    .setType(ApplicationCommandType.User),
  new ContextMenuCommandBuilder()
    .setName('유저 메모 추가')
    .setType(ApplicationCommandType.User),
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
    return !SIMPLE_COMMANDS_ENABLED || SIMPLE_COMMAND_ALLOWLIST.has(name);
  });
