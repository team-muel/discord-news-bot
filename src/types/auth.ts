export type JwtUser = {
  id: string;
  username: string;
  avatar?: string | null;
};

export type AuthenticatedRequestUser = JwtUser;

export type DiscordSdkAuthPayload = {
  code?: string;
};
