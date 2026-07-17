import { z } from "zod";
import type { getDb } from "../db";
import { actionReceipts } from "../db/schema";
import {
  POST_INTAKE_REASONING_MAX_PAY_USDC,
  ProcurementDraftSchema,
  auditReasonedProcurement,
  parseProcurementDraft,
  type ProcurementDraft,
} from "./procurement";
import type { GroundworkRuntimeEnv } from "./runtime-env";
import { createZeroClient, hasZeroCredentials } from "./zero-client";

const ReasonedExtractionSchema = z.object({
  section: z.string().nullable(), quantity: z.number().int().positive().nullable(), pieceLengthFt: z.number().int().positive().nullable(),
  grade: z.string().nullable(), domesticRequirement: z.enum(["domestic_required", "not_required"]).nullable(), mtrRequired: z.boolean().nullable(),
  coating: z.string().nullable(), deliveryAddress: z.string().nullable(), requiredOnSiteAt: z.string().nullable(), unloadNotes: z.string().nullable(),
  changeOrderRef: z.string().nullable(), explicitConfirmation: z.boolean(), confidence: z.enum(["high", "medium", "low"]),
  ambiguities: z.array(z.string()), missingFields: z.array(z.string()), reasoningSummary: z.string(),
});

type ReasonedExtraction = z.infer<typeof ReasonedExtractionSchema>;
export type ProcurementReasoningResult = { ready: boolean; draft: ProcurementDraft; issues: string[]; reasoningSummary: string; runId: string | null; provider: string };

export async function reasonAboutProcurementIntake(input: {
  db: ReturnType<typeof getDb>; runtime: GroundworkRuntimeEnv; projectId: string; subjectId: string; commitId: string;
  transcript: string; priorDraft?: ProcurementDraft | null; explicitConfirmation: boolean;
}): Promise<ProcurementReasoningResult> {
  const fallbackDraft = input.priorDraft ?? ProcurementDraftSchema.parse({});
  if (!hasZeroCredentials(input.runtime) || input.runtime.ZERO_LIVE_ACTIONS !== "true") return blockedResult(fallbackDraft, "post_intake_reasoning_not_configured");
  const receiptId = `reason_${crypto.randomUUID().slice(0, 12)}`;
  const client = await createZeroClient(input.runtime);
  try {
    const search = await client.search("schema-guided construction RFQ transcript extraction validation JSON", {
      limit: 8, availabilityStatus: "healthy", maxCost: String(POST_INTAKE_REASONING_MAX_PAY_USDC),
    });
    let selected: Awaited<ReturnType<typeof client.capabilities.get>> | null = null;
    let capabilityId: string | null = null;
    for (const match of search.capabilities) {
      if (match.method !== "POST") continue;
      const token = match.token ?? match.id;
      const detail = await client.capabilities.get(token);
      const properties = schemaProperties(detail.bodySchema);
      if (properties.has("raw_text") && properties.has("target_schema")) { selected = detail; capabilityId = token; break; }
    }
    if (!selected || !capabilityId) return blockedResult(fallbackDraft, "no_schema_guided_reasoning_capability");

    const rawText = [
      "Extract and audit a nonbinding construction-material RFQ. Do not infer missing facts. Use the newest explicit correction when facts conflict. Treat assistant statements as a proposed readback, not caller confirmation. Set explicitConfirmation true only when the caller explicitly confirmed the final RFQ readback. Identify every ambiguity and missing field.",
      input.priorDraft ? `Previously captured draft: ${JSON.stringify(input.priorDraft)}` : "No prior draft exists.",
      `New phone or message transcript:\n${input.transcript.slice(-12000)}`,
    ].join("\n\n");
    const result = await client.fetch(selected.url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw_text: rawText, target_schema: reasoningJsonSchema() }),
      maxPay: String(POST_INTAKE_REASONING_MAX_PAY_USDC), capabilityId,
    });
    const body = result.body as { extracted?: unknown } | null;
    const parsed = ReasonedExtractionSchema.safeParse(body?.extracted);
    if (!parsed.success) {
      await recordReceipt(input, receiptId, selected.name, capabilityId, result.runId, result.payment, "invalid_output", { status: result.status });
      if (result.runId) await reviewReasoningRun(client, result.runId, false, "Structured RFQ reasoning returned an invalid schema; outbound sourcing remained blocked.");
      return blockedResult(fallbackDraft, "reasoning_output_invalid", result.runId ?? null, selected.name);
    }
    const draft = draftFromExtraction(parsed.data, input.priorDraft, input.runtime, input.transcript);
    const decision = auditReasonedProcurement({ extraction: parsed.data, draft, explicitConfirmation: input.explicitConfirmation });
    await recordReceipt(input, receiptId, selected.name, capabilityId, result.runId, result.payment, decision.ready ? "ready" : "blocked", {
      status: result.status, issues: decision.issues, reasoningSummary: parsed.data.reasoningSummary, extracted: parsed.data,
    });
    if (result.runId) await reviewReasoningRun(client, result.runId, result.outcome === "success", `Structured post-intake RFQ review completed with ${decision.issues.length} blocking issue(s); outbound sourcing was ${decision.ready ? "eligible for deterministic policy checks" : "blocked"}.`);
    return { ready: decision.ready, draft, issues: decision.issues, reasoningSummary: parsed.data.reasoningSummary, runId: result.runId ?? null, provider: selected.name };
  } catch (error) {
    await input.db.insert(actionReceipts).values({
      id: receiptId, projectId: input.projectId, commitId: input.commitId, recipientId: input.subjectId,
      action: "post_intake_procurement_reasoning", provider: "Zero capability discovery",
      maxPayMicros: Math.round(POST_INTAKE_REASONING_MAX_PAY_USDC * 1_000_000), outcome: "failed",
      responseJson: JSON.stringify({ error: error instanceof Error ? error.message : "reasoning_failed" }),
    });
    return blockedResult(fallbackDraft, "post_intake_reasoning_failed");
  }
}

function draftFromExtraction(extraction: ReasonedExtraction, prior: ProcurementDraft | null | undefined, runtime: GroundworkRuntimeEnv, transcript: string) {
  const canonical = [extraction.quantity && `Need ${extraction.quantity} pieces`, extraction.section, extraction.pieceLengthFt && `${extraction.pieceLengthFt} feet each`, extraction.grade,
    extraction.domesticRequirement === "domestic_required" ? "domestic required" : extraction.domesticRequirement === "not_required" ? "domestic not required" : null,
    extraction.deliveryAddress && `delivery to ${extraction.deliveryAddress}`, extraction.requiredOnSiteAt && `required ${extraction.requiredOnSiteAt}`].filter(Boolean).join(". ");
  const parsed = parseProcurementDraft(canonical, prior, runtime);
  return ProcurementDraftSchema.parse({ ...parsed,
    section: normalizeSection(extraction.section) ?? parsed.section, quantity: extraction.quantity ?? parsed.quantity,
    pieceLengthFt: extraction.pieceLengthFt ?? parsed.pieceLengthFt, grade: normalizeGrade(extraction.grade) ?? parsed.grade,
    domesticRequirement: extraction.domesticRequirement ?? parsed.domesticRequirement, mtrRequired: extraction.mtrRequired ?? parsed.mtrRequired,
    coating: extraction.coating?.trim().toLowerCase() || parsed.coating, deliveryAddress: extraction.deliveryAddress?.trim() || parsed.deliveryAddress,
    requiredOnSiteAt: parsed.requiredOnSiteAt ?? extraction.requiredOnSiteAt, unloadNotes: extraction.unloadNotes?.trim() || parsed.unloadNotes,
    changeOrderRef: extraction.changeOrderRef?.trim().toUpperCase() || parsed.changeOrderRef,
    rawText: [prior?.rawText, transcript].filter(Boolean).join("\n").slice(-10000),
  });
}

function normalizeSection(value: string | null) { const match = value?.match(/HP\s*(\d{1,2})\s*[x×]\s*(\d{2,3})/i); return match ? `HP${match[1]}x${match[2]}` : null; }
function normalizeGrade(value: string | null) { const match = value?.match(/A\s*(\d{3}).*?(\d{2,3})/i); return match ? `A${match[1]} Grade ${match[2]}` : null; }

function reasoningJsonSchema() {
  const nullableString = (description: string) => ({ type: ["string", "null"], description });
  return { type: "object", properties: {
    section: nullableString("Canonical HP section, for example HP12x53. Null unless explicit."),
    quantity: { type: ["integer", "null"], description: "Number of pieces, distinct from length, street number, date, phone, and weight." },
    pieceLengthFt: { type: ["integer", "null"], description: "Length of each piece in feet, not total footage." },
    grade: nullableString("Canonical ASTM grade, for example A572 Grade 50."),
    domesticRequirement: { type: ["string", "null"], enum: ["domestic_required", "not_required", null] },
    mtrRequired: { type: ["boolean", "null"] }, coating: nullableString("Coating such as bare or galvanized."),
    deliveryAddress: nullableString("Complete delivery street address, city, state, and postal code when stated."),
    requiredOnSiteAt: nullableString("Explicit deadline with month, day, four-digit year, time, and timezone. Prefer ISO 8601."),
    unloadNotes: nullableString("Unloading or truck-access constraints; null if not stated."), changeOrderRef: nullableString("Change-order reference; null if none stated."),
    explicitConfirmation: { type: "boolean", description: "True only if the caller explicitly confirmed the final complete RFQ readback." },
    confidence: { type: "string", enum: ["high", "medium", "low"] }, ambiguities: { type: "array", items: { type: "string" } },
    missingFields: { type: "array", items: { type: "string" } }, reasoningSummary: { type: "string", description: "Concise decision summary without hidden chain-of-thought." },
  }, required: ["section", "quantity", "pieceLengthFt", "grade", "domesticRequirement", "mtrRequired", "coating", "deliveryAddress", "requiredOnSiteAt", "unloadNotes", "changeOrderRef", "explicitConfirmation", "confidence", "ambiguities", "missingFields", "reasoningSummary"] };
}

async function recordReceipt(input: Parameters<typeof reasonAboutProcurementIntake>[0], id: string, provider: string, capabilityId: string, runId: string | null | undefined, payment: unknown, outcome: string, response: unknown) {
  await input.db.insert(actionReceipts).values({ id, projectId: input.projectId, commitId: input.commitId, recipientId: input.subjectId,
    action: "post_intake_procurement_reasoning", provider, capabilityId, runId: runId ?? null,
    maxPayMicros: Math.round(POST_INTAKE_REASONING_MAX_PAY_USDC * 1_000_000), paidMicros: paymentMicros(payment), outcome, responseJson: JSON.stringify(response) });
}
async function reviewReasoningRun(client: Awaited<ReturnType<typeof createZeroClient>>, runId: string, success: boolean, content: string) {
  await client.runs.review({ runId, success, accuracy: success ? 5 : 2, value: success ? 4 : 2, reliability: success ? 5 : 2, content });
}
function blockedResult(draft: ProcurementDraft, issue: string, runId: string | null = null, provider = "none"): ProcurementReasoningResult { return { ready: false, draft, issues: [issue], reasoningSummary: issue, runId, provider }; }
function schemaProperties(schema: unknown) { if (!schema || typeof schema !== "object" || !("properties" in schema)) return new Set<string>(); const properties = (schema as { properties?: unknown }).properties; return properties && typeof properties === "object" ? new Set(Object.keys(properties)) : new Set<string>(); }
function paymentMicros(payment: unknown) { if (!payment || typeof payment !== "object" || !("amount" in payment)) return null; const amount = Number((payment as { amount?: unknown }).amount); return Number.isFinite(amount) ? Math.round(amount * 1_000_000) : null; }
