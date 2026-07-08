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
  POLAR_ACCESS_TOKEN?: string;
  POLAR_WEBHOOK_SECRET?: string;
  POLAR_PRODUCT_PRO?: string;
  POLAR_API?: string;
  SCRAPECREATORS_API_KEY?: string;
  MINIMAX_GATEWAY_KEY?: string;
  LEDGER: DurableObjectNamespace;
}

// Live account state — written by billing webhooks, read by /api/auth/me.
// Sessions seal plan at login; this record is the truth that outlives them.
export interface UserRecord {
  plan: "free" | "pro";
  credits: number;
  polarCustomerId?: string;
  updatedAt: string;
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
  plan: "free" | "pro";
  createdAt: number;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  picture?: string;
  plan: "free" | "pro";
  createdAt: number;
}

export interface CliChallenge {
  deviceCode: string;
  userCode: string;
  state: string;
  expiresAt: number;
  sessionId?: string;
}
