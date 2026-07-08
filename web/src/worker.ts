import type { Env, CliChallenge, Session } from "./types";
import { billingCheckout, billingPortal, polarWebhook, userRecord } from "./billing";
import { gatewayBalance, gatewayChat } from "./gateway";
import { driveCallback, driveConnect, driveFile, driveList, driveStatus } from "./drive";
import { metaCallback, metaConnect, metaGraph, metaStatus } from "./meta";
import { ledgerBalance } from "./ledger";
export { CreditLedger } from "./ledger";
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
    return redirect(`${env.SITE_URL}/app/?error=${encodeURIComponent(oauthErr)}`);
  }
  if (!code || !state) {
    return redirect(`${env.SITE_URL}/app/?error=${encodeURIComponent("missing code or state")}`);
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
      const msg = oauthError(tokens.error) || "token exchange failed";
      return redirect(`${env.SITE_URL}/app/?error=${encodeURIComponent(msg)}`);
    }

    const accessToken = String(tokens.access_token || "");
    if (!accessToken) {
      return redirect(`${env.SITE_URL}/app/?error=${encodeURIComponent("no access_token")}`);
    }

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const profile = (await profileRes.json()) as Record<string, string>;
    if (!profileRes.ok || !profile.email) {
      return redirect(`${env.SITE_URL}/app/?error=${encodeURIComponent("profile fetch failed")}`);
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
      return redirect(`${env.SITE_URL}/app/?cli=connected`);
    }

    return new Response(null, {
      status: 302,
      headers: {
        location: `${env.SITE_URL}/app/`,
        "set-cookie": sessionCookie(sealed),
      },
    });
  } catch (e) {
    console.error("googleCallback", e);
    const msg = e instanceof Error ? e.message : String(e);
    return redirect(`${env.SITE_URL}/app/?error=${encodeURIComponent(msg)}`);
  }
}

async function authMe(req: Request, env: Env): Promise<Response> {
  const session = await openSession(env, req);
  if (!session) return json({ ok: true, signedIn: false });
  const record = await userRecord(env, session.email);
  const credits = await ledgerBalance(env.LEDGER, session.email);
  return json({
    ok: true,
    signedIn: true,
    user: {
      email: session.email,
      name: session.name,
      picture: session.picture,
      plan: record.plan,
      credits,
    },
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
  });
}

async function downloadDmg(_req: Request, env: Env): Promise<Response> {
  const obj = await env.DOWNLOADS.get("Reactable.dmg");
  if (!obj) {
    return json({ ok: false, error: "Reactable.dmg not found in R2" }, { status: 404 });
  }
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("content-type", "application/x-apple-diskimage");
  headers.set("content-disposition", 'attachment; filename="Reactable.dmg"');
  headers.set("cache-control", "public, max-age=3600");
  return new Response(obj.body, { headers });
}

// Serve a mirrored model file from R2 with HTTP Range support (resumable multi-GB).
async function downloadModel(req: Request, env: Env, key: string): Promise<Response> {
  const range = req.headers.get("range");
  const parsed = range?.match(/bytes=(\d+)-(\d*)/);
  const opts = parsed
    ? { range: { offset: Number(parsed[1]), length: parsed[2] ? Number(parsed[2]) - Number(parsed[1]) + 1 : undefined } }
    : {};

  const obj = await env.DOWNLOADS.get(key, opts as R2GetOptions);
  if (!obj) return json({ ok: false, error: `not found: ${key}` }, { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=86400");
  const total = obj.size;

  if (parsed && obj.range) {
    const start = (obj.range as { offset: number }).offset ?? 0;
    const len = (obj.range as { length?: number }).length ?? total - start;
    headers.set("content-range", `bytes ${start}-${start + len - 1}/${total}`);
    headers.set("content-length", String(len));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(total));
  return new Response(obj.body, { headers });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handle(req, env, ctx);
    } catch (e) {
      console.error("worker fetch", e);
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  },
};

async function handle(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/api/health") return json({ ok: true, service: "reactable-web" });
  if (path === "/api/auth/login" && req.method === "GET") return googleLogin(req, env);
  if (path === "/api/auth/callback" && req.method === "GET") return googleCallback(req, env);
  if (path === "/api/auth/me" && req.method === "GET") return authMe(req, env);
  if (path === "/api/auth/logout" && req.method === "GET") return authLogout(req, env);
  if (path === "/api/auth/cli/start" && req.method === "POST") return cliStart(req, env);
  if (path === "/api/webhooks/polar" && req.method === "POST") return polarWebhook(req, env);
  if ((path === "/api/billing/checkout" || path === "/pro") && req.method === "GET") {
    const session = await openSession(env, req);
    if (!session) {
      return new Response(null, {
        status: 302,
        headers: { location: `/api/auth/login?next=${encodeURIComponent("/pro")}` },
      });
    }
    return billingCheckout(session.email, env);
  }
  // Pro integrations: signed-in + pro plan. The callback is unauthenticated
  // by nature (state carries the binding).
  if (path === "/api/drive/callback" && req.method === "GET") return driveCallback(req, env);
  if (path === "/api/meta/callback" && req.method === "GET") return metaCallback(req, env);
  if (path.startsWith("/api/meta/") && req.method === "GET") {
    const session = await openSession(env, req);
    if (!session) return json({ ok: false, error: "sign in first" }, { status: 401 });
    const record = await userRecord(env, session.email);
    if (record.plan !== "pro") {
      return json({ ok: false, error: "Meta is part of Pro", upgrade: "/pro" }, { status: 402 });
    }
    if (path === "/api/meta/connect") return metaConnect(session.email, env);
    if (path === "/api/meta/status") return metaStatus(session.email, env);
    if (path === "/api/meta/graph") return metaGraph(session.email, req, env);
  }
  if (path.startsWith("/api/drive/") && req.method === "GET") {
    const session = await openSession(env, req);
    if (!session) return json({ ok: false, error: "sign in first" }, { status: 401 });
    const record = await userRecord(env, session.email);
    if (record.plan !== "pro") {
      return json({ ok: false, error: "Drive is part of Pro", upgrade: "/pro" }, { status: 402 });
    }
    if (path === "/api/drive/connect") return driveConnect(session.email, env);
    if (path === "/api/drive/status") return driveStatus(session.email, env);
    if (path === "/api/drive/files") return driveList(session.email, req, env);
    if (path === "/api/drive/file") return driveFile(session.email, req, env);
  }
  // Post-checkout / post-connect landing pages (tiny, self-contained).
  if ((path === "/pro/welcome" || path === "/connected") && req.method === "GET") {
    const service = url.searchParams.get("service");
    const title = path === "/pro/welcome" ? "You're Pro" : `${(service || "Account")[0].toUpperCase()}${(service || "account").slice(1)} connected`;
    const sub = path === "/pro/welcome"
      ? "Your plan is active. Head back to the Reactable app — the coin's waiting."
      : "All set. You can close this tab and go back to the Reactable app.";
    return new Response(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Reactable</title><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#141414;color:#e7e7e7;font:15px/1.5 ui-sans-serif,system-ui"><div style="text-align:center;max-width:420px;padding:24px"><div style="font-size:34px;margin-bottom:10px">✦</div><h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="color:#9a9a9a;margin:0">${sub}</p></div></body>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  // Ops: credit grants, keyed by ADMIN_KEY (wrangler secret) — no UI.
  if (path === "/api/admin/grant" && req.method === "POST") {
    const auth = req.headers.get("authorization") || "";
    if (!env.ADMIN_KEY || auth !== `Bearer ${env.ADMIN_KEY}`) {
      return json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    const body = (await req.json()) as { email?: string; credits?: number };
    if (!body.email || !body.credits) return json({ ok: false, error: "email and credits required" }, { status: 400 });
    const { ledgerApply } = await import("./ledger");
    const balance = await ledgerApply(env.LEDGER, body.email, "grant", body.credits, "admin-grant");
    return json({ ok: true, balance });
  }
  if (path === "/api/gateway/chat" && req.method === "POST") {
    const session = await openSession(env, req);
    if (!session) return json({ ok: false, error: "sign in first" }, { status: 401 });
    return gatewayChat(session.email, req, env, ctx);
  }
  if (path === "/api/gateway/balance" && req.method === "GET") {
    const session = await openSession(env, req);
    if (!session) return json({ ok: false, error: "sign in first" }, { status: 401 });
    return gatewayBalance(session.email, env);
  }
  if (path === "/api/billing/portal" && req.method === "GET") {
    const session = await openSession(env, req);
    if (!session) return json({ ok: false, error: "sign in first" }, { status: 401 });
    return billingPortal(session.email, env);
  }
  if (path === "/api/auth/cli/poll" && req.method === "POST") return cliPoll(req, env);
  if (path === "/api/download" && req.method === "GET") return downloadInfo(req, env);
  if (path === "/download/Reactable.dmg" && req.method === "GET") return downloadDmg(req, env);
  if (path.startsWith("/download/models/") && req.method === "GET") {
    return downloadModel(req, env, "models/" + path.slice("/download/models/".length));
  }
  if (path === "/api/youtube/connect" && req.method === "GET") return youtubeConnect(req, env);
  if (path === "/api/youtube/callback" && req.method === "GET") return youtubeCallback(req, env);
  if (path === "/api/youtube/status" && req.method === "GET") return youtubeStatus(req, env);
  if (path === "/api/youtube/search" && req.method === "GET") return youtubeSearch(req, env);
  if (path === "/api/youtube/proxy" && req.method === "GET") return youtubeProxy(req, env);

  if (path === "/app.html") {
    return redirect(`${env.SITE_URL}/app/`);
  }

  return env.ASSETS.fetch(req);
}
