import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const { workstationAdapter } = await import('./workstationAdapter');
const { execFile } = await import('node:child_process');
const mockExecFile = vi.mocked(execFile);

describe('workstationAdapter', () => {
  let tempRoot = '';
  let cwdSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'workstation-adapter-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempRoot);
    vi.clearAllMocks();
    mockExecFile.mockImplementation(((_command: string, _args: unknown, _options: unknown, callback?: ((err: Error | null, result: { stdout: string; stderr: string }) => void)) => {
      const cb = typeof _options === 'function' ? _options : callback;
      const options = (typeof _options === 'object' && _options !== null ? _options : undefined) as { env?: Record<string, string> } | undefined;
      if (options?.env?.WORKSTATION_COMMAND) {
        cb?.(null, {
          stdout: JSON.stringify({
            stdout: 'command output',
            stderr: '',
            exitCode: 0,
          }),
          stderr: '',
        });
        return {} as never;
      }
      cb?.(null, { stdout: 'ok\n', stderr: '' });
      return {} as never;
    }) as never);
  });

  afterEach(async () => {
    cwdSpy?.mockRestore();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('writes, lists, and reads workspace-scoped files', async () => {
    const writeResult = await workstationAdapter.execute('file.write', {
      path: 'notes/test.txt',
      content: 'hello workstation',
    });

    expect(writeResult.ok).toBe(true);
    expect(writeResult.summary).toContain('notes/test.txt');

    const fileStatus = await stat(path.join(tempRoot, 'notes', 'test.txt'));
    expect(fileStatus.isFile()).toBe(true);

    const listResult = await workstationAdapter.execute('file.list', { path: 'notes' });
    expect(listResult.ok).toBe(true);
    expect(listResult.output).toContain('file notes/test.txt (17 bytes)');

    const readResult = await workstationAdapter.execute('file.read', { path: 'notes/test.txt' });
    expect(readResult.ok).toBe(true);
    expect(readResult.output).toEqual(['hello workstation']);

    const persisted = await readFile(path.join(tempRoot, 'notes', 'test.txt'), 'utf8');
    expect(persisted).toBe('hello workstation');
  });

  it('rejects file paths outside the workspace root', async () => {
    const result = await workstationAdapter.execute('file.read', { path: '../outside.txt' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('INVALID_PATH');
  });

  it('opens browser URLs through PowerShell Start-Process', async () => {
    const result = await workstationAdapter.execute('browser.open', {
      url: 'https://example.com',
    });

    expect(result.ok).toBe(true);

    const call = mockExecFile.mock.calls.at(0);
    expect(call?.[1]).toEqual(expect.arrayContaining(['-Command']));
    const options = call?.[2] as { env?: Record<string, string> } | undefined;
    expect(options?.env?.WORKSTATION_URL).toBe('https://example.com');
  });

  it('executes bounded local commands inside the workspace', async () => {
    const result = await workstationAdapter.execute('command.exec', {
      command: 'git',
      args: ['status'],
      cwd: 'notes',
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('git');
    expect(result.output).toContain('command output');
    expect(result.output).toContain('cwd=notes');
    expect(result.output).toContain('exitCode=0');

    const call = mockExecFile.mock.calls.at(0);
    const options = call?.[2] as { env?: Record<string, string> } | undefined;
    expect(options?.env?.WORKSTATION_COMMAND).toBe('git');
    expect(options?.env?.WORKSTATION_ARGS_JSON).toBe('["status"]');
    expect(options?.env?.WORKSTATION_CWD).toBe(path.join(tempRoot, 'notes'));
  });

  it('captures screenshots inside the workspace tmp folder', async () => {
    const result = await workstationAdapter.execute('screen.capture', {});

    expect(result.ok).toBe(true);
    expect(result.output[0]).toContain('tmp/workstation-captures/capture-');

    const call = mockExecFile.mock.calls.at(0);
    const options = call?.[2] as { env?: Record<string, string> } | undefined;
    expect(options?.env?.WORKSTATION_CAPTURE_PATH).toContain(path.join(tempRoot, 'tmp', 'workstation-captures'));
  });

  it('launches desktop apps with a bounded argument list', async () => {
    const result = await workstationAdapter.execute('app.launch', {
      target: 'notepad.exe',
      args: ['README.md'],
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('notepad.exe');

    const call = mockExecFile.mock.calls.at(0);
    const options = call?.[2] as { env?: Record<string, string> } | undefined;
    expect(options?.env?.WORKSTATION_APP).toBe('notepad.exe');
    expect(options?.env?.WORKSTATION_ARGS_JSON).toBe('["README.md"]');
  });

  it('activates windows and sends text or hotkeys to the active target', async () => {
    const activateResult = await workstationAdapter.execute('app.activate', {
      target: 'Untitled - Notepad',
    });
    expect(activateResult.ok).toBe(true);

    const textResult = await workstationAdapter.execute('input.text', {
      target: 'Untitled - Notepad',
      text: 'hello + world',
    });
    expect(textResult.ok).toBe(true);

    const hotkeyResult = await workstationAdapter.execute('input.hotkey', {
      target: 'Untitled - Notepad',
      combo: 'ctrl+l',
    });
    expect(hotkeyResult.ok).toBe(true);

    const activateCall = mockExecFile.mock.calls.at(0);
    const activateOptions = activateCall?.[2] as { env?: Record<string, string> } | undefined;
    expect(activateOptions?.env?.WORKSTATION_WINDOW_TARGET).toBe('Untitled - Notepad');

    const textCall = mockExecFile.mock.calls.at(1);
    const textOptions = textCall?.[2] as { env?: Record<string, string> } | undefined;
    expect(textOptions?.env?.WORKSTATION_WINDOW_TARGET).toBe('Untitled - Notepad');
    expect(textOptions?.env?.WORKSTATION_SEND_KEYS).toBe('hello {+} world');

    const hotkeyCall = mockExecFile.mock.calls.at(2);
    const hotkeyOptions = hotkeyCall?.[2] as { env?: Record<string, string> } | undefined;
    expect(hotkeyOptions?.env?.WORKSTATION_WINDOW_TARGET).toBe('Untitled - Notepad');
    expect(hotkeyOptions?.env?.WORKSTATION_SEND_KEYS).toBe('^l');
  });
});