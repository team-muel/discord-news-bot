import type { ChatInputCommandInteraction } from 'discord.js';
import { DISCORD_MESSAGES } from '../messages';
import { buildUserCard, EMBED_INFO, EMBED_WARN, EMBED_ERROR } from '../ui';
import { ensureFeatureAccess } from '../auth';
import type { ObsidianTask } from '../../services/obsidian/types';

type TasksDeps = {
  listObsidianTasksWithAdapter: () => Promise<ObsidianTask[]>;
  toggleObsidianTaskWithAdapter: (filePath: string, line: number) => Promise<boolean>;
  getErrorMessage: (error: unknown) => string;
};

// Session-scoped task cache for the toggle flow
const recentTaskLists = new Map<string, ObsidianTask[]>();

export const createTasksHandlers = (deps: TasksDeps) => {
  const handleTasksListCommand = async (interaction: ChatInputCommandInteraction) => {
    const access = await ensureFeatureAccess(interaction);
    if (!access.ok && access.reason === 'guild_only') {
      await interaction.reply({
        ...buildUserCard(DISCORD_MESSAGES.tasks.titleError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN),
        ephemeral: true,
      });
      return;
    }
    if (!access.ok) {
      await interaction.reply({
        ...buildUserCard(DISCORD_MESSAGES.tasks.titleError, DISCORD_MESSAGES.subscribe.loginRequired, EMBED_WARN),
        ephemeral: true,
      });
      return;
    }

    const vis = interaction.options.getString('공개범위') || 'private';
    await interaction.deferReply({ ephemeral: vis !== 'public' });

    let tasks: ObsidianTask[];
    try {
      tasks = await deps.listObsidianTasksWithAdapter();
    } catch (error) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.tasks.titleError, deps.getErrorMessage(error), EMBED_ERROR));
      return;
    }

    if (tasks.length === 0) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.tasks.titleList, DISCORD_MESSAGES.tasks.noTasks, EMBED_INFO));
      return;
    }

    // Cache tasks for toggle reference
    const userId = interaction.user.id;
    recentTaskLists.set(userId, tasks);

    const doneCount = tasks.filter((t) => t.completed).length;
    const lines: string[] = [
      DISCORD_MESSAGES.tasks.listHeader(tasks.length, doneCount),
      '',
    ];

    // Show up to 20 tasks (undone first, then done)
    const sorted = [...tasks].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return 0;
    });

    sorted.slice(0, 20).forEach((task, idx) => {
      const file = task.filePath.split('/').pop() || task.filePath;
      lines.push(DISCORD_MESSAGES.tasks.taskLine(idx + 1, task.text.slice(0, 80), task.completed, file));
    });

    if (tasks.length > 20) {
      lines.push('', `...외 ${tasks.length - 20}개`);
    }

    await interaction.editReply(buildUserCard(DISCORD_MESSAGES.tasks.titleList, lines.join('\n').slice(0, 4000), EMBED_INFO));
  };

  const handleTasksToggleCommand = async (interaction: ChatInputCommandInteraction) => {
    const access = await ensureFeatureAccess(interaction);
    if (!access.ok) {
      await interaction.reply({
        ...buildUserCard(DISCORD_MESSAGES.tasks.titleError, DISCORD_MESSAGES.subscribe.loginRequired, EMBED_WARN),
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const taskNum = interaction.options.getInteger('번호', true);
    const userId = interaction.user.id;
    const cached = recentTaskLists.get(userId);

    if (!cached || cached.length === 0) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.tasks.titleError, '/할일 목록을 먼저 실행해주세요.', EMBED_WARN));
      return;
    }

    // Sort same way as display (undone first)
    const sorted = [...cached].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return 0;
    });

    const idx = taskNum - 1;
    if (idx < 0 || idx >= sorted.length) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.tasks.titleError, `번호 ${taskNum}에 해당하는 할일이 없습니다.`, EMBED_WARN));
      return;
    }

    const target = sorted[idx];

    try {
      const ok = await deps.toggleObsidianTaskWithAdapter(target.filePath, target.line);
      if (ok) {
        // Clear cache so next list is fresh
        recentTaskLists.delete(userId);
        await interaction.editReply(
          buildUserCard(DISCORD_MESSAGES.tasks.titleToggled, DISCORD_MESSAGES.tasks.toggleSuccess(target.text.slice(0, 80)), EMBED_INFO),
        );
      } else {
        await interaction.editReply(buildUserCard(DISCORD_MESSAGES.tasks.titleError, DISCORD_MESSAGES.tasks.toggleFailed, EMBED_WARN));
      }
    } catch (error) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.tasks.titleError, deps.getErrorMessage(error), EMBED_ERROR));
    }
  };

  return { handleTasksListCommand, handleTasksToggleCommand };
};
