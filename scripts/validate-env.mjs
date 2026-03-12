/* eslint-disable no-console */
import 'dotenv/config';

const read = (key) => String(process.env[key] || '').trim();
const readAny = (keys) => {
  for (const key of keys) {
    const value = read(key);
    if (value) return value;
  }
  return '';
};

const isTruthy = (value, fallback = false) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw);
};

const isValidUrl = (value) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const findings = [];
let hasError = false;

const add = (level, key, message) => {
  findings.push({ level, key, message });
  if (level === 'ERROR') {
    hasError = true;
  }
};

const requireNonEmpty = (key, why) => {
  if (!read(key)) {
    add('ERROR', key, `필수값 누락: ${why}`);
  }
};

const recommendNonEmpty = (key, why) => {
  if (!read(key)) {
    add('WARN', key, `권장값 누락: ${why}`);
  }
};

const startBot = isTruthy(process.env.START_BOT, false);
const startAutomation = isTruthy(process.env.START_AUTOMATION_JOBS, false);
const startTrading = isTruthy(process.env.START_TRADING_BOT, false);
const aiProvider = read('AI_PROVIDER').toLowerCase();

console.log('[env-check] Muel environment validation start');
console.log(`[env-check] mode START_BOT=${startBot} START_AUTOMATION_JOBS=${startAutomation} START_TRADING_BOT=${startTrading} AI_PROVIDER=${aiProvider || 'auto'}`);

// Core
if (!read('NODE_ENV')) {
  add('WARN', 'NODE_ENV', '미설정 시 기본값은 development입니다. 운영 배포는 production을 권장합니다.');
}
requireNonEmpty('JWT_SECRET', '인증 토큰 서명');

if (startBot || startAutomation) {
  if (!read('DISCORD_TOKEN') && !read('DISCORD_BOT_TOKEN')) {
    add('ERROR', 'DISCORD_TOKEN|DISCORD_BOT_TOKEN', '봇/자동화 실행에는 디스코드 토큰이 필요합니다.');
  }
}

if (startBot) {
  if (!readAny(['DISCORD_OAUTH_CLIENT_ID', 'DISCORD_CLIENT_ID'])) {
    add('ERROR', 'DISCORD_OAUTH_CLIENT_ID|DISCORD_CLIENT_ID', '로그인/초대 링크 생성');
  }
  if (!readAny(['DISCORD_OAUTH_CLIENT_SECRET', 'DISCORD_CLIENT_SECRET'])) {
    add('ERROR', 'DISCORD_OAUTH_CLIENT_SECRET|DISCORD_CLIENT_SECRET', 'OAuth 콜백 처리');
  }
}

// AI provider
if (aiProvider === 'openai') {
  requireNonEmpty('OPENAI_API_KEY', 'AI_PROVIDER=openai 선택 시 필요');
}
if (aiProvider === 'gemini') {
  if (!read('GEMINI_API_KEY') && !read('GOOGLE_API_KEY')) {
    add('ERROR', 'GEMINI_API_KEY|GOOGLE_API_KEY', 'AI_PROVIDER=gemini 선택 시 필요');
  }
}
if (!aiProvider) {
  if (!read('OPENAI_API_KEY') && !read('GEMINI_API_KEY') && !read('GOOGLE_API_KEY')) {
    add('WARN', 'AI_PROVIDER/OPENAI_API_KEY/GEMINI_API_KEY', 'LLM 키가 없으면 /해줘, 에이전트 세션이 실패합니다.');
  }
}

// Supabase (recommended for multi-guild durability)
if (!read('SUPABASE_URL') || !(read('SUPABASE_SERVICE_ROLE_KEY') || read('SUPABASE_KEY'))) {
  add('WARN', 'SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_KEY', '멀티서버 상태 유지(구독/세션/메모리)에는 Supabase 구성이 사실상 필요합니다.');
}
if (read('SUPABASE_URL') && !isValidUrl(read('SUPABASE_URL'))) {
  add('ERROR', 'SUPABASE_URL', '유효한 http/https URL이어야 합니다.');
}

// Web / OAuth callback
const publicBaseUrl = read('PUBLIC_BASE_URL') || read('RENDER_EXTERNAL_URL') || read('RENDER_PUBLIC_URL');
if (publicBaseUrl && !isValidUrl(publicBaseUrl)) {
  add('ERROR', 'PUBLIC_BASE_URL', '유효한 http/https URL이어야 합니다.');
}
if (startBot) {
  recommendNonEmpty('PUBLIC_BASE_URL', 'Discord OAuth callback 주소 자동 생성');
  if (!readAny(['FRONTEND_ORIGIN', 'CORS_ALLOWLIST', 'OAUTH_REDIRECT_ALLOWLIST'])) {
    add('WARN', 'FRONTEND_ORIGIN|CORS_ALLOWLIST|OAUTH_REDIRECT_ALLOWLIST', 'CORS/로그인 UI 연동');
  }
}

// Multi-guild command sync checks
if (read('DISCORD_COMMAND_GUILD_ID')) {
  add('WARN', 'DISCORD_COMMAND_GUILD_ID', '설정 시 특정 길드 빠른 동기화가 우선됩니다. 멀티서버 운영에서는 값이 의도한 길드인지 확인하세요.');
}

// Automation & trading optional warnings
if (startAutomation && !read('YOUTUBE_MONITOR_INTERVAL_MS')) {
  add('WARN', 'YOUTUBE_MONITOR_INTERVAL_MS', '자동화 주기를 명시하면 운영 예측성이 높아집니다.');
}
if (startTrading) {
  recommendNonEmpty('TRADING_SYMBOLS', '트레이딩 루프 심볼 정의');
  recommendNonEmpty('TRADING_TIMEFRAME', '트레이딩 캔들 주기');
}

if (findings.length === 0) {
  console.log('[env-check] OK: 필수/권장 점검에서 이슈가 없습니다.');
  process.exit(0);
}

for (const item of findings) {
  console.log(`[${item.level}] ${item.key} - ${item.message}`);
}

if (hasError) {
  console.log('[env-check] FAIL: ERROR 항목을 먼저 해결하세요.');
  process.exit(1);
}

console.log('[env-check] WARN only: 운영 전 권장 항목 확인이 필요합니다.');
process.exit(0);
