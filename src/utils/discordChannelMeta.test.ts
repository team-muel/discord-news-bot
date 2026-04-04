import { describe, it, expect } from 'vitest';
import { ChannelType } from 'discord.js';
import {
  resolveChannelMeta,
  isThreadChannel,
  isForumChannel,
  channelDisplayPrefix,
  parentLabel,
  buildChannelTags,
  buildSourceRef,
} from './discordChannelMeta';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeChannel = (overrides: Record<string, unknown> = {}) => ({
  id: '123456789',
  name: 'general',
  type: ChannelType.GuildText,
  parent: null,
  ...overrides,
});

// ─── isThreadChannel ──────────────────────────────────────────────────────────

describe('isThreadChannel', () => {
  it('returns true for PublicThread', () => {
    expect(isThreadChannel(ChannelType.PublicThread)).toBe(true);
  });

  it('returns true for PrivateThread', () => {
    expect(isThreadChannel(ChannelType.PrivateThread)).toBe(true);
  });

  it('returns true for AnnouncementThread', () => {
    expect(isThreadChannel(ChannelType.AnnouncementThread)).toBe(true);
  });

  it('returns false for GuildText', () => {
    expect(isThreadChannel(ChannelType.GuildText)).toBe(false);
  });

  it('returns false for GuildForum', () => {
    expect(isThreadChannel(ChannelType.GuildForum)).toBe(false);
  });

  it('returns false for GuildCategory', () => {
    expect(isThreadChannel(ChannelType.GuildCategory)).toBe(false);
  });
});

// ─── isForumChannel ───────────────────────────────────────────────────────────

describe('isForumChannel', () => {
  it('returns true for GuildForum', () => {
    expect(isForumChannel(ChannelType.GuildForum)).toBe(true);
  });

  it('returns true for GuildMedia', () => {
    expect(isForumChannel(ChannelType.GuildMedia)).toBe(true);
  });

  it('returns false for GuildText', () => {
    expect(isForumChannel(ChannelType.GuildText)).toBe(false);
  });
});

// ─── resolveChannelMeta ───────────────────────────────────────────────────────

describe('resolveChannelMeta', () => {
  it('resolves a regular text channel', () => {
    const channel = makeChannel({
      parent: { id: '999', name: 'Category A', type: ChannelType.GuildCategory },
    });
    const meta = resolveChannelMeta(channel as any);

    expect(meta.channelId).toBe('123456789');
    expect(meta.channelName).toBe('general');
    expect(meta.channelType).toBe('GuildText');
    expect(meta.isThread).toBe(false);
    expect(meta.isForumPost).toBe(false);
    expect(meta.isPrivateThread).toBe(false);
    expect(meta.parentChannelId).toBe('999');
    expect(meta.parentChannelName).toBe('Category A');
    expect(meta.parentChannelType).toBe('GuildCategory');
  });

  it('resolves a public thread under a text channel', () => {
    const channel = makeChannel({
      id: '111',
      name: 'help-thread',
      type: ChannelType.PublicThread,
      parent: { id: '222', name: 'help-channel', type: ChannelType.GuildText },
    });
    const meta = resolveChannelMeta(channel as any);

    expect(meta.isThread).toBe(true);
    expect(meta.isForumPost).toBe(false);
    expect(meta.isPrivateThread).toBe(false);
    expect(meta.parentChannelId).toBe('222');
    expect(meta.parentChannelName).toBe('help-channel');
  });

  it('resolves a forum post (thread under a forum channel)', () => {
    const channel = makeChannel({
      id: '333',
      name: 'my-forum-post',
      type: ChannelType.PublicThread,
      parent: { id: '444', name: 'feedback-forum', type: ChannelType.GuildForum },
    });
    const meta = resolveChannelMeta(channel as any);

    expect(meta.isThread).toBe(true);
    expect(meta.isForumPost).toBe(true);
    expect(meta.parentChannelId).toBe('444');
    expect(meta.parentChannelType).toBe('GuildForum');
  });

  it('resolves a private thread', () => {
    const channel = makeChannel({
      id: '555',
      name: 'secret-thread',
      type: ChannelType.PrivateThread,
      parent: { id: '666', name: 'team-channel', type: ChannelType.GuildText },
    });
    const meta = resolveChannelMeta(channel as any);

    expect(meta.isThread).toBe(true);
    expect(meta.isPrivateThread).toBe(true);
    expect(meta.isForumPost).toBe(false);
  });

  it('handles channel with no parent', () => {
    const channel = makeChannel({ parent: null });
    const meta = resolveChannelMeta(channel as any);

    expect(meta.parentChannelId).toBeNull();
    expect(meta.parentChannelName).toBeNull();
    expect(meta.parentChannelType).toBeNull();
  });
});

// ─── channelDisplayPrefix ─────────────────────────────────────────────────────

describe('channelDisplayPrefix', () => {
  it('returns # for regular channels', () => {
    const meta = resolveChannelMeta(makeChannel() as any);
    expect(channelDisplayPrefix(meta)).toBe('#');
  });

  it('returns ↳ for threads', () => {
    const meta = resolveChannelMeta(makeChannel({ type: ChannelType.PublicThread }) as any);
    expect(channelDisplayPrefix(meta)).toBe('↳');
  });
});

// ─── parentLabel ──────────────────────────────────────────────────────────────

describe('parentLabel', () => {
  it('returns category= for channel under category', () => {
    const meta = resolveChannelMeta(makeChannel({
      parent: { id: '1', name: 'Cat', type: ChannelType.GuildCategory },
    }) as any);
    expect(parentLabel(meta)).toBe('category=Cat');
  });

  it('returns forum= for forum post', () => {
    const meta = resolveChannelMeta(makeChannel({
      type: ChannelType.PublicThread,
      parent: { id: '1', name: 'MyForum', type: ChannelType.GuildForum },
    }) as any);
    expect(parentLabel(meta)).toBe('forum=MyForum');
  });

  it('returns parent_channel= for thread under text channel', () => {
    const meta = resolveChannelMeta(makeChannel({
      type: ChannelType.PublicThread,
      parent: { id: '1', name: 'general', type: ChannelType.GuildText },
    }) as any);
    expect(parentLabel(meta)).toBe('parent_channel=general');
  });

  it('returns null when no parent', () => {
    const meta = resolveChannelMeta(makeChannel() as any);
    expect(parentLabel(meta)).toBeNull();
  });
});

// ─── buildChannelTags ─────────────────────────────────────────────────────────

describe('buildChannelTags', () => {
  it('returns channel: tag for regular channels', () => {
    const meta = resolveChannelMeta(makeChannel() as any);
    expect(buildChannelTags(meta)).toEqual(['channel:123456789']);
  });

  it('returns thread: and channel: tags for threads with parent', () => {
    const meta = resolveChannelMeta(makeChannel({
      id: '111',
      type: ChannelType.PublicThread,
      parent: { id: '222', name: 'parent', type: ChannelType.GuildText },
    }) as any);
    expect(buildChannelTags(meta)).toEqual(['thread:111', 'channel:222']);
  });

  it('includes forum-post tag for forum posts', () => {
    const meta = resolveChannelMeta(makeChannel({
      id: '333',
      type: ChannelType.PublicThread,
      parent: { id: '444', name: 'forum', type: ChannelType.GuildForum },
    }) as any);
    const tags = buildChannelTags(meta);
    expect(tags).toContain('thread:333');
    expect(tags).toContain('channel:444');
    expect(tags).toContain('forum-post');
  });
});

// ─── buildSourceRef ───────────────────────────────────────────────────────────

describe('buildSourceRef', () => {
  it('builds channel URI for regular channels', () => {
    const meta = resolveChannelMeta(makeChannel() as any);
    const ref = buildSourceRef('g1', meta, 'msg1');
    expect(ref).toBe('discord://guild/g1/channel/123456789/message/msg1');
  });

  it('builds thread URI with parent channel for threads', () => {
    const meta = resolveChannelMeta(makeChannel({
      id: '111',
      type: ChannelType.PublicThread,
      parent: { id: '222', name: 'parent', type: ChannelType.GuildText },
    }) as any);
    const ref = buildSourceRef('g1', meta, 'msg1');
    expect(ref).toBe('discord://guild/g1/channel/222/thread/111/message/msg1');
  });
});
