import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/", init, bindings = {}) {
  globalThis.__CLOUDFLARE_TEST_ENV__ = bindings;
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
      ...bindings,
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
  assert.match(html, /Crews call or text one project number/);
  assert.doesNotMatch(html, /react-loading-skeleton|Your site is taking shape/);
});

test("publishes the server-enforced contact policy manifest", async () => {
  const response = await render("/api/policies");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.version, "groundwork-field-contact-v1.0");
  assert.equal(result.defaults, "deny");
  assert.equal(result.controls.zeroMaxPayUsdc, 0.6);
  assert.match(result.prohibited.join(" "), /Engineering design/);
});

test("rejects an AgentPhone delivery with an invalid signature before processing", async () => {
  const response = await render(
    "/api/webhooks/agentphone",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-id": "wh_test_001",
        "x-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-webhook-signature": "sha256=invalid",
      },
      body: JSON.stringify({ event: "agent.message" }),
    },
    { AGENTPHONE_WEBHOOK_SECRET: "test-secret" },
  );
  assert.equal(response.status, 401);
});

test("reports live contact readiness only when every secure binding exists", async () => {
  const response = await render(
    "/api/contact-status",
    { headers: { "oai-authenticated-user-email": "owner@example.com" } },
    {
      DB: {},
      MEDIA: {},
      AGENTPHONE_API_KEY: "secret",
      AGENTPHONE_AGENT_ID: "agt_test",
      AGENTPHONE_NUMBER: "+14155550148",
      AGENTPHONE_WEBHOOK_SECRET: "whsec_test",
      GROUNDWORK_CONTACTS_JSON: JSON.stringify([{ id: "foreman", name: "Foreman", role: "crew", phone: "+14155550148", inboundConsent: true }]),
    },
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.configured, true);
  assert.equal(result.capabilities.mms, true);
  assert.equal(result.allowlistedContacts, 1);
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
