import type { Env, Session } from "./types";
import { json, oauthClient, openSession, saveSession } from "./auth";

const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
].join(" ");

export async function youtubeConnect(req: Request, env: Env): Promise<Response> {
  const session = await openSession(env, req);
  if (!session) return json({ ok: false, error: "sign in first" }, { status: 401 });

  const { id, secret } = oauthClient(env, "youtube");
  const state = crypto.randomUUID();
  await env.KV.put(`yt_oauth:${state}`, session.id, { expirationTtl: 600 });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", `${env.SITE_URL}/api/youtube/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YT_SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return redirect(url.toString());
}

export async function youtubeCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return json({ ok: false, error: "missing code" }, { status: 400 });

  const sessionId = await env.KV.get(`yt_oauth:${state}`);
  if (!sessionId) return json({ ok: false, error: "expired state" }, { status: 400 });

  const raw = await env.KV.get(`session:${sessionId}`);
  if (!raw) return json({ ok: false, error: "session expired" }, { status: 401 });
  const session = JSON.parse(raw) as Session;

  const { id, secret } = oauthClient(env, "youtube");
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: `${env.SITE_URL}/api/youtube/callback`,
      grant_type: "authorization_code",
    }),
  });
  const tokens = (await tokenRes.json()) as Record<string, unknown>;
  if (!tokenRes.ok) return json({ ok: false, error: tokens.error || "token exchange failed" }, { status: 400 });

  session.youtube = {
    accessToken: String(tokens.access_token),
    refreshToken: String(tokens.refresh_token || session.youtube?.refreshToken || ""),
    expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
  };
  await saveSession(env, session);
  await env.KV.delete(`yt_oauth:${state}`);

  return Response.redirect(`${env.SITE_URL}/app?youtube=connected`, 302);
}

export async function youtubeStatus(req: Request, env: Env): Promise<Response> {
  const session = await openSession(env, req);
  if (!session) return json({ ok: true, connected: false, signedIn: false });
  return json({
    ok: true,
    signedIn: true,
    connected: Boolean(session.youtube?.refreshToken || session.youtube?.accessToken),
    email: session.email,
  });
}

async function refreshYouTubeToken(env: Env, session: Session): Promise<Session> {
  if (!session.youtube?.refreshToken) return session;
  if (session.youtube.expiresAt > Date.now() + 60_000) return session;

  const { id, secret } = oauthClient(env, "youtube");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: session.youtube.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const tokens = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(tokens.error || "refresh failed"));

  session.youtube.accessToken = String(tokens.access_token);
  session.youtube.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
  await saveSession(env, session);
  return session;
}

export async function youtubeSearch(req: Request, env: Env): Promise<Response> {
  const session = await openSession(env, req);
  if (!session?.youtube) return json({ ok: false, error: "connect YouTube first" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q) return json({ ok: false, error: "q required" }, { status: 400 });

  const fresh = await refreshYouTubeToken(env, session);
  const api = new URL("https://www.googleapis.com/youtube/v3/search");
  api.searchParams.set("part", "snippet");
  api.searchParams.set("type", "video");
  api.searchParams.set("maxResults", "12");
  api.searchParams.set("q", q);

  const res = await fetch(api, {
    headers: { authorization: `Bearer ${fresh.youtube!.accessToken}` },
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) return json({ ok: false, error: data.error || "search failed" }, { status: res.status });

  const items = ((data.items as unknown[]) || []).map((row) => {
    const item = row as Record<string, Record<string, string>>;
    const id = item.id?.videoId;
    const sn = item.snippet || {};
    return {
      videoId: id,
      title: sn.title,
      channel: sn.channelTitle,
      thumbnail: sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url,
      publishedAt: sn.publishedAt,
    };
  });

  return json({ ok: true, query: q, items });
}

/** Proxy embed URL for stage preview — agent can iframe this during reaction recording. */
export async function youtubeProxy(req: Request, env: Env): Promise<Response> {
  const session = await openSession(env, req);
  if (!session) return json({ ok: false, error: "sign in required" }, { status: 401 });

  const videoId = new URL(req.url).searchParams.get("v");
  if (!videoId || !/^[a-zA-Z0-9_-]{6,}$/.test(videoId)) {
    return json({ ok: false, error: "invalid video id" }, { status: 400 });
  }

  const start = new URL(req.url).searchParams.get("start") || "0";
  const origin = encodeURIComponent(env.SITE_URL);
  const embed = `https://www.youtube.com/embed/${videoId}?start=${start}&rel=0&modestbranding=1&playsinline=1&origin=${origin}`;

  return json({
    ok: true,
    videoId,
    embed,
    proxyUrl: `${env.SITE_URL}/api/youtube/proxy?v=${videoId}&start=${start}`,
    downloadHint: "Use reactable youtube clip for high-res replacement after recording",
  });
}

function redirect(url: string): Response {
  return Response.redirect(url, 302);
}
