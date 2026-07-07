export interface Env {
  ASSETS: Fetcher;
  KV: KVNamespace;
  DOWNLOADS: R2Bucket;
  SITE_URL: string;
  APP_NAME: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  YOUTUBE_CLIENT_ID?: string;
  YOUTUBE_CLIENT_SECRET?: string;
  SESSION_SECRET: string;
}

export interface Session {
  id: string;
  userId: string;
  email: string;
  name: string;
  picture?: string;
  youtube?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  };
  plan: "free";
  createdAt: number;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  picture?: string;
  plan: "free";
  createdAt: number;
}

export interface CliChallenge {
  deviceCode: string;
  userCode: string;
  state: string;
  expiresAt: number;
  sessionId?: string;
}
