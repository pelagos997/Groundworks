import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/", init) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Groundwork control room", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Groundwork · Geotechnical Package Control<\/title>/i);
  assert.match(html, /GROUNDWORK/);
  assert.match(html, /Protect the excavation release/);
  assert.match(html, /Micropile package/);
  assert.doesNotMatch(html, /react-loading-skeleton|Your site is taking shape/);
});

test("replan graph exposes each deterministic recovery scenario", async () => {
  for (const event of ["hot_weather", "inspector_cancelled", "crew_declined"]) {
    const response = await render("/api/replan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.event, event);
    assert.equal(result.tests.length, 9);
    assert.ok(result.tests.every((item) => item.passed));
    assert.ok(result.recommendation.length > 20);
  }
});

test("uses HeroUI and omits the disposable starter", async () => {
  const [page, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /from "@heroui\/react"/);
  assert.match(css, /@import "@heroui\/styles"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview/);
});
