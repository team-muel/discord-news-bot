import type { CommunityPlugin } from './types';

export const stubCommunityPlugin: CommunityPlugin = {
  id: 'stub',
  description: 'Fallback stub plugin when no real community source returns data.',
  search: async ({ query }) => {
    return [
      {
        source: 'stub',
        title: `No live community source result (query=${query})`,
        url: 'https://example.invalid/community-stub',
        excerpt: '커뮤니티 소스 미응답 시 반환되는 스텁 결과입니다.',
      },
    ];
  },
};
