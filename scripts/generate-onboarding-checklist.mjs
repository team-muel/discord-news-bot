/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs');

const parseArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const parseBool = (value, fallback = false) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

const dryRun = parseBool(parseArg('dryRun', 'false'));
const name = String(parseArg('name', '')).trim();
const kind = String(parseArg('kind', 'model')).trim().toLowerCase(); // 'model' | 'tool' | 'adapter'
const provider = String(parseArg('provider', '')).trim();
const endpoint = String(parseArg('endpoint', '')).trim();
const envKey = String(parseArg('envKey', '')).trim();

if (!name) {
  console.error('[ONBOARDING] --name is required (e.g. --name=gpt-4.1-mini or --name=nemoclaw)');
  process.exit(1);
}

const now = new Date();
const day = now.toISOString().slice(0, 10);

/**
 * Validate environment and connectivity prerequisites.
 */
const checkPrerequisites = () => {
  const checks = [];

  // 1. Environment variable present (if specified)
  if (envKey) {
    const value = String(process.env[envKey] || '').trim();
    checks.push({
      id: 'env_key_present',
      ok: value.length > 0,
      detail: `${envKey}=${value ? '[SET]' : '[MISSING]'}`,
    });
  }

  // 2. Endpoint reachable (basic DNS check via env — actual connectivity tested by probe)
  if (endpoint) {
    try {
      new URL(endpoint);
      checks.push({ id: 'endpoint_url_valid', ok: true, detail: endpoint });
    } catch {
      checks.push({ id: 'endpoint_url_valid', ok: false, detail: `invalid URL: ${endpoint}` });
    }
  }

  // 3. Provider known in llmClient (heuristic: check LLM_PROVIDER_ORDER env)
  if (kind === 'model' && provider) {
    const providerOrder = String(process.env.LLM_PROVIDER_ORDER || '').toLowerCase();
    const knownProviders = new Set(providerOrder.split(',').map((s) => s.trim()).filter(Boolean));
    const isKnown = knownProviders.has(provider.toLowerCase());
    checks.push({
      id: 'provider_in_order',
      ok: isKnown || knownProviders.size === 0,
      detail: isKnown ? `${provider} found in LLM_PROVIDER_ORDER` : knownProviders.size > 0 ? `${provider} NOT in LLM_PROVIDER_ORDER` : 'LLM_PROVIDER_ORDER not set',
    });
  }

  // 4. If tool kind, check existing probe for the tool name
  if (kind === 'tool') {
    const probeScript = path.join(ROOT, 'scripts', 'probe-external-tools.ts');
    checks.push({
      id: 'probe_script_exists',
      ok: fs.existsSync(probeScript),
      detail: fs.existsSync(probeScript) ? 'probe-external-tools.ts found' : 'probe script missing',
    });
  }

  // 5. If adapter kind (M-15), check adapter file and registry compatibility
  if (kind === 'adapter') {
    // Check if adapter file exists in adapters/ directory
    const adaptersDir = path.join(ROOT, 'src', 'services', 'tools', 'adapters');
    const adapterFileName = `${name.replace(/[^a-zA-Z0-9-]/g, '')}Adapter.ts`;
    const adapterFilePath = path.join(adaptersDir, adapterFileName);
    checks.push({
      id: 'adapter_file_exists',
      ok: fs.existsSync(adapterFilePath),
      detail: fs.existsSync(adapterFilePath) ? `${adapterFileName} found` : `${adapterFileName} not found in src/services/tools/adapters/`,
    });

    // Check adapter ID pattern (lowercase alphanumeric + hyphens, 2-50 chars)
    const adapterId = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const adapterIdValid = /^[a-z][a-z0-9-]{1,49}$/.test(adapterId);
    checks.push({
      id: 'adapter_id_valid',
      ok: adapterIdValid,
      detail: adapterIdValid ? `ID '${adapterId}' passes ADAPTER_ID_PATTERN` : `ID '${adapterId}' does not match ^[a-z][a-z0-9-]{1,49}$`,
    });

    // Check if enabled env var pattern exists
    const enabledEnvKey = `${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_ENABLED`;
    checks.push({
      id: 'enabled_env_var',
      ok: Boolean(process.env[enabledEnvKey]),
      detail: `${enabledEnvKey}=${process.env[enabledEnvKey] || '[NOT SET]'}`,
    });

    // Check probe integration
    const probeFile = path.join(ROOT, 'src', 'services', 'tools', 'externalToolProbe.ts');
    const probeExists = fs.existsSync(probeFile);
    let probeHasAdapter = false;
    if (probeExists) {
      const probeContent = fs.readFileSync(probeFile, 'utf8');
      probeHasAdapter = probeContent.includes(adapterId) || probeContent.includes(name);
    }
    checks.push({
      id: 'probe_integration',
      ok: probeHasAdapter,
      detail: probeHasAdapter ? `${adapterId} found in externalToolProbe.ts` : `${adapterId} NOT in externalToolProbe.ts (auto-load will discover adapter file)`,
    });
  }

  return checks;
};

const checks = checkPrerequisites();
const allPassed = checks.every((c) => c.ok);
const verdict = allPassed ? 'READY' : 'INCOMPLETE';

const checklist = kind === 'model'
  ? [
    '- [ ] Provider API key 환경변수 설정 (.env)',
    '- [ ] LLM_PROVIDER_ORDER에 provider 추가',
    '- [ ] LLM_WORKFLOW_MODEL_BINDINGS에 workflow slot 매핑 추가',
    '- [ ] litellm.config.yaml에 model 등록 (LiteLLM 사용 시)',
    '- [ ] probe 실행으로 connectivity 확인 (npm run tools:probe)',
    '- [ ] cost-optimized / quality-optimized 프로파일 매핑 검토',
    '- [ ] go/no-go gate 실행 후 p95 latency 기준 충족 확인',
    '- [ ] 24시간 canary 관찰 후 정식 적용',
  ]
  : kind === 'adapter'
  ? [
    '- [ ] adapter 파일 생성: `src/services/tools/adapters/<name>Adapter.ts`',
    '- [ ] ExternalToolAdapter 인터페이스 구현 (`id`, `capabilities`, `isAvailable`, `execute`)',
    '- [ ] adapter ID가 ADAPTER_ID_PATTERN (^[a-z][a-z0-9-]{1,49}$) 준수',
    '- [ ] `<NAME>_ENABLED` 환경변수로 활성화 제어',
    '- [ ] 각 capability에 대한 execute case 구현',
    '- [ ] 입력 값 sanitization (shell meta 문자 제거, 길이 제한)',
    '- [ ] timeout 설정 (기본 15s, 장시간 작업은 별도)',
    '- [ ] lite mode 지원 여부 결정 (CLI 없이 HTTP/LiteLLM fallback)',
    '- [ ] 테스트 파일 생성: `<name>Adapter.test.ts`',
    '- [ ] `npm run lint` (tsc --noEmit) 통과',
    '- [ ] `npx vitest run` 전체 테스트 통과',
    '- [ ] adapter auto-loader에서 자동 발견 확인 (서버 시작 로그)',
    '- [ ] externalToolProbe.ts에 probe 함수 추가 (선택사항: auto-load로 대체 가능)',
    '- [ ] render.yaml에 필요 환경변수 추가',
    '- [ ] 24시간 canary 관찰 후 정식 적용',
  ]
  : [
    '- [ ] 도구 설치 및 PATH 등록 확인',
    '- [ ] 필수 환경변수 설정 (.env)',
    '- [ ] externalToolProbe에 도구 probe 함수 추가',
    '- [ ] probe 실행으로 availability 확인 (npm run tools:probe)',
    '- [ ] actionRunner 또는 adapter에 capability 라우팅 추가',
    '- [ ] sandbox 또는 Docker 격리 설정 (해당 시)',
    '- [ ] go/no-go gate 실행 후 안정성 확인',
    '- [ ] 24시간 canary 관찰 후 정식 적용',
  ];

const md = `# ${kind === 'model' ? 'Model' : kind === 'adapter' ? 'Adapter' : 'Tool'} Onboarding: ${name}

- generated_at: ${now.toISOString()}
- name: ${name}
- kind: ${kind}
- provider: ${provider || 'N/A'}
- endpoint: ${endpoint || 'N/A'}
- env_key: ${envKey || 'N/A'}
- prerequisite_verdict: ${verdict}

## Prerequisite Checks

${checks.length > 0
    ? checks.map((c) => `- [${c.ok ? 'x' : ' '}] ${c.id}: ${c.detail}`).join('\n')
    : '- (no prerequisite checks configured)'}

## Onboarding Checklist

${checklist.join('\n')}

## Rollback Plan

1. 환경변수에서 해당 provider/도구 키 제거
2. LLM_PROVIDER_ORDER / workflow bindings에서 해당 항목 삭제
3. gate 재실행으로 기존 provider만으로 안정성 확인
4. canary 길드에서 먼저 적용 해제 후 전체 적용 해제
`;

const json = {
  generated_at: now.toISOString(),
  name,
  kind,
  provider,
  endpoint: endpoint || null,
  env_key: envKey || null,
  prerequisite_verdict: verdict,
  checks,
  checklist,
};

if (dryRun) {
  console.log('[ONBOARDING] dry-run=true');
  console.log(md);
} else {
  const sanitizedName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const mdPath = path.join(OUTPUT_DIR, `${day}_onboarding-${kind}-${sanitizedName}.md`);
  const jsonPath = path.join(OUTPUT_DIR, `${day}_onboarding-${kind}-${sanitizedName}.json`);
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, md, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2), 'utf8');
  console.log(`[ONBOARDING] written: ${path.relative(ROOT, mdPath).replace(/\\/g, '/')}`);
}

console.log(`[ONBOARDING] verdict=${verdict} name=${name} kind=${kind}`);
