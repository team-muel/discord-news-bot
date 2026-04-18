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
  DISCORD_SIMPLE_COMMANDS_ENABLED,
} from '../config';
import {
  SIMPLE_COMMAND_ALLOWLIST,
} from './runtimePolicy';
import {
  DISCORD_CHAT_COMMAND_NAMES,
  DISCORD_CONTEXT_MENU_COMMAND_NAMES,
} from '../../config/runtime/discordCommandCatalog.js';

const createAskSlashCommand = (name: string, description: string) => new SlashCommandBuilder()
  .setName(name)
  .setDescription(description)
  .setDMPermission(false)
  .addStringOption((o) =>
    o.setName('질문').setDescription('예: 이 서버 자동화 흐름이 어떻게 구성되어 있나요?').setRequired(true),
  )
  .addStringOption((o) =>
    o.setName('공개범위').setDescription('응답을 나만 볼지 채널에 공유할지 선택')
      .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
      .setRequired(false),
  );

const createAgentStartCommand = () => new SlashCommandBuilder()
  .setName(DISCORD_CHAT_COMMAND_NAMES.START)
  .setDescription('관리자: 운영용 작업을 시작합니다')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o.setName('목표').setDescription('예: 온보딩 점검, 오류 원인 확인, 작업 재실행').setRequired(true),
  )
  .addStringOption((o) =>
    o.setName('공개범위').setDescription('응답을 나만 볼지 채널에 공유할지 선택')
      .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
      .setRequired(false),
  );

const createAgentOnboardingCommand = () => new SlashCommandBuilder()
  .setName(DISCORD_CHAT_COMMAND_NAMES.ONBOARDING)
  .setDescription('관리자: 서버 기본 안내와 준비 작업을 다시 실행합니다')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const createAgentStopCommand = () => new SlashCommandBuilder()
  .setName(DISCORD_CHAT_COMMAND_NAMES.STOP)
  .setDescription('관리자: 진행 중인 작업을 중지합니다')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o.setName('작업아이디').setDescription('중지할 작업 ID').setRequired(true),
  );

const ALL_COMMANDS = [
  new SlashCommandBuilder()
    .setName(DISCORD_CHAT_COMMAND_NAMES.HELP)
    .setDescription('사용 가능한 명령어를 한눈에 안내합니다'),
  new SlashCommandBuilder()
    .setName(DISCORD_CHAT_COMMAND_NAMES.SUBSCRIBE)
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
  createAskSlashCommand(DISCORD_CHAT_COMMAND_NAMES.MUEL, '뮤엘에게 질문합니다 — 문서·메모·지식 기반으로 답변합니다'),
  createAskSlashCommand(DISCORD_CHAT_COMMAND_NAMES.ASK_COMPAT, '호환 명령입니다 — /뮤엘과 같은 질문 응답을 수행합니다'),
  new SlashCommandBuilder()
    .setName(DISCORD_CHAT_COMMAND_NAMES.STATUS)
    .setDescription('봇과 자동화 런타임 상태를 확인합니다')
    .setDMPermission(false),
  createAgentStartCommand(),
  createAgentOnboardingCommand(),
  createAgentStopCommand(),
  new SlashCommandBuilder()
    .setName(DISCORD_CHAT_COMMAND_NAMES.FORGET)
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
    .setName(DISCORD_CHAT_COMMAND_NAMES.PROFILE)
    .setDescription('유저의 관계/기억 기반 프로필 스냅샷을 조회합니다')
    .setDMPermission(false)
    .addUserOption((o) =>
      o.setName('유저').setDescription('조회할 유저 (생략 시 내 프로필)').setRequired(false),
    )
    .addUserOption((o) =>
      o.setName('비교유저').setDescription('관리자 전용: 개인화 스냅샷 비교 대상').setRequired(false),
    )
    .addStringOption((o) =>
      o.setName('공개범위').setDescription('응답 공개 범위')
        .addChoices({ name: '나만 보기', value: 'private' }, { name: '채널에 공유', value: 'public' })
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName(DISCORD_CHAT_COMMAND_NAMES.MEMO)
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
    .setName(DISCORD_CONTEXT_MENU_COMMAND_NAMES.USER_PROFILE)
    .setType(ApplicationCommandType.User),
  new ContextMenuCommandBuilder()
    .setName(DISCORD_CONTEXT_MENU_COMMAND_NAMES.USER_NOTE)
    .setType(ApplicationCommandType.User),
  new SlashCommandBuilder()
    .setName(DISCORD_CHAT_COMMAND_NAMES.CHANGELOG)
    .setDescription('뮤엘 최근 업데이트 내역을 확인합니다')
    .setDMPermission(false)
    .addIntegerOption((o) =>
      o.setName('개수').setDescription('표시할 항목 수 (기본 3, 최대 5)').setMinValue(1).setMaxValue(5).setRequired(false),
    ),
];

export const commandDefinitions = ALL_COMMANDS
  .map((d) => d.toJSON())
  .filter((d) => {
    const name = String(d.name || '');
    return !DISCORD_SIMPLE_COMMANDS_ENABLED || SIMPLE_COMMAND_ALLOWLIST.has(name);
  });
