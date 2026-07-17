import { eq } from "drizzle-orm";
import type { getDb } from "../db";
import { actionReceipts, procurementRequests, purchaseOrders } from "../db/schema";
import { ZERO_MAX_PAY_USDC } from "./agent-policy";
import { buyerIdentityConfigured } from "./procurement";
import type { GroundworkRuntimeEnv } from "./runtime-env";

export async function releasePurchaseOrder(input: {
  db: ReturnType<typeof getDb>;
  runtime: GroundworkRuntimeEnv;
  projectId: string;
  request: typeof procurementRequests.$inferSelect;
  quote: {
    id: string;
    vendorId: string;
    vendorName: string;
    vendorEmail: string;
    vendorPhone: string;
    vendorQuoteRef: string;
    deliveredTotalCents: number;
    earliestDeliveryAt: string;
  };
  purchaseOrderId: string;
  poNumber: string;
}) {
  if (input.runtime.GROUNDWORK_PO_RELEASES_ENABLED !== "true") {
    return { released: false, reasons: ["purchase_order_releases_disabled"], emailMessageId: null, followupCallId: null };
  }
  if (input.runtime.ZERO_LIVE_ACTIONS !== "true") {
    return { released: false, reasons: ["live_actions_disabled"], emailMessageId: null, followupCallId: null };
  }
  if (!buyerIdentityConfigured(input.runtime)) {
    return { released: false, reasons: ["buyer_identity_incomplete"], emailMessageId: null, followupCallId: null };
  }
  if (!input.runtime.ZERO_PRIVATE_KEY?.startsWith("0x")) {
    return { released: false, reasons: ["zero_signing_wallet_not_configured"], emailMessageId: null, followupCallId: null };
  }
  const { ZeroClient } = await import("@zeroxyz/sdk");
  const client = ZeroClient.fromPrivateKey(input.runtime.ZERO_PRIVATE_KEY as `0x${string}`);
  const emailSearch = await client.search("send transactional purchase order email with text body and reply-to", {
    limit: 5,
    availabilityStatus: "healthy",
    maxCost: "0.03",
  });
  let emailCapability: Awaited<ReturnType<typeof client.capabilities.get>> | null = null;
  let emailCapabilityId: string | null = null;
  for (const match of emailSearch.capabilities) {
    if (match.method !== "POST") continue;
    const token = match.token ?? match.id;
    const detail = await client.capabilities.get(token);
    const properties = schemaProperties(detail.bodySchema);
    if (properties.has("to") && properties.has("subject") && properties.has("text")) {
      emailCapability = detail;
      emailCapabilityId = token;
      break;
    }
  }
  if (!emailCapability || !emailCapabilityId) {
    return { released: false, reasons: ["no_healthy_schema_compatible_email_capability"], emailMessageId: null, followupCallId: null };
  }
  const emailResult = await client.fetch(emailCapability.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      to: [input.quote.vendorEmail],
      subject: `PURCHASE ORDER ${input.poNumber} — ${input.request.quantity} × ${input.request.pieceLengthFt}-ft ${input.request.section}`,
      replyTo: input.runtime.GROUNDWORK_RFQ_EMAIL,
      text: buildPurchaseOrderText(input),
    }),
    maxPay: "0.03",
    capabilityId: emailCapabilityId,
  });
  const emailBody = emailResult.body as { messageId?: string } | null;
  await input.db.insert(actionReceipts).values({
    id: `zero_${crypto.randomUUID().slice(0, 12)}`,
    projectId: input.projectId,
    commitId: input.request.id,
    recipientId: input.quote.vendorId,
    action: "purchase_order_email",
    provider: emailCapability.name,
    capabilityId: emailCapabilityId,
    runId: emailResult.runId,
    externalId: emailBody?.messageId ?? null,
    maxPayMicros: 30_000,
    paidMicros: paymentMicros(emailResult.payment),
    outcome: emailResult.outcome,
    responseJson: JSON.stringify({ status: emailResult.status, body: emailResult.body, warnings: emailResult.warnings }),
  });
  if (emailResult.runId) {
    await client.runs.review({
      runId: emailResult.runId,
      success: emailResult.outcome === "success",
      accuracy: emailResult.outcome === "success" ? 5 : 2,
      value: emailResult.outcome === "success" ? 5 : 2,
      reliability: emailResult.outcome === "success" ? 5 : 2,
      content: `Groundwork sent an explicitly approved construction purchase order email; provider outcome was ${emailResult.outcome}.`,
    });
  }
  if (emailResult.outcome !== "success") {
    return { released: false, reasons: ["purchase_order_email_failed"], emailMessageId: null, followupCallId: null };
  }
  const releasedAt = new Date().toISOString();
  await input.db.update(purchaseOrders).set({
    status: "released_pending_acknowledgement",
    releaseChannel: "zero_email",
    externalReference: emailBody?.messageId ?? emailResult.runId ?? null,
    releasedAt,
  }).where(eq(purchaseOrders.id, input.purchaseOrderId));
  await input.db.update(procurementRequests).set({ status: "ordered_pending_acknowledgement", updatedAt: releasedAt })
    .where(eq(procurementRequests.id, input.request.id));

  const followupCallId = await queueReceiptCall(client, input).catch(() => null);
  return { released: true, reasons: [], emailMessageId: emailBody?.messageId ?? null, followupCallId };
}

function buildPurchaseOrderText(input: Parameters<typeof releasePurchaseOrder>[0]) {
  return [
    `PURCHASE ORDER: ${input.poNumber}`,
    `Buyer: ${input.runtime.GROUNDWORK_BUYER_COMPANY}`,
    `Authorized contact: ${input.runtime.GROUNDWORK_BUYER_NAME}, ${input.runtime.GROUNDWORK_BUYER_CALLBACK}`,
    `Vendor: ${input.quote.vendorName}`,
    `Accepted vendor quote: ${input.quote.vendorQuoteRef}`,
    `Material: ${input.request.quantity} new pieces of ${input.request.section} steel H-pile, ${input.request.pieceLengthFt} ft each, ${input.request.totalLengthFt} LF total, ${input.request.grade}, ${input.request.coating}`,
    `Compliance: ${input.request.domesticRequirement}; MTRs ${input.request.mtrRequired ? "required" : "not required"}`,
    `Delivered total authorized: ${(input.quote.deliveredTotalCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
    `Delivery address: ${input.request.deliveryAddress}`,
    `Required on site: ${input.request.requiredOnSiteAt}`,
    `Quoted arrival: ${input.quote.earliestDeliveryAt}`,
    input.request.unloadNotes ? `Delivery notes: ${input.request.unloadNotes}` : "Coordinate unloading with the buyer before dispatch.",
    "No substitutions, quantity changes, price changes, split shipments, or delivery-date changes are authorized by this PO without written buyer approval.",
    `Reply to ${input.runtime.GROUNDWORK_RFQ_EMAIL} acknowledging receipt and confirming the ship/delivery commitment.`,
  ].join("\n");
}

async function queueReceiptCall(
  client: InstanceType<(typeof import("@zeroxyz/sdk"))["ZeroClient"]>,
  input: Parameters<typeof releasePurchaseOrder>[0],
) {
  const search = await client.search("AI disclosed outbound business phone call with transcript", {
    limit: 5,
    availabilityStatus: "healthy",
    maxCost: String(ZERO_MAX_PAY_USDC),
  });
  for (const match of search.capabilities) {
    if (match.method !== "POST") continue;
    const token = match.token ?? match.id;
    const detail = await client.capabilities.get(token);
    const properties = schemaProperties(detail.bodySchema);
    if (!properties.has("phone_number") || !properties.has("task")) continue;
    const result = await client.fetch(detail.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phone_number: input.quote.vendorPhone,
        task: `You are Groundwork, an AI procurement assistant for ${input.runtime.GROUNDWORK_BUYER_COMPANY}. Disclose that you are AI. Tell ${input.quote.vendorName} that authorized purchase order ${input.poNumber}, accepting written quote ${input.quote.vendorQuoteRef}, was emailed to ${input.quote.vendorEmail}. Ask only whether they received it and who will send written acknowledgement. Do not change, negotiate, repeat, or verbally place the order; the email is the controlling document.`,
        model: "base",
        max_duration: 4,
        first_sentence: `Hello, this is Groundwork, an AI procurement assistant calling to confirm receipt of an emailed purchase order from ${input.runtime.GROUNDWORK_BUYER_COMPANY}.`,
        record: false,
        voicemail_action: "leave_message",
        voicemail_message: `This is Groundwork, an AI procurement assistant. Purchase order ${input.poNumber} was emailed to ${input.quote.vendorEmail}. Please acknowledge it in writing to ${input.runtime.GROUNDWORK_RFQ_EMAIL}.`,
        wait_for_greeting: true,
        metadata: { projectId: input.projectId, purchaseOrderId: input.purchaseOrderId, vendorId: input.quote.vendorId },
      }),
      maxPay: String(ZERO_MAX_PAY_USDC),
      capabilityId: token,
    });
    const body = result.body as { call_id?: string } | null;
    await input.db.insert(actionReceipts).values({
      id: `zero_${crypto.randomUUID().slice(0, 12)}`,
      projectId: input.projectId,
      commitId: input.request.id,
      recipientId: input.quote.vendorId,
      action: "purchase_order_receipt_call",
      provider: detail.name,
      capabilityId: token,
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
        content: `Groundwork queued a disclosed vendor call to confirm receipt of an already emailed purchase order; provider outcome was ${result.outcome}.`,
      });
    }
    return body?.call_id ?? null;
  }
  return null;
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
