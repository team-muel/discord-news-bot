import { describe, expect, it } from 'vitest';

import {
  buildAutopilotCapacity,
  buildAutopilotCapacitySectionLines,
  buildGcpNativeAutopilotContext,
  normalizeCapacityTarget,
} from './openjarvisAutopilotCapacity.mjs';

describe('openjarvisAutopilotCapacity', () => {
  it('scores GCP native leverage from the canonical always-on surfaces', () => {
    const gcpNative = buildGcpNativeAutopilotContext({
      operatingBaseline: {
        gcpWorker: {
          instanceName: 'instance-1',
          machineType: 'e2-medium',
        },
        services: {
          implementWorker: { envKey: 'MCP_IMPLEMENT_WORKER_URL', url: 'https://worker.example.com' },
          architectWorker: { envKey: 'MCP_ARCHITECT_WORKER_URL', url: 'https://worker.example.com/architect' },
          reviewWorker: { envKey: 'MCP_REVIEW_WORKER_URL', url: 'https://worker.example.com/review' },
          operateWorker: { envKey: 'MCP_OPERATE_WORKER_URL', url: 'https://worker.example.com/operate' },
          openjarvisServe: { envKey: 'OPENJARVIS_SERVE_URL', url: 'https://worker.example.com/openjarvis' },
          unifiedMcp: { envKey: 'MCP_SHARED_MCP_URL', legacyEnvKey: 'OBSIDIAN_REMOTE_MCP_URL', url: 'https://worker.example.com/mcp' },
        },
      },
      env: {
        ACTION_MCP_STRICT_ROUTING: 'true',
        ACTION_MCP_DELEGATION_ENABLED: 'true',
        OPENJARVIS_REQUIRE_OPENCODE_WORKER: 'true',
        OBSIDIAN_REMOTE_MCP_ENABLED: 'true',
        MCP_IMPLEMENT_WORKER_URL: 'https://worker.example.com',
        MCP_ARCHITECT_WORKER_URL: 'https://worker.example.com/architect',
        MCP_REVIEW_WORKER_URL: 'https://worker.example.com/review',
        MCP_OPERATE_WORKER_URL: 'https://worker.example.com/operate',
        OPENJARVIS_SERVE_URL: 'https://worker.example.com/openjarvis',
        MCP_SHARED_MCP_URL: 'https://worker.example.com/mcp',
      },
    });

    expect(gcpNative.available).toBe(true);
    expect(gcpNative.wired_surface_count).toBe(6);
    expect(gcpNative.openjarvis_remote_preferred).toBe(true);
    expect(gcpNative.shared_mcp_remote_preferred).toBe(true);
  });

  it('accepts legacy worker aliases, indexing ingress, and direct URLs for the GCP lane', () => {
    const gcpNative = buildGcpNativeAutopilotContext({
      operatingBaseline: {
        gcpWorker: {
          instanceName: 'instance-1',
          machineType: 'e2-medium',
        },
        services: {
          implementWorker: {
            envKey: 'MCP_IMPLEMENT_WORKER_URL',
            legacyEnvKey: 'MCP_OPENCODE_WORKER_URL',
            url: 'https://worker.example.com',
            directUrl: 'http://34.56.232.61:8787',
          },
          architectWorker: {
            envKey: 'MCP_ARCHITECT_WORKER_URL',
            legacyEnvKey: 'MCP_OPENDEV_WORKER_URL',
            url: 'https://worker.example.com/architect',
          },
          reviewWorker: {
            envKey: 'MCP_REVIEW_WORKER_URL',
            legacyEnvKey: 'MCP_NEMOCLAW_WORKER_URL',
            url: 'https://worker.example.com/review',
          },
          operateWorker: {
            envKey: 'MCP_OPERATE_WORKER_URL',
            legacyEnvKey: 'MCP_OPENJARVIS_WORKER_URL',
            url: 'https://worker.example.com/operate',
          },
          openjarvisServe: {
            envKey: 'OPENJARVIS_SERVE_URL',
            url: 'https://worker.example.com/openjarvis',
            directUrl: 'http://34.56.232.61:8000',
          },
          unifiedMcp: {
            envKey: 'MCP_SHARED_MCP_URL',
            legacyEnvKey: 'OBSIDIAN_REMOTE_MCP_URL',
            indexingEnvKey: 'MCP_INDEXING_REMOTE_URL',
            url: 'https://worker.example.com/mcp',
          },
        },
      },
      env: {
        ACTION_MCP_STRICT_ROUTING: 'true',
        ACTION_MCP_DELEGATION_ENABLED: 'true',
        OPENJARVIS_REQUIRE_OPENCODE_WORKER: 'true',
        OBSIDIAN_REMOTE_MCP_ENABLED: 'true',
        MCP_OPENCODE_WORKER_URL: 'https://worker.example.com',
        MCP_OPENDEV_WORKER_URL: 'https://worker.example.com/architect',
        MCP_NEMOCLAW_WORKER_URL: 'https://worker.example.com/review',
        MCP_OPENJARVIS_WORKER_URL: 'https://worker.example.com/operate',
        OPENJARVIS_SERVE_URL: 'http://34.56.232.61:8000',
        MCP_INDEXING_REMOTE_URL: 'https://worker.example.com/mcp',
      },
    });

    const services = gcpNative.services as Record<string, { env_keys: string[] }>;

    expect(gcpNative.wired_surface_count).toBe(6);
    expect(gcpNative.missing_surfaces).toEqual([]);
    expect(services.implementWorker.env_keys).toEqual([
      'MCP_IMPLEMENT_WORKER_URL',
      'MCP_OPENCODE_WORKER_URL',
    ]);
    expect(services.unifiedMcp.env_keys).toEqual([
      'MCP_SHARED_MCP_URL',
      'OBSIDIAN_REMOTE_MCP_URL',
      'MCP_INDEXING_REMOTE_URL',
    ]);
  });

  it('treats a healthy released session at the wait boundary as target-reached waiting state', () => {
    const capacity = buildAutopilotCapacity({
      target: 90,
      workflow: {
        status: 'released',
      },
      launch: {
        manifest_path: 'tmp/autonomy/launches/latest.json',
        log_path: 'tmp/autonomy/launches/latest.log',
        runner_pid: 100,
        runner_alive: false,
        monitor_pid: 200,
        monitor_alive: true,
        continuous_loop: true,
        vscode_bridge: { ok: true },
      },
      supervisor: {
        status: 'stopped',
        launches_completed: 1,
        last_launch: { ok: true },
      },
      result: {
        final_status: 'pass',
        failed_steps: 0,
        stale_execution_suspected: false,
      },
      resume_state: {
        available: true,
        resumable: false,
        reason: 'packet_waiting_for_next_gpt_objective',
        owner: 'human',
        mode: 'waiting',
        safe_queue: ['refresh packet state'],
        handoff_packet_path: 'handoff.md',
        progress_packet_path: 'progress.md',
      },
      continuity_packets: {
        final_sync: {
          obsidian_healthy: true,
          obsidian_issues: [],
        },
      },
      vscode_cli: {
        last_auto_open: { ok: true },
      },
      gcp_native: {
        available: true,
        required_surface_count: 6,
        wired_surface_count: 6,
        remote_surface_count: 6,
        missing_surfaces: [],
        strict_routing_enabled: true,
        delegation_enabled: true,
        opencode_worker_required: true,
        obsidian_remote_mcp_enabled: true,
        local_ollama_enabled: true,
        openjarvis_remote_preferred: true,
        shared_mcp_remote_preferred: true,
      },
    });

    expect(capacity.score).toBeGreaterThanOrEqual(90);
    expect(capacity.reached).toBe(true);
    expect(capacity.state).toBe('waiting');
    expect(capacity.loop_action).toBe('wait');
    expect(capacity.primary_reason).toBe('capacity_target_reached_waiting_for_next_gpt_objective');
    expect(capacity.gcp_native?.score).toBe(100);
    expect(buildAutopilotCapacitySectionLines(capacity)).toContain('reached: true');
  });

  it('flags stale or failed execution as a blocked low-capacity state', () => {
    const capacity = buildAutopilotCapacity({
      target: 85,
      workflow: {
        status: 'executing',
      },
      result: {
        final_status: 'fail',
        failed_steps: 2,
        stale_execution_suspected: true,
      },
      resume_state: {
        available: false,
        resumable: false,
        reason: 'escalation_pending-gpt',
        owner: 'gpt',
        mode: 'blocked',
        safe_queue: [],
      },
      continuity_packets: {
        final_sync: {
          obsidian_healthy: false,
          obsidian_issues: ['adapter unavailable'],
        },
      },
    });

    expect(capacity.reached).toBe(false);
    expect(capacity.state).toBe('blocked');
    expect(capacity.loop_action).toBe('escalate');
    expect(capacity.primary_reason).toBe('stale_execution');
    expect(capacity.blockers.join(' ')).toContain('runner is missing');
  });

  it('holds the loop below target when GCP native leverage is still incomplete', () => {
    const capacity = buildAutopilotCapacity({
      target: 80,
      workflow: {
        status: 'released',
      },
      launch: {
        manifest_path: 'tmp/autonomy/launches/latest.json',
        log_path: 'tmp/autonomy/launches/latest.log',
        runner_pid: 100,
        runner_alive: false,
        monitor_pid: 200,
        monitor_alive: true,
        continuous_loop: true,
        vscode_bridge: { ok: true },
      },
      supervisor: {
        status: 'stopped',
        launches_completed: 1,
        last_launch: { ok: true },
      },
      result: {
        final_status: 'pass',
        failed_steps: 0,
        stale_execution_suspected: false,
      },
      resume_state: {
        available: true,
        resumable: true,
        reason: null,
        owner: 'hermes',
        mode: 'observing',
        safe_queue: ['continue bounded work'],
        handoff_packet_path: 'handoff.md',
        progress_packet_path: 'progress.md',
      },
      continuity_packets: {
        final_sync: {
          obsidian_healthy: true,
          obsidian_issues: [],
        },
      },
      gcp_native: {
        available: true,
        required_surface_count: 6,
        wired_surface_count: 2,
        remote_surface_count: 3,
        missing_surfaces: ['architectWorker', 'reviewWorker', 'operateWorker', 'openjarvisServe'],
        strict_routing_enabled: true,
        delegation_enabled: true,
        opencode_worker_required: true,
        obsidian_remote_mcp_enabled: true,
        local_ollama_enabled: true,
        openjarvis_remote_preferred: false,
        shared_mcp_remote_preferred: true,
      },
    });

    expect(capacity.reached).toBe(false);
    expect(capacity.loop_action).toBe('continue');
    expect(capacity.primary_reason).toBe('gcp_openjarvis_serve_not_remote');
    expect(capacity.gcp_native?.score).toBeLessThan(80);
    expect(capacity.blockers.join(' ')).toContain('OpenJarvis serve still prefers a local-only surface');
  });

  it('continues past the normal wait boundary when the operator requests GCP capacity recovery', () => {
    const capacity = buildAutopilotCapacity({
      target: 90,
      workflow: {
        status: 'released',
      },
      launch: {
        manifest_path: 'tmp/autonomy/launches/latest.json',
        log_path: 'tmp/autonomy/launches/latest.log',
        runner_pid: 100,
        runner_alive: false,
        monitor_pid: 200,
        monitor_alive: true,
        continuous_loop: true,
        vscode_bridge: { ok: true },
      },
      supervisor: {
        status: 'stopped',
        launches_completed: 2,
        last_launch: { ok: true },
      },
      result: {
        final_status: 'pass',
        failed_steps: 0,
        stale_execution_suspected: false,
      },
      resume_state: {
        available: true,
        resumable: false,
        reason: 'packet_waiting_for_next_gpt_objective',
        owner: 'human',
        mode: 'waiting',
        gcp_capacity_recovery_requested: true,
        safe_queue: ['continue bounded work'],
        handoff_packet_path: 'handoff.md',
        progress_packet_path: 'progress.md',
      },
      gcp_capacity_recovery_requested: true,
      continuity_packets: {
        final_sync: {
          obsidian_healthy: true,
          obsidian_issues: [],
        },
      },
      gcp_native: {
        available: true,
        required_surface_count: 6,
        wired_surface_count: 2,
        remote_surface_count: 3,
        missing_surfaces: ['architectWorker', 'reviewWorker', 'operateWorker', 'openjarvisServe'],
        strict_routing_enabled: true,
        delegation_enabled: true,
        opencode_worker_required: true,
        obsidian_remote_mcp_enabled: true,
        local_ollama_enabled: true,
        openjarvis_remote_preferred: false,
        shared_mcp_remote_preferred: true,
      },
    });

    expect(capacity.reached).toBe(false);
    expect(capacity.loop_action).toBe('continue');
    expect(capacity.state).toBe('recovering');
    expect(capacity.gcp_capacity_recovery_requested).toBe(true);
    expect(capacity.primary_reason).toBe('gcp_openjarvis_serve_not_remote');
    expect(buildAutopilotCapacitySectionLines(capacity)).toContain('gcp_capacity_recovery_requested: true');
  });

  it('normalizes capacity target boundaries', () => {
    expect(normalizeCapacityTarget('0')).toBe(1);
    expect(normalizeCapacityTarget('500')).toBe(100);
    expect(normalizeCapacityTarget('')).toBe(90);
  });
});