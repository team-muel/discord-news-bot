import 'dotenv/config';

import { spawnSync } from 'node:child_process';

import { parseArg } from './lib/cliArgs.mjs';
import { buildGcpNativeAutopilotContext } from './lib/openjarvisAutopilotCapacity.mjs';
import { buildAutomationCapabilityCatalog } from '../src/services/automation/apiFirstAgentFallbackService.ts';
import { listProxiedTools, listUpstreamDiagnostics } from '../src/mcp/proxyAdapter.ts';
import { loadOperatingBaseline, summarizeOperatingBaseline } from '../src/services/runtime/operatingBaseline.ts';
import { loadUpstreamsFromConfig } from '../src/mcp/proxyRegistry.ts';
import { getExternalAdapterStatus } from '../src/services/tools/externalAdapterRegistry.ts';
import { probeAllExternalTools } from '../src/services/tools/externalToolProbe.ts';

type CapabilityFindingStatus = 'optional-lane' | 'accepted-gap';

type CapabilityFinding = {
  id: string;
  severity: 'high' | 'medium' | 'low';
  category: 'disconnected' | 'locked' | 'guardrailed' | 'observability-gap';
  summary: string;
  evidence: string[];
  unlockAction: string;
  guardrail: string;
};

type AcknowledgedCapabilityFinding = CapabilityFinding & {
  status: CapabilityFindingStatus;
  rationale: string;
};

type CapabilityFindingPolicy = {
  id?: string;
  status?: CapabilityFindingStatus;
  summary?: string;
  rationale?: string;
};

type UnlockStep = {
  priority: number;
  id: string;
  goal: string;
  whyNow: string;
  actions: string[];
  exitCriteria: string[];
  guardrail: string;
};

const compact = (value: unknown): string => String(value || '').trim();
const toArray = <T>(value: readonly T[] | T[] | null | undefined): T[] => Array.isArray(value) ? [...value] : [];
const unique = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = compact(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const runCommand = (command: string, args: string[]): { ok: boolean; output: string } => {
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command, ...args], {
      encoding: 'utf8',
      windowsHide: true,
    })
    : spawnSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
    });

  return {
    ok: result.status === 0,
    output: `${result.stdout || ''}\n${result.stderr || ''}`.trim(),
  };
};

const readHermesSkillSummary = () => {
  const command = process.platform === 'win32' ? 'hermes.cmd' : 'hermes';
  const result = runCommand(command, ['skills', 'list']);
  const normalized = result.output.replace(/\s+/g, ' ');
  const counts = normalized.match(/(\d+)\s+hub-installed,\s+(\d+)\s+builtin,\s+(\d+)\s+local/i);

  return {
    command,
    ok: result.ok,
    hubInstalled: counts ? Number(counts[1]) : null,
    builtin: counts ? Number(counts[2]) : null,
    local: counts ? Number(counts[3]) : null,
    rawSummary: counts ? counts[0] : null,
  };
};

const renderMarkdown = (report: Record<string, unknown>): string => {
  const findings = toArray(report.findings as CapabilityFinding[]);
  const acknowledgedFindings = toArray(report.acknowledgedFindings as AcknowledgedCapabilityFinding[]);
  const unlockOrder = toArray(report.unlockOrder as UnlockStep[]);
  const alwaysOnRequired = toArray((report.alwaysOnRequired as { serviceId: string; label: string; state: string }[]))
    .map((entry) => `- ${entry.label}: ${entry.state}`);
  const optInRemoteProviderLanes = toArray(report.optInRemoteProviderLanes as string[]).map((entry) => `- ${entry}`);
  const localAccelerationOnly = toArray(report.localAccelerationOnly as string[]).map((entry) => `- ${entry}`);
  const localOperatorSurfaces = toArray(report.localOperatorSurfaces as { surfaceId: string; operationalState: string }[])
    .map((entry) => `- ${entry.surfaceId}: ${entry.operationalState}`);
  const liteLimited = toArray(report.liteLimitedAdapters as { id: string; hiddenCapabilities: string[] }[])
    .map((entry) => `- ${entry.id}: hidden=${entry.hiddenCapabilities.join(', ') || 'none'}`);
  const guardrails = toArray(report.globalGuardrails as string[]).map((entry) => `- ${entry}`);

  return [
    '# Capability Availability Audit',
    '',
    `- generated_at: ${compact(report.generatedAt)}`,
    `- model: ${compact(report.model)}`,
    `- hermes_skills: ${compact((report.hermesSkills as { rawSummary?: string | null })?.rawSummary) || 'unavailable'}`,
    '',
    '## Findings',
    ...(findings.length > 0
      ? findings.map((finding) => `- [${finding.severity}] ${finding.summary} | unlock=${finding.unlockAction}`)
      : ['- none']),
    '',
    '## Documented Optional Or Accepted',
    ...(acknowledgedFindings.length > 0
      ? acknowledgedFindings.map((finding) => `- [${finding.status}] ${finding.summary} | rationale=${finding.rationale}`)
      : ['- none']),
    '',
    '## Unlock Order',
    ...(unlockOrder.length > 0
      ? unlockOrder.map((step) => `- ${step.priority}. ${step.goal} | why=${step.whyNow}`)
      : ['- none']),
    '',
    '## Always-On Required',
    ...alwaysOnRequired,
    '',
    '## Opt-In Remote Provider Lanes',
    ...(optInRemoteProviderLanes.length > 0 ? optInRemoteProviderLanes : ['- none']),
    '',
    '## Local Acceleration Only',
    ...localAccelerationOnly,
    '',
    '## Local Operator Surfaces',
    ...localOperatorSurfaces,
    '',
    '## Lite-Limited Adapters',
    ...liteLimited,
    '',
    '## Global Guardrails',
    ...guardrails,
  ].join('\n');
};

async function main() {
  const format = compact(parseArg('format', 'json')).toLowerCase() || 'json';
  const refreshUpstreams = compact(parseArg('refreshUpstreams', 'true')).toLowerCase() !== 'false';

  loadUpstreamsFromConfig();

  if (refreshUpstreams) {
    await listProxiedTools();
  }

  const [probe, adapters, capabilityCatalog] = await Promise.all([
    probeAllExternalTools(),
    getExternalAdapterStatus(),
    buildAutomationCapabilityCatalog({ refreshUpstreams: refreshUpstreams }),
  ]);

  const baseline = loadOperatingBaseline();
  const baselineSummary = summarizeOperatingBaseline(baseline);
  const gcpNative = buildGcpNativeAutopilotContext();
  const gcpNativeServices = (gcpNative.services ?? {}) as Record<string, { canonical_match?: boolean }>;
  const hermesSkills = readHermesSkillSummary();
  const upstreams = listUpstreamDiagnostics({ includeDisabled: true, includeUrl: true });
  const enabledUpstreams = upstreams.filter((entry) => entry.enabled);
  const sharedWrapperNamespaces = capabilityCatalog.runtimeSignals.sharedWrapperNamespaces ?? [];
  const probeIds = new Set(probe.tools.map((tool) => tool.id));
  const adapterIds = new Set(adapters.map((adapter) => adapter.id));

  const blindSpotAdapters = adapters
    .map((adapter) => adapter.id)
    .filter((adapterId) => !probeIds.has(adapterId as never));
  const probeOnlySurfaces = probe.tools
    .map((tool) => tool.id)
    .filter((toolId) => !adapterIds.has(toolId as never));

  const liteLimitedAdapters = adapters
    .filter((adapter) => adapter.available && adapter.liteMode === true)
    .map((adapter) => {
      const fullCapabilities = toArray(adapter.capabilities);
      const exposedCapabilities = toArray(adapter.liteCapabilities);
      const hiddenCapabilities = fullCapabilities.filter((capability) => !exposedCapabilities.includes(capability));
      return {
        id: adapter.id,
        exposedCapabilities,
        hiddenCapabilities,
      };
    })
    .filter((adapter) => adapter.hiddenCapabilities.length > 0);

  const openclawProbe = probe.tools.find((tool) => tool.id === 'openclaw');
  const deepwikiAdapter = adapters.find((adapter) => adapter.id === 'deepwiki');
  const sharedMcpSurface = capabilityCatalog.surfaces.find((surface) => surface.surfaceId === 'gcpcompute-shared-mcp');
  const localOperatorSurfaces = capabilityCatalog.surfaces.filter((surface) => surface.layer === 'agent-fallback');

  const findings: CapabilityFinding[] = [];

  if ((compact(process.env.MCP_SHARED_MCP_URL) || compact(process.env.OBSIDIAN_REMOTE_MCP_URL)) && sharedWrapperNamespaces.length === 0) {
    findings.push({
      id: 'shared-mcp-wrapper-disconnected',
      severity: 'high',
      category: 'disconnected',
      summary: 'Shared MCP service URLs are configured, but no shared-wrapper upstream namespace is registered for the wrapper lane.',
      evidence: unique([
        `MCP_SHARED_MCP_URL=${compact(process.env.MCP_SHARED_MCP_URL) || '(unset)'}`,
        `OBSIDIAN_REMOTE_MCP_URL=${compact(process.env.OBSIDIAN_REMOTE_MCP_URL) || '(unset)'}`,
        `MCP_UPSTREAM_SERVERS=${compact(process.env.MCP_UPSTREAM_SERVERS) || '(unset)'}`,
        'shared_wrapper_bootstrap=npm run mcp:shared:upstream:dry',
        `enabled_upstreams=${enabledUpstreams.map((entry) => entry.namespace).join(', ') || '(none)'}`,
        `shared_wrapper_namespaces=${sharedWrapperNamespaces.join(', ') || '(none)'}`,
        `catalog_state=${sharedMcpSurface?.operationalState || 'unknown'}`,
      ]),
      unlockAction: 'Run npm run mcp:shared:upstream:dry, then npm run mcp:shared:upstream so the shared wrapper lane is derived from the canonical shared MCP ingress without hand-writing JSON.',
      guardrail: 'Do not treat direct shared MCP URLs as proof that the shared wrapper lane is available.',
    });
  }

  if (openclawProbe?.available && openclawProbe.apiReachable !== true) {
    findings.push({
      id: 'openclaw-gateway-disconnected',
      severity: 'medium',
      category: 'disconnected',
      summary: 'OpenClaw CLI is installed, but the local gateway chat surface is unreachable.',
      evidence: unique(openclawProbe.details),
      unlockAction: 'Either restore the local OpenClaw gateway health/chat surface or keep OpenClaw explicitly optional in routing.',
      guardrail: 'CLI presence alone must not promote OpenClaw to a default ingress lane.',
    });
  }

  if (hermesSkills.ok && hermesSkills.local === 0) {
    findings.push({
      id: 'hermes-local-skill-pack-empty',
      severity: 'medium',
      category: 'guardrailed',
      summary: 'Hermes currently exposes builtin and hub skills only; no repo-local skill pack is loaded.',
      evidence: unique([
        hermesSkills.rawSummary,
        `builtin=${hermesSkills.builtin}`,
        `hub_installed=${hermesSkills.hubInstalled}`,
        `local=${hermesSkills.local}`,
      ]),
      unlockAction: 'Only add local Hermes skills for repeated repo-specific workflows that cannot be expressed cleanly as shared MCP wrappers or deterministic scripts.',
      guardrail: 'Do not create local skill sprawl when the real gap is a missing shared contract or wrapper.',
    });
  }

  if (!deepwikiAdapter?.available) {
    findings.push({
      id: 'deepwiki-adapter-locked',
      severity: 'low',
      category: 'locked',
      summary: 'DeepWiki adapter is unavailable on this workstation.',
      evidence: ['deepwiki adapter availability=false'],
      unlockAction: 'Keep DeepWiki optional unless repo-doc Q&A coverage becomes a real bottleneck.',
      guardrail: 'This is not an always-on blocker for the local capability lane.',
    });
  }

  if (blindSpotAdapters.length > 0) {
    findings.push({
      id: 'probe-coverage-gap',
      severity: 'medium',
      category: 'observability-gap',
      summary: 'The standard external tool probe does not cover every adapter lane exposed by the registry.',
      evidence: unique([
        `probe_only=${probeOnlySurfaces.join(', ') || 'none'}`,
        `adapter_blind_spots=${blindSpotAdapters.join(', ') || 'none'}`,
      ]),
      unlockAction: 'Use this capability audit as the canonical unlock surface until the low-level probe and the adapter registry converge.',
      guardrail: 'Probe coverage is not the same thing as route-usable capability coverage.',
    });
  }

  const acknowledgedFindingPolicies = new Map(
    toArray(baseline?.capabilityAudit?.acknowledgedFindings as CapabilityFindingPolicy[])
      .map((policy) => {
        const id = compact(policy.id);
        if (!id) {
          return null;
        }

        return [
          id,
          {
            status: policy.status === 'accepted-gap' ? 'accepted-gap' : 'optional-lane',
            summary: compact(policy.summary) || null,
            rationale: compact(policy.rationale) || 'Documented in the operating baseline.',
          },
        ] as const;
      })
      .filter((entry): entry is readonly [string, { status: CapabilityFindingStatus; summary: string | null; rationale: string }] => Boolean(entry)),
  );

  const acknowledgedFindings: AcknowledgedCapabilityFinding[] = [];
  const activeFindings: CapabilityFinding[] = [];
  for (const finding of findings) {
    const acknowledged = acknowledgedFindingPolicies.get(finding.id);
    if (acknowledged) {
      acknowledgedFindings.push({
        ...finding,
        status: acknowledged.status,
        summary: acknowledged.summary || finding.summary,
        rationale: acknowledged.rationale,
      });
      continue;
    }

    activeFindings.push(finding);
  }

  const findingIds = new Set(activeFindings.map((finding) => finding.id));

  const unlockOrder = [
    findingIds.has('shared-mcp-wrapper-disconnected')
      ? {
          priority: 1,
          id: 'shared-mcp-wrapper-lane',
          goal: 'Restore the shared MCP wrapper lane as a real team-shared ingress.',
          whyNow: 'The always-on GCP service URL is present, but upstream.<namespace> wrappers are absent, so teammate-grade reuse is still disconnected.',
          actions: [
            'Run npm run mcp:shared:upstream:dry to preview the derived wrapper base URL and namespace.',
            'Run npm run mcp:shared:upstream to write or upsert the canonical shared wrapper namespace into .env.',
            'Re-run capability audit and verify gcpcompute-shared-mcp becomes ready instead of missing.',
          ],
          exitCriteria: [
            'listUpstreamDiagnostics returns at least one enabled namespace.',
            'automation.capability.catalog marks gcpcompute-shared-mcp as ready.',
          ],
          guardrail: 'Do not count raw MCP_SHARED_MCP_URL or OBSIDIAN_REMOTE_MCP_URL as wrapper readiness.',
        }
      : null,
    findingIds.has('probe-coverage-gap')
      ? {
          priority: 2,
          id: 'capability-observability',
          goal: 'Make unlock decisions from a complete capability inventory rather than the truncated low-level probe.',
          whyNow: 'The standard probe sees only a subset of adapter lanes, which makes some disconnected or guardrailed surfaces invisible.',
          actions: [
            'Use npm run capability:audit as the primary unlock audit surface.',
            'Treat lite-mode adapters and probe blind spots as first-class inventory, not as hidden implementation details.',
          ],
          exitCriteria: [
            'Adapter blind spots are reviewed before changing lane ownership.',
            'Unlock work references both adapter status and capability catalog state.',
          ],
          guardrail: 'Probe coverage is not capability coverage.',
        }
      : null,
    findingIds.has('openclaw-gateway-disconnected')
      ? {
          priority: 3,
          id: 'openclaw-ingress',
          goal: 'Either restore OpenClaw gateway chat or formally keep it as an optional ingress lane.',
          whyNow: 'The CLI exists, but the gateway chat surface is not healthy enough for default ingress decisions.',
          actions: [
            'Repair the OpenClaw gateway health and /v1/models JSON response if this workstation needs local ingress.',
            'Otherwise keep the current deterministic fallback path and document OpenClaw as optional.',
          ],
          exitCriteria: [
            'OpenClaw probe reports apiReachable=true, or routing docs explicitly demote it to optional.',
          ],
          guardrail: 'Do not widen ingress ownership based on CLI installation alone.',
        }
      : null,
    findingIds.has('hermes-local-skill-pack-empty')
      ? {
          priority: 4,
          id: 'hermes-local-skill-pack',
          goal: 'Decide whether repo-local Hermes skills are actually needed or whether wrappers/scripts are the better unlock path.',
          whyNow: 'Hermes currently has 0 local skills, but many capability gaps are shared-contract gaps rather than missing local prompts.',
          actions: [
            'Add a local skill only for repeated repo-specific workflows that cannot be expressed as deterministic scripts or shared wrappers.',
            'Keep team-reusable behavior in shared MCP or repo scripts first.',
          ],
          exitCriteria: [
            'Each new local skill has a narrow contract and a clear reason it cannot live in a shared wrapper or script.',
          ],
          guardrail: 'Prefer reusable shared contracts over personal-skill sprawl.',
        }
      : null,
  ].filter((step): step is UnlockStep => Boolean(step)).map((step, index) => ({
    ...step,
    priority: index + 1,
  }));

  const globalGuardrails = [
    'Treat always-on service wiring and shared wrapper activation as separate gates.',
    'Do not promote local-only lanes to always-on ownership until shared owner, observability, and rollback are explicit.',
    'Keep auth, versioning, and provider semantics in the provider-native layer rather than the agent prompt layer.',
    'Keep lite-mode adapters intentionally narrow until route ownership and observability justify widening them.',
    'Keep Supabase as hot-state, Obsidian as durable semantic owner, and GitHub as artifact/review plane during every unlock step.',
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    model: 'Capability Engineering Audit',
    hermesSkills,
    baseline: baselineSummary,
    gcpNative,
    runtimeSignals: capabilityCatalog.runtimeSignals,
    alwaysOnRequired: baselineSummary.alwaysOnRequired.map((serviceId) => ({
      serviceId,
      label: compact(baseline?.services?.[serviceId]?.envKey || serviceId),
      state: gcpNativeServices[serviceId]?.canonical_match === true ? 'wired' : 'missing',
    })),
    optInRemoteProviderLanes: baselineSummary.optInRemoteProviderLanes,
    localAccelerationOnly: baselineSummary.localAccelerationOnly,
    localOperatorSurfaces: localOperatorSurfaces.map((surface) => ({
      surfaceId: surface.surfaceId,
      operationalState: surface.operationalState,
      preferredWhen: surface.preferredWhen,
    })),
    probeCoverage: {
      lowLevelProbeIds: probe.tools.map((tool) => tool.id),
      adapterRegistryIds: adapters.map((adapter) => adapter.id),
      adapterBlindSpots: blindSpotAdapters,
      probeOnlySurfaces,
    },
    liteLimitedAdapters,
    findings: activeFindings,
    acknowledgedFindings,
    unlockOrder,
    globalGuardrails,
    sharedUpstreams: upstreams,
  };

  if (format === 'markdown') {
    process.stdout.write(`${renderMarkdown(report)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});