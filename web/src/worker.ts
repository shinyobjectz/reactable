import type { Env, CliChallenge, Session } from "./types";
import {
  clearSessionCookie,
  json,
  oauthClient,
  oauthError,
  openSession,
  saveSession,
  sealSession,
  sessionCookie,
  uid,
  redirect,
} from "./auth";
import {
  youtubeCallback,
  youtubeConnect,
  youtubeProxy,
  youtubeSearch,
  youtubeStatus,
} from "./youtube";

const GOOGLE_SCOPES = ["openid", "email", "profile"].join(" ");

async function googleLogin(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const cli = url.searchParams.get("cli") === "1";
    const device = url.searchParams.get("device_code");
    const state = crypto.randomUUID();

    if (cli && device) {
      await env.KV.put(`cli_state:${state}`, device, { expirationTtl: 600 });
    }

    const { id } = oauthClient(env, "google");
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.searchParams.set("client_id", id);
    auth.searchParams.set("redirect_uri", `${env.SITE_URL}/api/auth/callback`);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", GOOGLE_SCOPES);
    auth.searchParams.set("state", state);
    auth.searchParams.set("prompt", "select_account");
    return redirect(auth.toString());
  } catch (e) {
    console.error("googleLogin", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

async function googleCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthErr = url.searchParams.get("error");

  if (oauthErr) {
    return json({ ok: false, error: oauthErr }, { status: 400 });
  }
  if (!code || !state) {
    return json({ ok: false, error: "missing code or state" }, { status: 400 });
  }

  try {
    const { id, secret } = oauthClient(env, "google");
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: id,
        client_secret: secret,
        redirect_uri: `${env.SITE_URL}/api/auth/callback`,
        grant_type: "authorization_code",
      }),
    });
    const tokens = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok) {
      return json({ ok: false, error: oauthError(tokens.error) || "token exchange failed" }, { status: 400 });
    }

    const accessToken = String(tokens.access_token || "");
    if (!accessToken) {
      return json({ ok: false, error: "no access_token in response" }, { status: 400 });
    }

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const profile = (await profileRes.json()) as Record<string, string>;
    if (!profileRes.ok || !profile.email) {
      return json({ ok: false, error: "profile fetch failed" }, { status: 400 });
    }

    const session: Session = {
      id: uid(),
      userId: profile.id || uid(),
      email: profile.email,
      name: profile.name || profile.email,
      picture: profile.picture,
      plan: "free",
      createdAt: Date.now(),
    };
    await saveSession(env, session);
    const sealed = await sealSession(env, session.id);

    const deviceCode = await env.KV.get(`cli_state:${state}`);
    if (deviceCode) {
      await env.KV.put(
        `cli_done:${deviceCode}`,
        JSON.stringify({ sessionId: session.id, email: session.email, token: sealed }),
        { expirationTtl: 300 },
      );
      await env.KV.delete(`cli_state:${state}`);
      return redirect(`${env.SITE_URL}/app?cli=connected`);
    }

    return new Response(null, {
      status: 302,
      headers: {
        location: `${env.SITE_URL}/app`,
        "set-cookie": sessionCookie(sealed),
      },
    });
  } catch (e) {
    console.error("googleCallback", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

async function authMe(req: Request, env: Env): Promise<Response> {
  const session = await openSession(env, req);
  if (!session) return json({ ok: true, signedIn: false });
  return json({
    ok: true,
    signedIn: true,
    user: { email: session.email, name: session.name, picture: session.picture, plan: session.plan },
    youtube: Boolean(session.youtube?.accessToken),
  });
}

async function authLogout(_req: Request, _env: Env): Promise<Response> {
  return new Response(null, {
    status: 302,
    headers: { location: "/", "set-cookie": clearSessionCookie() },
  });
}

async function cliStart(_req: Request, env: Env): Promise<Response> {
  const deviceCode = uid();
  const userCode = deviceCode.slice(0, 8).toUpperCase();
  const challenge: CliChallenge = {
    deviceCode,
    userCode,
    state: crypto.randomUUID(),
    expiresAt: Date.now() + 600_000,
  };
  await env.KV.put(`cli:${deviceCode}`, JSON.stringify(challenge), { expirationTtl: 600 });

  return json({
    ok: true,
    device_code: deviceCode,
    user_code: userCode,
    verification_url: `${env.SITE_URL}/api/auth/login?cli=1&device_code=${deviceCode}`,
    expires_in: 600,
    interval: 3,
  });
}

async function cliPoll(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as { device_code?: string };
  const deviceCode = body.device_code?.trim();
  if (!deviceCode) return json({ ok: false, error: "device_code required" }, { status: 400 });

  const done = await env.KV.get(`cli_done:${deviceCode}`);
  if (!done) return json({ ok: true, pending: true });

  const parsed = JSON.parse(done) as { token: string; email: string; sessionId: string };
  await env.KV.delete(`cli_done:${deviceCode}`);
  await env.KV.delete(`cli:${deviceCode}`);

  return json({
    ok: true,
    pending: false,
    access_token: parsed.token,
    email: parsed.email,
    session_id: parsed.sessionId,
  });
}

async function downloadInfo(_req: Request, env: Env): Promise<Response> {
  return json({
    ok: true,
    platform: "macos",
    version: "0.1.0",
    url: `${env.SITE_URL}/download/Reactable.dmg`,
    note: "Build with `just app` and upload to R2 or GitHub Releases — wire DOWNLOAD_URL in wrangler vars.",
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await handle(req, env);
    } catch (e) {
      console.error("worker fetch", e);
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  },
};

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/api/health") return json({ ok: true, service: "reactable-web" });
  if (path === "/api/auth/login" && req.method === "GET") return googleLogin(req, env);
  if (path === "/api/auth/callback" && req.method === "GET") return googleCallback(req, env);
  if (path === "/api/auth/me" && req.method === "GET") return authMe(req, env);
  if (path === "/api/auth/logout" && req.method === "GET") return authLogout(req, env);
  if (path === "/api/auth/cli/start" && req.method === "POST") return cliStart(req, env);
  if (path === "/api/auth/cli/poll" && req.method === "POST") return cliPoll(req, env);
  if (path === "/api/download" && req.method === "GET") return downloadInfo(req, env);
  if (path === "/api/youtube/connect" && req.method === "GET") return youtubeConnect(req, env);
  if (path === "/api/youtube/callback" && req.method === "GET") return youtubeCallback(req, env);
  if (path === "/api/youtube/status" && req.method === "GET") return youtubeStatus(req, env);
  if (path === "/api/youtube/search" && req.method === "GET") return youtubeSearch(req, env);
  if (path === "/api/youtube/proxy" && req.method === "GET") return youtubeProxy(req, env);

  // SPA routes
  if (path === "/app" || path === "/app/") {
    return env.ASSETS.fetch(new Request(new URL("/app/index.html", url.origin), req));
  }

  return env.ASSETS.fetch(req);
}
