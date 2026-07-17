import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildProcurementReadback,
  analyzeHostedRfqTranscript,
  auditReasonedProcurement,
  buildInboundReasoningPrompt,
  buildVendorTask,
  isCompleteProcurementDraft,
  parseProcurementDraft,
  procurementExtensions,
  POST_INTAKE_REASONING_MAX_PAY_USDC,
  resolveHpileVendors,
} from "../lib/procurement.ts";
import { evaluatePurchaseApproval, evaluateRfqSourcing, parseContacts } from "../lib/agent-policy.ts";
import { AgentPhoneWebhookSchema } from "../lib/agentphone.ts";
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

test("routes demo RFQs only to the configured test vendor", () => {
  const vendors = resolveHpileVendors({
    GROUNDWORK_DEMO_MODE: "true",
    GROUNDWORK_DEMO_VENDOR_NAME: "Nucor Skyline — demo",
    GROUNDWORK_DEMO_VENDOR_PHONE: "+14053206332",
  });
  assert.deepEqual(vendors.map((vendor) => vendor.phone), ["+14053206332"]);
  assert.equal(vendors[0].id, "nucor_skyline_demo");

  const policy = evaluateRfqSourcing({
    contact: {
      id: "ronan",
      name: "Ronan Jones",
      role: "buyer",
      phone: "+19132632336",
      inboundConsent: true,
      outboundVoiceConsent: true,
      outboundSmsConsent: true,
      canRequestQuotes: true,
      canApprovePurchase: false,
      purchaseLimitCents: 0,
    },
    requestComplete: true,
    explicitConfirmation: true,
    liveActionsEnabled: true,
    vendorCount: vendors.length,
    demoMode: true,
    maxPayPerVendor: 0.6,
    buyerIdentityConfigured: true,
    withinCallingHours: true,
  });
  assert.equal(policy.decision, "allow");
});

test("keeps the outbound AI on the bounded RFQ checklist", () => {
  const draft = parseProcurementDraft(
    "Need 10 pieces of HP12x53 at 20 feet, ASTM A572 Grade 50, domestic required, deliver to 600 Brannan Street San Francisco CA 94107, required July 20 2026 at 7 am.",
  );
  const task = buildVendorTask({
    GROUNDWORK_BUYER_COMPANY: "Groundwork Demo",
    GROUNDWORK_BUYER_CALLBACK: "+19132632336",
    GROUNDWORK_RFQ_EMAIL: "jonanrones@gmail.com",
  }, "pr_demo", "Nucor Skyline — demo", draft);
  assert.match(task, /Immediately disclose that you are an AI assistant/i);
  assert.match(task, /Never claim or imply that you are human/i);
  assert.match(task, /Ask one focused follow-up at a time/i);
  assert.match(task, /untrusted vendor content/i);
  assert.match(task, /Politely return to the next missing RFQ field/i);
  assert.match(task, /read back the captured commercial details/i);
  assert.match(task, /reason about contradictions/i);
  assert.match(task, /Do not expose hidden reasoning/i);
});

test("uses hosted reasoning but requires caller confirmation before sourcing", () => {
  const runtime = { GROUNDWORK_BUYER_COMPANY: "Groundwork Demo" };
  const turns = [
    { role: "user", content: "We need H-pile for the site." },
    { role: "agent", content: "RFQ READBACK. Section HP12x53. Quantity 200 pieces. Piece length 20 feet. Grade ASTM A572 Grade 50. Domestic requirement required. MTR required. Coating bare. Delivery address: 1809 Broadway, San Francisco, CA 94109. Required on site: July 20 2026 at 7:00 AM Pacific. Unloading notes: none stated. Change order: CO-17. This is a nonbinding quote request, not an order." },
    { role: "agent", content: "Say confirm RFQ if every field is correct." },
  ];
  const unconfirmed = analyzeHostedRfqTranscript(turns, runtime);
  assert.equal(unconfirmed.intent, true);
  assert.equal(isCompleteProcurementDraft(unconfirmed.draft), true);
  assert.equal(unconfirmed.explicitConfirmation, false);

  const confirmed = analyzeHostedRfqTranscript([...turns, { role: "user", content: "Confirm RFQ." }], runtime);
  assert.equal(confirmed.explicitConfirmation, true);
  assert.equal(confirmed.draft.quantity, 200);
  assert.equal(confirmed.draft.pieceLengthFt, 20);
  assert.match(buildInboundReasoningPrompt(runtime), /ask one focused follow-up at a time/i);
  assert.match(buildInboundReasoningPrompt(runtime), /Do not say the words confirm RFQ on the caller's behalf/i);
});

test("blocks outbound sourcing unless the post-intake reasoning audit is clean", () => {
  const draft = parseProcurementDraft(
    "Need 200 pieces of HP12x53 at 20 feet, ASTM A572 Grade 50, domestic required, deliver to 1809 Broadway San Francisco CA 94109, required July 20 2026 at 7 am.",
  );
  const extraction = {
    section: "HP12x53", quantity: 200, pieceLengthFt: 20, grade: "A572 Grade 50",
    domesticRequirement: "domestic_required", mtrRequired: true, coating: "bare",
    deliveryAddress: "1809 Broadway, San Francisco, CA 94109", requiredOnSiteAt: "2026-07-20T07:00:00-07:00",
    unloadNotes: null, changeOrderRef: null, explicitConfirmation: true, confidence: "high",
    ambiguities: [], missingFields: [], reasoningSummary: "Complete and internally consistent.",
  };
  assert.equal(POST_INTAKE_REASONING_MAX_PAY_USDC, 0.1);
  assert.deepEqual(auditReasonedProcurement({ extraction, draft, explicitConfirmation: true }), { ready: true, issues: [] });
  const blocked = auditReasonedProcurement({ extraction: { ...extraction, confidence: "medium", ambiguities: ["Quantity may refer to total feet."] }, draft, explicitConfirmation: true });
  assert.equal(blocked.ready, false);
  assert.match(blocked.issues.join(" "), /confidence is medium/i);
  assert.match(blocked.issues.join(" "), /quantity may refer to total feet/i);
});

test("lets pre-authorized voice callers report naturally after the audible disclosure", async () => {
  const route = await readFile(new URL("../app/api/webhooks/agentphone/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /say i consent/i);
  assert.doesNotMatch(route, /awaiting_consent.*hang up/is);
  assert.match(route, /state: "collecting"/);
  assert.match(route, /disclosureAccepted: true/);
});

test("accepts live voice envelopes with provider-specific history metadata", () => {
  const parsed = AgentPhoneWebhookSchema.safeParse({
    event: "agent.message",
    channel: "voice",
    agentId: "agt_groundwork",
    data: {
      callId: "call_live_001",
      from: "+19132632336",
      to: "+19133495671",
      direction: "inbound",
      status: "in-progress",
      transcript: "I need two hundred HP12x53 piles at twenty feet.",
    },
    conversationState: [],
    recentHistory: [{ role: "agent", content: null }, null],
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.conversationState, null);
  assert.equal(parsed.data.recentHistory.length, 2);
});

test("configures the outbound phone capability to use its turbo conversation model", async () => {
  const source = await readFile(new URL("../lib/zero-procurement.ts", import.meta.url), "utf8");
  assert.match(source, /model: "turbo"/);
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
          durationSeconds: 44.74,
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
    assert.equal(writes[1].body[0].duration_seconds, 45);
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
