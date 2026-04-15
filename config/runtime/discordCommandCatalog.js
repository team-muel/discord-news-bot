export const DISCORD_CHAT_COMMAND_NAMES = Object.freeze({
  HELP: '도움말',
  STOCK_PRICE: '주가',
  STOCK_CHART: '차트',
  ANALYZE: '분석',
  SUBSCRIBE: '구독',
  MAKE: '만들어줘',
  ASK_COMPAT: '해줘',
  MUEL: '뮤엘',
  CHANGELOG: '변경사항',
  PROFILE: '프로필',
  MEMO: '메모',
  ADMIN: '관리자',
  MANAGE_SETTINGS: '관리설정',
  FORGET: '잊어줘',
  START: '시작',
  STATUS: '상태',
  SKILL_LIST: '스킬목록',
  POLICY: '정책',
  ONBOARDING: '온보딩',
  STOP: '중지',
  USER: '유저',
  STATS: '통계',
  METRIC_REVIEW: '지표리뷰',
});

export const DISCORD_CONTEXT_MENU_COMMAND_NAMES = Object.freeze({
  USER_PROFILE: '유저 프로필 보기',
  USER_NOTE: '유저 메모 추가',
});

export const DISCORD_CHAT_INPUT_COMMAND_NAMES = Object.freeze(Object.values(DISCORD_CHAT_COMMAND_NAMES));
export const DISCORD_CONTEXT_MENU_COMMAND_NAME_LIST = Object.freeze(Object.values(DISCORD_CONTEXT_MENU_COMMAND_NAMES));

export const DISCORD_DEFAULT_SIMPLE_COMMAND_ALLOWLIST = Object.freeze([
  ...DISCORD_CHAT_INPUT_COMMAND_NAMES,
  ...DISCORD_CONTEXT_MENU_COMMAND_NAME_LIST,
  'ping',
  'help',
  '로그인',
  '설정',
  '세션',
  '학습',
]);