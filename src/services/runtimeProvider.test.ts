import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initializeRuntime,
  resetRuntime,
  RuntimeProvider,
  isRuntimeInitialized,
} from './runtimeProvider';
import type { RuntimeConfig } from './runtimeProvider';

const mockConfig: RuntimeConfig = {
  messaging: {
    send: async () => {},
    isReady: () => true,
  },
  storage: {
    getClient: () => { throw new Error('not configured'); },
    isConfigured: () => false,
  },
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  surface: 'discord-bot',
};

describe('RuntimeProvider', () => {
  beforeEach(() => {
    resetRuntime();
  });

  afterEach(() => {
    resetRuntime();
  });

  it('starts uninitialized', () => {
    expect(isRuntimeInitialized()).toBe(false);
    expect(RuntimeProvider.initialized).toBe(false);
  });

  it('initializes and exposes subsystems', () => {
    initializeRuntime(mockConfig);
    expect(isRuntimeInitialized()).toBe(true);
    expect(RuntimeProvider.surface).toBe('discord-bot');
    expect(RuntimeProvider.messaging.isReady()).toBe(true);
    expect(RuntimeProvider.storage.isConfigured()).toBe(false);
  });

  it('throws on double initialization', () => {
    initializeRuntime(mockConfig);
    expect(() => initializeRuntime(mockConfig)).toThrow('already initialized');
  });

  it('throws when accessed without initialization', () => {
    expect(() => RuntimeProvider.messaging).toThrow('not initialized');
  });

  it('reset allows re-initialization', () => {
    initializeRuntime(mockConfig);
    resetRuntime();
    expect(isRuntimeInitialized()).toBe(false);
    initializeRuntime({ ...mockConfig, surface: 'express-api' });
    expect(RuntimeProvider.surface).toBe('express-api');
  });
});
