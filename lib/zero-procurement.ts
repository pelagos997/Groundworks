import type { getDb } from "../db";
import { procurementRequests, vendorRfqCalls } from "../db/schema";
import { POLICY_VERSION, ZERO_MAX_PAY_USDC, evaluateRfqSourcing, type FieldContact } from "./agent-policy";
import {
  buyerIdentityConfigured,
  buildVendorTask,
  isCompleteProcurementDraft,
  isVendorCallingHours,
  resolveHpileVendors,
  type ProcurementDraft,
} from "./procurement";
import type { GroundworkRuntimeEnv } from "./runtime-env";
import { createZeroClient, hasZeroCredentials } from "./zero-client";

export type RfqBatchResult = {
  requestId: string;
  queued: number;
  blocked: boolean;
  reasons: string[];
  calls: Array<{ vendor: string; status: string; externalCallId: string | null }>;
};

export async function sourceRfqBatch(input: {
  db: ReturnType<typeof getDb>;
  runtime: GroundworkRuntimeEnv;
  projectId: string;
  requestId: string;
  contact: FieldContact;
  draft: ProcurementDraft;
  explicitConfirmation: boolean;
}): Promise<RfqBatchResult> {
  const afterHoursAllowed = input.runtime.GROUNDWORK_ALLOW_AFTER_HOURS_RFQ === "true";
  const demoMode = input.runtime.GROUNDWORK_DEMO_MODE === "true";
  const vendors = resolveHpileVendors(input.runtime);
  const policy = evaluateRfqSourcing({
    contact: input.contact,
    requestComplete: isCompleteProcurementDraft(input.draft),
    explicitConfirmation: input.explicitConfirmation,
    liveActionsEnabled: input.runtime.ZERO_LIVE_ACTIONS === "true",
    vendorCount: vendors.length,
    demoMode,
    maxPayPerVendor: ZERO_MAX_PAY_USDC,
    buyerIdentityConfigured: buyerIdentityConfigured(input.runtime),
    withinCallingHours: afterHoursAllowed || isVendorCallingHours(),
  });

  await input.db.insert((await import("../db/schema")).policyDecisions).values({
    id: `policy_${crypto.randomUUID().slice(0, 12)}`,
    projectId: input.projectId,
    subject: input.contact.id,
    action: "zero_vendor_rfq_batch",
    decision: policy.decision,
    reasonsJson: JSON.stringify(policy.reasons),
    policyVersion: POLICY_VERSION,
  });
  if (policy.decision !== "allow") {
    await input.db.update(procurementRequests).set({ status: "sourcing_blocked", updatedAt: new Date().toISOString() })
      .where((await import("drizzle-orm")).eq(procurementRequests.id, input.requestId));
    return { requestId: input.requestId, queued: 0, blocked: true, reasons: policy.reasons, calls: [] };
  }
  if (!hasZeroCredentials(input.runtime)) {
    return { requestId: input.requestId, queued: 0, blocked: true, reasons: ["zero_signing_wallet_not_configured"], calls: [] };
  }

  const client = await createZeroClient(input.runtime);
  const search = await client.search("AI disclosed outbound business phone call with transcript", {
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
    return { requestId: input.requestId, queued: 0, blocked: true, reasons: ["no_healthy_schema_compatible_voice_capability"], calls: [] };
  }

  await input.db.update(procurementRequests).set({ status: "rfq_in_progress", updatedAt: new Date().toISOString() })
    .where((await import("drizzle-orm")).eq(procurementRequests.id, input.requestId));
  const calls: RfqBatchResult["calls"] = [];
  for (const vendor of vendors) {
    const callRecordId = `rfq_${crypto.randomUUID().slice(0, 12)}`;
    try {
      const result = await client.fetch(selected.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone_number: vendor.phone,
          task: buildVendorTask(input.runtime, input.requestId, vendor.name, input.draft),
          model: "base",
          max_duration: 6,
          first_sentence: `Hello, this is Groundwork, an AI procurement assistant calling for ${input.runtime.GROUNDWORK_BUYER_COMPANY}. This is a nonbinding request for quote, not an order.`,
          record: false,
          voicemail_action: "leave_message",
          voicemail_message: `This is Groundwork, an AI procurement assistant for ${input.runtime.GROUNDWORK_BUYER_COMPANY}, requesting a nonbinding quote for ${input.draft.quantity} pieces of ${input.draft.section} at ${input.draft.pieceLengthFt} feet. Please call ${input.runtime.GROUNDWORK_BUYER_CALLBACK} or email ${input.runtime.GROUNDWORK_RFQ_EMAIL}. This is not an order.`,
          wait_for_greeting: true,
          metadata: { projectId: input.projectId, procurementRequestId: input.requestId, vendorId: vendor.id },
        }),
        maxPay: String(ZERO_MAX_PAY_USDC),
        capabilityId,
      });
      const body = result.body as { call_id?: string } | null;
      await input.db.insert(vendorRfqCalls).values({
        id: callRecordId,
        projectId: input.projectId,
        requestId: input.requestId,
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorPhone: vendor.phone,
        provider: selected.name,
        capabilityId,
        runId: result.runId,
        externalCallId: body?.call_id ?? null,
        status: result.outcome === "success" ? "queued" : "failed",
        maxPayMicros: Math.round(ZERO_MAX_PAY_USDC * 1_000_000),
        paidMicros: paymentMicros(result.payment),
        responseJson: JSON.stringify({ status: result.status, body: result.body, warnings: result.warnings }),
        reviewStatus: result.runId ? "reviewed" : "not_recorded",
      });
      if (result.runId) {
        await client.runs.review({
          runId: result.runId,
          success: result.outcome === "success",
          accuracy: result.outcome === "success" ? 5 : 2,
          value: result.outcome === "success" ? 4 : 2,
          reliability: result.outcome === "success" ? 5 : 2,
          content: `Groundwork queued a disclosed, nonbinding construction-material RFQ call to ${vendor.name}; provider outcome was ${result.outcome}.`,
        });
      }
      calls.push({ vendor: vendor.name, status: result.outcome, externalCallId: body?.call_id ?? null });
    } catch (error) {
      await input.db.insert(vendorRfqCalls).values({
        id: callRecordId,
        projectId: input.projectId,
        requestId: input.requestId,
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorPhone: vendor.phone,
        provider: selected.name,
        capabilityId,
        status: "failed",
        maxPayMicros: Math.round(ZERO_MAX_PAY_USDC * 1_000_000),
        responseJson: JSON.stringify({ error: error instanceof Error ? error.message : "call_failed" }),
        reviewStatus: "not_recorded",
      });
      calls.push({ vendor: vendor.name, status: "failed", externalCallId: null });
    }
  }
  const queued = calls.filter((call) => call.status === "success").length;
  await input.db.update(procurementRequests).set({ status: queued > 0 ? "awaiting_written_quotes" : "sourcing_failed", updatedAt: new Date().toISOString() })
    .where((await import("drizzle-orm")).eq(procurementRequests.id, input.requestId));
  return { requestId: input.requestId, queued, blocked: false, reasons: [], calls };
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
