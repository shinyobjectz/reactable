// Walkthrough DOM-snapshot serializer — run INSIDE the target page (browser
// console, chrome-devtools MCP evaluate_script, or agent-browser). Produces a
// SELF-CONTAINED html string the wavelet renderer can re-render offline:
//   - CSSOM dump = browser-truth styles (media-query state, adopted sheets);
//     original <style>/<link rel=stylesheet> are REMOVED so rules aren't
//     duplicated and invalid-but-served declarations can't resurface
//   - <script> and <base> stripped (no JS in the render; base breaks offline)
//   - <img> with http(s)/relative src inlined as data: URIs (the renderer's
//     net provider is file:/data: only)
//   - body classes/inline styles preserved — state selectors (body.pick etc.)
//     keep working
// Returns { html, vw, vh }. To save from an MCP session without dumping 30KB
// into context: wlSnapshotDownload('step-1.html') → lands in ~/Downloads.
//
// deno-lint-ignore-file  (this file is browser-side JS, not part of the CLI)

async function wlSerializeSnapshot() {
  const cssom = [...document.styleSheets]
    .map((s) => {
      try {
        return [...s.cssRules].map((r) => r.cssText).join("\n");
      } catch {
        return `/* skipped cross-origin sheet: ${s.href ?? "?"} */`;
      }
    })
    .join("\n");

  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll("script, style, link[rel='stylesheet'], base").forEach((e) => e.remove());

  // inline every non-data <img> as a data: URI (canvas re-encode; tainted or
  // failed images fall back to removing the src so layout keeps the box)
  const imgs = [...clone.querySelectorAll("img[src]")].filter((i) => !i.getAttribute("src").startsWith("data:"));
  const live = [...document.querySelectorAll("img[src]")].filter((i) => !i.getAttribute("src").startsWith("data:"));
  for (let k = 0; k < imgs.length; k++) {
    try {
      const src = live[k];
      const c = document.createElement("canvas");
      c.width = src.naturalWidth || src.width || 1;
      c.height = src.naturalHeight || src.height || 1;
      c.getContext("2d").drawImage(src, 0, 0);
      imgs[k].setAttribute("src", c.toDataURL("image/png"));
    } catch {
      imgs[k].removeAttribute("src");
    }
  }

  const head = clone.querySelector("head");
  if (head) head.insertAdjacentHTML("beforeend", "<style>" + cssom.replace(/<\//g, "<\\/") + "</style>");
  return { html: "<!doctype html>" + clone.outerHTML, vw: window.innerWidth, vh: window.innerHeight };
}

// Serialize + trigger a browser download (Chrome drops it in ~/Downloads).
async function wlSnapshotDownload(filename) {
  const { html, vw, vh } = await wlSerializeSnapshot();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  a.download = filename || "wl-step.html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { saved: a.download, bytes: html.length, vw, vh };
}
