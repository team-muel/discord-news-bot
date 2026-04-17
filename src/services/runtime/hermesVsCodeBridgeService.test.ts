import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockReadObsidianFileWithAdapter,
  mockWriteObsidianNoteWithAdapter,
  mockExecFile,
  mockSpawn,
} = vi.hoisted(() => ({
  mockReadObsidianFileWithAdapter: vi.fn(),
  mockWriteObsidianNoteWithAdapter: vi.fn(),
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('../obsidian/router', () => ({
  readObsidianFileWithAdapter: mockReadObsidianFileWithAdapter,
  writeObsidianNoteWithAdapter: mockWriteObsidianNoteWithAdapter,
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
  spawn: mockSpawn,
}));

const {
  buildHermesVsCodeBridgePowerShellCommand,
  runHermesVsCodeBridge,
} = await import('./hermesVsCodeBridgeService');

const PACKET_TEMPLATE = `---
title: Hermes Local Bootstrap Next Actions
packet_kind: progress
---

# Objective

Bridge runtime validation.

# Evidence And References

- [[HERMES_LOCAL_BOOTSTRAP_HANDOFF_PACKET]]
`;

describe('hermesVsCodeBridgeService', () => {
  const tempDirs: string[] = [];

  it('quotes PowerShell command segments when the VS Code CLI path contains spaces', () => {
    const command = buildHermesVsCodeBridgePowerShellCommand(
      'C:\\Users\\fancy\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd',
      ['-r', '-g', 'C:\\Muel_S\\discord-news-bot\\docs\\planning\\file with spaces.md:56'],
    );

    expect(command).toContain("& 'C:\\Users\\fancy\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd'");
    expect(command).toContain("'C:\\Muel_S\\discord-news-bot\\docs\\planning\\file with spaces.md:56'");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadObsidianFileWithAdapter.mockResolvedValue(PACKET_TEMPLATE);
    mockWriteObsidianNoteWithAdapter.mockResolvedValue({ path: 'plans/execution/HERMES_LOCAL_BOOTSTRAP_NEXT_ACTIONS.md' });
    mockExecFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, '', '');
    });
    mockSpawn.mockImplementation(() => ({
      pid: 4321,
      once(event: string, handler: () => void) {
        if (event === 'spawn') {
          queueMicrotask(handler);
        }
        return this;
      },
      unref() {},
    }));
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const createVaultPacket = (options?: { includeGuiBinary?: boolean }) => {
    const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-vscode-bridge-vault-'));
    tempDirs.push(vaultRoot);
    const packetPath = path.join(vaultRoot, 'plans', 'execution', 'HERMES_LOCAL_BOOTSTRAP_NEXT_ACTIONS.md');
    fs.mkdirSync(path.dirname(packetPath), { recursive: true });
    fs.writeFileSync(packetPath, PACKET_TEMPLATE, 'utf8');
    const codeCliPath = path.join(vaultRoot, 'code.cmd');
    fs.writeFileSync(codeCliPath, '@echo off\n', 'utf8');
    const codeGuiPath = path.join(vaultRoot, 'Code.exe');
    if (options?.includeGuiBinary) {
      fs.writeFileSync(codeGuiPath, '', 'utf8');
    }
    return { vaultRoot, packetPath, codeCliPath, codeGuiPath };
  };

  it('executes a goto action and logs it back to the packet', async () => {
    const { vaultRoot, packetPath, codeCliPath } = createVaultPacket();

    const result = await runHermesVsCodeBridge({
      action: 'goto',
      filePath: packetPath,
      line: 42,
      reason: 'inspect active packet state',
      packetPath,
      codeCliPath,
      vaultPath: vaultRoot,
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe('goto');
    expect(result.completion).toBe('completed');
    expect(result.packetLog.logged).toBe(true);
    expect(mockReadObsidianFileWithAdapter).toHaveBeenCalledWith({
      vaultPath: vaultRoot,
      filePath: 'plans/execution/HERMES_LOCAL_BOOTSTRAP_NEXT_ACTIONS.md',
    });
    expect(mockWriteObsidianNoteWithAdapter).toHaveBeenCalledWith(expect.objectContaining({
      guildId: 'system',
      vaultPath: vaultRoot,
      fileName: 'plans/execution/HERMES_LOCAL_BOOTSTRAP_NEXT_ACTIONS.md',
      skipKnowledgeCompilation: true,
    }));
    const writePayload = mockWriteObsidianNoteWithAdapter.mock.calls[0][0];
    expect(writePayload.content).toContain('hermes_vscode_bridge:');
    expect(writePayload.content).toContain('action=goto');
    expect(result.command).toContain('-r');
    expect(result.command).toContain('-g');
  });

  it('fails closed when the requested target is outside the allowed roots', async () => {
    const { vaultRoot, packetPath, codeCliPath } = createVaultPacket();
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-vscode-bridge-outside-'));
    tempDirs.push(outsideDir);
    const outsideFile = path.join(outsideDir, 'outside.md');
    fs.writeFileSync(outsideFile, '# outside\n', 'utf8');

    const result = await runHermesVsCodeBridge({
      action: 'wait',
      targetPath: outsideFile,
      packetPath,
      codeCliPath,
      vaultPath: vaultRoot,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('VALIDATION');
    expect(result.packetLog.attempted).toBe(false);
  });

  it('queues wait actions instead of blocking the caller', async () => {
    const { vaultRoot, packetPath, codeCliPath } = createVaultPacket();

    const result = await runHermesVsCodeBridge({
      action: 'wait',
      targetPath: packetPath,
      reason: 'pause for human review',
      packetPath,
      codeCliPath,
      vaultPath: vaultRoot,
    });

    expect(result.ok).toBe(true);
    expect(result.completion).toBe('queued');
    expect(result.pid).toBe(4321);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(result.packetLog.logged).toBe(true);
  });

  it('queues a VS Code chat session with prompt and added context files', async () => {
    const { vaultRoot, packetPath, codeCliPath } = createVaultPacket({ includeGuiBinary: true });

    const result = await runHermesVsCodeBridge({
      action: 'chat',
      prompt: 'Continue the next bounded objective using the packet context.',
      chatMode: 'agent',
      addFilePaths: [packetPath],
      maximize: true,
      reuseWindow: true,
      packetPath,
      codeCliPath,
      vaultPath: vaultRoot,
      reason: 'resume the next queued GPT task',
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe('chat');
    expect(result.completion).toBe('queued');
    expect(result.pid).toBe(4321);
    expect(result.command).toContain('chat');
    expect(result.command).toContain('-m');
    expect(result.command).toContain('--maximize');
    expect(result.command).toContain('-a');
    expect(result.command).toContain('Continue the next bounded objective');
    expect(result.command).toContain('Code.exe');
    expect(mockSpawn).toHaveBeenCalledWith(expect.stringContaining('Code.exe'), expect.any(Array), expect.objectContaining({
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }));
    expect(result.packetLog.logged).toBe(true);
  });

  it('allows chat context files from an explicit worktree root', async () => {
    const { vaultRoot, packetPath, codeCliPath } = createVaultPacket({ includeGuiBinary: true });
    const worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-vscode-bridge-worktree-'));
    tempDirs.push(worktreeRoot);
    const worktreeFile = path.join(worktreeRoot, 'src', 'worker.ts');
    fs.mkdirSync(path.dirname(worktreeFile), { recursive: true });
    fs.writeFileSync(worktreeFile, 'export const worker = true;\n', 'utf8');

    const result = await runHermesVsCodeBridge({
      action: 'chat',
      prompt: 'Continue the executor shard inside the isolated worktree.',
      chatMode: 'agent',
      addFilePaths: [worktreeFile],
      allowedRoots: [worktreeRoot],
      maximize: true,
      reuseWindow: true,
      packetPath,
      codeCliPath,
      vaultPath: vaultRoot,
      reason: 'launch executor shard in isolated worktree',
    });

    expect(result.ok).toBe(true);
    expect(result.completion).toBe('queued');
    expect(result.command).toContain(worktreeFile);
    expect(result.packetLog.logged).toBe(true);
  });
});