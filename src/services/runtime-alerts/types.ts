export type AlertTags = Record<string, string>;

export type EmitAlert = (params: {
  key: string;
  title: string;
  message: string;
  tags?: AlertTags;
}) => Promise<void>;
