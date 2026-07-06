import { apiBase, PORT } from "./paths.ts";

export type YouTubeStatus = {
  ok: boolean;
  connected: boolean;
  client: boolean;
  error?: string | null;
};

export async function youtubeConnect(port = PORT): Promise<number> {
  const res = await fetch(`${apiBase(port)}/reactable/youtube/connect`, { method: "POST" });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok || body.ok === false) {
    console.error(body.error || "connect failed");
    return 1;
  }
  if (body.connected) {
    console.log("YouTube already connected (~/.shinyobjectz/youtube_token.json)");
    return 0;
  }
  if (body.url) console.log(`If browser did not open:\n  ${body.url}\n`);
  console.log("Waiting for Google sign-in…");

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await youtubeStatus(port);
    if (st.connected) {
      console.log("YouTube connected (same token as studio)");
      return 0;
    }
    if (st.error) {
      console.error(st.error);
      return 1;
    }
  }
  console.error("timed out waiting for YouTube OAuth");
  return 1;
}

export async function youtubeStatus(port = PORT): Promise<YouTubeStatus> {
  const res = await fetch(`${apiBase(port)}/reactable/youtube/status`);
  return (await res.json()) as YouTubeStatus;
}

export async function youtubeDisconnect(port = PORT): Promise<number> {
  const res = await fetch(`${apiBase(port)}/reactable/youtube/disconnect`, { method: "POST" });
  const body = await res.json();
  if (!res.ok || body.ok === false) {
    console.error(body.error || "disconnect failed");
    return 1;
  }
  console.log("YouTube disconnected");
  return 0;
}

export async function youtubeSearch(query: string, json = false, port = PORT): Promise<number> {
  const st = await youtubeStatus(port);
  if (!st.connected) {
    console.error("not connected — run: reactable youtube connect");
    return 1;
  }
  const res = await fetch(`${apiBase(port)}/reactable/youtube/search?q=${encodeURIComponent(query)}`);
  const body = await res.json();
  if (!res.ok || body.ok === false) {
    console.error(body.error || "search failed");
    return 1;
  }
  if (json) {
    console.log(JSON.stringify(body, null, 2));
    return 0;
  }
  for (const item of body.items || []) {
    console.log(`${item.videoId}\t${item.title}\t${item.channel}`);
  }
  return 0;
}

export async function youtubeProxy(videoId: string, start = "0", json = false, port = PORT): Promise<number> {
  const res = await fetch(
    `${apiBase(port)}/reactable/youtube/proxy?v=${encodeURIComponent(videoId)}&start=${encodeURIComponent(start)}`,
  );
  const body = await res.json();
  if (!res.ok || body.ok === false) {
    console.error(body.error || "proxy failed");
    return 1;
  }
  if (json) console.log(JSON.stringify(body, null, 2));
  else {
    console.log(`embed: ${body.embed}`);
    console.log(`stage iframe src: ${body.embed}`);
  }
  return 0;
}

export async function youtubeStatusCmd(json = false, port = PORT): Promise<number> {
  const body = await youtubeStatus(port);
  if (json) console.log(JSON.stringify(body, null, 2));
  else {
    if (!body.client) console.log("missing ~/.shinyobjectz/youtube_client.json");
    else if (body.connected) console.log("YouTube connected · ~/.shinyobjectz/youtube_token.json");
    else console.log(`YouTube not connected${body.error ? ` · ${body.error}` : ""}`);
  }
  return 0;
}
