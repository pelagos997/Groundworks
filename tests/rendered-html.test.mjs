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
  assert.match(html, /<title>Groundwork · Drilled Shaft Superintendent<\/title>/i);
  assert.match(html, /GROUNDWORK/);
  assert.match(html, /One week\. Six shafts\. One release\./);
  assert.match(html, /Drilled shaft installation/);
  assert.match(html, /Activity \+ field description/);
  assert.match(html, /Crews call a normal phone number/);
  assert.doesNotMatch(html, /react-loading-skeleton|Your site is taking shape/);
});

test("replan graph exposes each deterministic recovery scenario", async () => {
  for (const event of ["hot_weather", "inspector_cancelled", "crew_declined", "shaft_obstruction"]) {
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

test("normalizes a caller-confirmed drilled-shaft event for Nexla", async () => {
  const response = await render("/api/field-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      transcript:
        "This is Luis at DS-02. We hit refusal at 34 feet. The rig can move to DS-03.",
    }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.event.schema, "groundwork.field_event.v1");
  assert.equal(result.event.observation.elementId, "DS-02");
  assert.equal(result.event.observation.depthFt, 34);
  assert.equal(result.event.observation.alternateElement, "DS-03");
  assert.equal(result.nexla.dataProduct, "groundwork_field_events_v1");
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
