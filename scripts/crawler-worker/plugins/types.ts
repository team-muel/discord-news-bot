export type CommunityPost = {
  source: string;
  title: string;
  url: string;
  excerpt?: string;
  score?: number;
};

export type CommunitySearchParams = {
  query: string;
  limit: number;
};

export type CommunityPlugin = {
  id: string;
  description: string;
  search: (params: CommunitySearchParams) => Promise<CommunityPost[]>;
};
