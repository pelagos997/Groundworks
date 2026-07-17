import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "../../../../db";
import { actionReceipts, approvedReplans, policyDecisions } from "../../../../db/schema";
import { getChatGPTUser } from "../../../chatgpt-auth";
import {
  POLICY_VERSION,
  ZERO_MAX_PAY_USDC,
  evaluateZeroVoiceAction,
  parseContacts,
} from "../../../../lib/agent-policy";
import { DEFAULT_PROJECT_ID, getRuntimeEnv } from "../../../../lib/runtime-env";
import { createZeroClient, hasZeroCredentials } from "../../../../lib/zero-client";

const ActionSchema = z.object({
  kind: z.literal("voice"),
  commitId: z.string().min(1),
  recipientId: z.string().min(1),
});

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = ActionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid Zero action request." }, { status: 400 });
  const runtime = getRuntimeEnv();
  const projectId = runtime.GROUNDWORK_PROJECT_ID ?? DEFAULT_PROJECT_ID;
  const db = getDb();
  const [plan] = await db.select().from(approvedReplans).where(eq(approvedReplans.commitId, parsed.data.commitId)).limit(1);
  const approvedPlan = Boolean(plan && new Date(plan.expiresAt).getTime() > Date.now());
  const contact = parseContacts(runtime.GROUNDWORK_CONTACTS_JSON).find((item) => item.id === parsed.data.recipientId) ?? null;
  const policy = evaluateZeroVoiceAction({
    contact,
    approvedPlan,
    liveActionsEnabled: runtime.ZERO_LIVE_ACTIONS === "true",
    maxPay: ZERO_MAX_PAY_USDC,
  });
  await db.insert(policyDecisions).values({
    id: `policy_${crypto.randomUUID().slice(0, 12)}`,
    projectId,
    subject: contact?.id ?? parsed.data.recipientId,
    action: "zero_voice_call",
    decision: policy.decision,
    reasonsJson: JSON.stringify(policy.reasons),
    policyVersion: POLICY_VERSION,
  });
  if (policy.decision !== "allow" || !contact) {
    return NextResponse.json({ error: "Action blocked by policy.", policy }, { status: 403 });
  }
  if (!hasZeroCredentials(runtime)) {
    return NextResponse.json({ error: "Zero signing wallet is not configured." }, { status: 503 });
  }

  const client = await createZeroClient(runtime);
  const search = await client.search("place an AI disclosed phone call to a construction field contact and return a transcript", {
    limit: 5,
    availabilityStatus: "healthy",
    maxCost: String(ZERO_MAX_PAY_USDC),
  });
  let selected: Awaited<ReturnType<typeof client.capabilities.get>> | null = null;
  let capabilityId: string | null = null;
  for (const match of search.capabilities) {
    if (match.method !== "POST") continue;
    const token = match.token ?? match.id;
    const detail = await client.capabilities.get(token);
    const properties = schemaProperties(detail.bodySchema);
    if (properties.has("phone_number") && properties.has("task")) {
      selected = detail;
      capabilityId = token;
      break;
    }
  }
  if (!selected || !capabilityId) {
    return NextResponse.json({ error: "Zero found no healthy, schema-compatible voice capability." }, { status: 503 });
  }

  const task = `You are Groundwork, an AI superintendent assistant. Disclose that you are AI. Tell ${contact.name} that approved schedule ${parsed.data.commitId} is ready for coordination. Ask whether they can support the updated drilled-shaft sequence. Record only availability and factual constraints. Do not give engineering, safety, commercial, or means-and-methods direction.`;
  const result = await client.fetch(selected.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      phone_number: contact.phone,
      task,
      model: "base",
      max_duration: 5,
      first_sentence: "Hello, this is Groundwork, an AI superintendent assistant calling about an approved drilled-shaft schedule update.",
      record: false,
      voicemail_action: "hangup",
      wait_for_greeting: true,
      metadata: { projectId, commitId: parsed.data.commitId, recipientId: contact.id },
    }),
    maxPay: String(ZERO_MAX_PAY_USDC),
    capabilityId,
  });
  const body = result.body as { call_id?: string } | null;
  const receiptId = `zero_${crypto.randomUUID().slice(0, 12)}`;
  await db.insert(actionReceipts).values({
    id: receiptId,
    projectId,
    commitId: parsed.data.commitId,
    recipientId: contact.id,
    action: "voice_call",
    provider: selected.name,
    capabilityId,
    runId: result.runId,
    externalId: body?.call_id ?? null,
    maxPayMicros: Math.round(ZERO_MAX_PAY_USDC * 1_000_000),
    paidMicros: paymentMicros(result.payment),
    outcome: result.outcome,
    responseJson: JSON.stringify({ status: result.status, body: result.body, warnings: result.warnings }),
  });
  if (result.runId) {
    await client.runs.review({
      runId: result.runId,
      success: result.outcome === "success",
      accuracy: result.outcome === "success" ? 5 : 2,
      value: result.outcome === "success" ? 4 : 2,
      reliability: result.outcome === "success" ? 5 : 2,
      content: `Groundwork attempted a bounded, consented construction coordination call; provider outcome was ${result.outcome}.`,
    });
  }
  return NextResponse.json({
    receiptId,
    outcome: result.outcome,
    runId: result.runId,
    provider: selected.name,
    externalId: body?.call_id ?? null,
    payment: result.payment,
  }, { status: result.outcome === "success" ? 200 : 502 });
}

function schemaProperties(schema: unknown) {
  if (!schema || typeof schema !== "object" || !("properties" in schema)) return new Set<string>();
  const properties = (schema as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object") return new Set<string>();
  return new Set(Object.keys(properties));
}

function paymentMicros(payment: unknown) {
  if (!payment || typeof payment !== "object" || !("amount" in payment)) return null;
  const amount = Number((payment as { amount?: unknown }).amount);
  return Number.isFinite(amount) ? Math.round(amount * 1_000_000) : null;
}
