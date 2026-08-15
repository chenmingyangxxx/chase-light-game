import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Ashes to Aurora launch screen", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>余烬之光｜物理堆叠小游戏<\/title>/);
  assert.match(html, /余烬之光/);
  assert.match(html, /class="launch-screen"/);
  assert.match(html, /ashes-to-aurora-emblem\.png/);
  assert.match(html, /aria-label="游戏加载进度"/);
  assert.match(html, /正在载入/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site|codex-preview/);
});
