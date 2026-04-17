import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10_000,
    pool: 'forks',
    fileParallelism: true,
    coverage: {
      provider: 'v8',
      include: ['src/services/**/*.ts', 'src/discord/**/*.ts'],
      exclude: ['**/*.test.ts', '**/types.ts'],
      reporter: ['text', 'lcov'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'sprint',
          include: ['src/services/sprint/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'skills',
          include: ['src/services/skills/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'agent',
          include: ['src/services/agent/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'langgraph',
          include: ['src/services/langgraph/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'discord',
          include: [
            'src/discord/**/*.test.ts',
            'src/services/discord-support/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'obsidian',
          include: ['src/services/obsidian/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'news',
          include: ['src/services/news/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'runtime',
          include: [
            'src/services/runtime/**/*.test.ts',
            'src/services/runtime-alerts/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'eval',
          include: ['src/services/eval/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'infra',
          include: [
            'src/services/tools/**/*.test.ts',
            'src/services/infra/**/*.test.ts',
            'src/services/automation/**/*.test.ts',
            'src/services/openjarvis/**/*.test.ts',
            'src/services/opencode/**/*.test.ts',
            'src/services/workflow/**/*.test.ts',
            'src/services/workerGeneration/**/*.test.ts',
            'src/services/observer/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'routes',
          include: [
            'src/routes/**/*.test.ts',
            'src/middleware/**/*.test.ts',
            'src/mcp/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'core',
          include: [
            'scripts/**/*.test.ts',
            'src/services/*.test.ts',
            'src/services/intent/**/*.test.ts',
            'src/services/llm/**/*.test.ts',
            'src/utils/**/*.test.ts',
            'src/config.test.ts',
            'src/services/memory/**/*.test.ts',
            'src/services/observability/**/*.test.ts',
            'src/services/openclaw/**/*.test.ts',
            'src/services/security/**/*.test.ts',
            'src/services/trading/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'smoke',
          include: ['src/**/*.smoke.test.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
