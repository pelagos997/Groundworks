import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildProcurementReadback,
  isCompleteProcurementDraft,
  parseProcurementDraft,
  procurementExtensions,
} from "../lib/procurement.ts";
import { evaluatePurchaseApproval, parseContacts } from "../lib/agent-policy.ts";
import { parsePurchaseApproval } from "../lib/purchase-command.ts";
import { rankQuotes } from "../lib/quote-comparison.ts";
import { recordAgentPhoneWebhook } from "../lib/supabase-phone-data.ts";
import { hasZeroCredentials } from "../lib/zero-client.ts";

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
  const response = await render("/", { headers: { "oai-authenticated-user-email": "owner@example.com" } });
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
  assert.equal(result.version, "groundwork-phone-procurement-v2.0");
  assert.equal(result.defaults, "deny");
  assert.equal(result.controls.zeroMaxPayUsdc, 0.6);
  assert.match(result.prohibited.join(" "), /Engineering design/);
});

test("normalizes the HP12x53 overrun and verifies the quantity extension", () => {
  const draft = parseProcurementDraft(
    "Piling overrun, change order CO-17. Need 10 20 ft sections of 12x53 H-pile, ASTM A572 Grade 50, domestic required. Deliver to 600 Brannan Street San Francisco CA 94107, required July 20 2026 at 7 am.",
  );
  assert.equal(draft.section, "HP12x53");
  assert.equal(draft.quantity, 10);
  assert.equal(draft.pieceLengthFt, 20);
  assert.equal(draft.grade, "A572 Grade 50");
  assert.equal(draft.domesticRequirement, "domestic_required");
  assert.equal(isCompleteProcurementDraft(draft), true);
  assert.deepEqual(procurementExtensions(draft), { totalLengthFt: 200, totalWeightLbs: 10600, shortTons: 5.3 });
  assert.match(buildProcurementReadback(draft), /10,600 pounds/);
  assert.match(buildProcurementReadback(draft), /nonbinding quote calls only, not an order/i);
});

test("requires an exact written quote, total, authority, and PO for release", () => {
  const [buyer] = parseContacts(JSON.stringify([{
    id: "pm",
    name: "Project Manager",
    role: "project_manager",
    phone: "+14155550149",
    canRequestQuotes: true,
    canApprovePurchase: true,
    purchaseLimitCents: 2_500_000,
  }]));
  const command = parsePurchaseApproval("Release quote Q-419 at $12,850 delivered under PO-1042 and release the order.");
  assert.deepEqual(command, { quoteRef: "Q-419", deliveredTotalCents: 1_285_000, poNumber: "PO-1042", explicitRelease: true });
  const allowed = evaluatePurchaseApproval({
    contact: buyer,
    writtenQuoteReceived: true,
    quoteMatchesRequest: true,
    quoteExpired: false,
    deliveredTotalCents: command.deliveredTotalCents,
    poNumber: command.poNumber,
    explicitConfirmation: command.explicitRelease,
  });
  assert.equal(allowed.decision, "allow");
  const blocked = evaluatePurchaseApproval({
    contact: buyer,
    writtenQuoteReceived: false,
    quoteMatchesRequest: true,
    quoteExpired: false,
    deliveredTotalCents: command.deliveredTotalCents,
    poNumber: command.poNumber,
    explicitConfirmation: true,
  });
  assert.equal(blocked.decision, "deny");
  assert.ok(blocked.reasons.includes("written_quote_required"));
});

test("ranks on-time written quotes by delivered total", () => {
  const quotes = [
    { id: "late-cheap", vendorName: "Late", vendorQuoteRef: "L1", deliveredTotalCents: 900_000, earliestDeliveryAt: "2026-07-22T07:00:00-07:00", validUntil: "2099-01-01T00:00:00.000Z", status: "qualified" },
    { id: "on-time-high", vendorName: "Fast", vendorQuoteRef: "F1", deliveredTotalCents: 1_300_000, earliestDeliveryAt: "2026-07-20T06:00:00-07:00", validUntil: "2099-01-01T00:00:00.000Z", status: "qualified" },
    { id: "on-time-low", vendorName: "Best", vendorQuoteRef: "B1", deliveredTotalCents: 1_200_000, earliestDeliveryAt: "2026-07-20T06:30:00-07:00", validUntil: "2099-01-01T00:00:00.000Z", status: "qualified" },
  ];
  assert.equal(rankQuotes(quotes, "2026-07-20T07:00:00[America/Los_Angeles]")[0].id, "on-time-low");
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
  assert.equal(result.callDataStore.configured, false);
});

test("accepts either managed-session or private-key Zero credentials", () => {
  assert.equal(hasZeroCredentials({}), false);
  assert.equal(hasZeroCredentials({ ZERO_PRIVATE_KEY: "0x1234" }), true);
  assert.equal(hasZeroCredentials({ ZERO_ACCESS_TOKEN: "access", ZERO_REFRESH_TOKEN: "refresh" }), true);
  assert.equal(hasZeroCredentials({ ZERO_ACCESS_TOKEN: "access" }), false);
});

test("upserts redacted AgentPhone call records and transcript turns into Supabase", async () => {
  const originalFetch = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (url, init) => {
    writes.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  try {
    const status = await recordAgentPhoneWebhook({
      runtime: {
        SUPABASE_URL: "https://groundwork-test.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_test",
        GROUNDWORK_PROJECT_ID: "pile_demo",
        AGENTPHONE_NUMBER: "+19133495671",
        AGENTPHONE_NUMBER_ID: "num_groundwork",
      },
      webhookId: "wh_call_001",
      payload: {
        event: "agent.call_ended",
        channel: "voice",
        timestamp: "2026-07-17T21:00:00.000Z",
        agentId: "agt_groundwork",
        data: {
          callId: "call_001",
          fromNumber: "+19135550123",
          toNumber: "+19133495671",
          direction: "inbound",
          status: "completed",
          mediaUrl: "https://agentphone.ai/private-recording",
          transcripts: [
            { role: "agent", content: "This is Groundwork, an AI assistant." },
            { role: "caller", content: "We need ten twenty-foot HP12x53 sections." },
          ],
        },
        conversationState: { disclosureAccepted: true, transcriptionConsent: true },
        recentHistory: [],
      },
    });
    assert.equal(status, "stored");
    assert.equal(writes.length, 3);
    assert.match(writes[0].url, /phone_webhook_events/);
    assert.equal(writes[0].body[0].payload.data.mediaUrl, "[redacted]");
    assert.match(writes[1].url, /phone_calls/);
    assert.equal(writes[1].body[0].disclosure_given, true);
    assert.match(writes[2].url, /phone_transcript_turns/);
    assert.equal(writes[2].body.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps Supabase user sessions separate from the privileged call-data writer", async () => {
  const [packageJson, sessionProxy, phoneStore] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../utils/supabase/middleware.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase-phone-data.ts", import.meta.url), "utf8"),
  ]);

  const dependencies = JSON.parse(packageJson).dependencies;
  assert.ok(dependencies["@supabase/ssr"]);
  assert.ok(dependencies["@supabase/supabase-js"]);
  assert.match(sessionProxy, /auth\.getClaims\(\)/);
  assert.match(phoneStore, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(phoneStore, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
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
    readFile(new URL("../app/groundwork-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /from "@heroui\/react"/);
  assert.match(css, /@import "@heroui\/styles"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview/);
});
