import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "../../../../db";
import { procurementRequests, vendorQuotes } from "../../../../db/schema";
import { resolveHpileVendors } from "../../../../lib/procurement";
import { quoteSummary, rankQuotes } from "../../../../lib/quote-comparison";
import { getRuntimeEnv } from "../../../../lib/runtime-env";

const QuoteSchema = z.object({
  requestId: z.string().min(1),
  vendorId: z.string().min(1),
  vendorName: z.string().min(1),
  vendorEmail: z.string().email(),
  vendorQuoteRef: z.string().min(2).max(80),
  materialCents: z.number().int().nonnegative().nullable().default(null),
  freightCents: z.number().int().nonnegative().nullable().default(null),
  taxCents: z.number().int().nonnegative().nullable().default(null),
  deliveredTotalCents: z.number().int().positive(),
  earliestDeliveryAt: z.string().min(10),
  validUntil: z.string().datetime(),
  section: z.string().min(1),
  quantity: z.number().int().positive(),
  pieceLengthFt: z.number().int().positive(),
  grade: z.string().min(1),
  domesticCompliance: z.enum(["domestic_required", "not_required"]),
  mtrIncluded: z.boolean(),
  writtenQuoteReceived: z.literal(true),
  source: z.enum(["email", "nexla", "manual_verified"]),
  evidenceReference: z.string().min(3).max(500),
});

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!runtime.GROUNDWORK_PROCUREMENT_WEBHOOK_TOKEN || supplied !== runtime.GROUNDWORK_PROCUREMENT_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "Procurement webhook authentication required." }, { status: 401 });
  }
  const parsed = QuoteSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid written quote payload.", issues: parsed.error.issues }, { status: 400 });
  const input = parsed.data;
  const vendor = resolveHpileVendors(runtime).find((item) => item.id === input.vendorId);
  if (!vendor) return NextResponse.json({ error: "Vendor is not in the verified RFQ directory." }, { status: 400 });
  const emailDomain = input.vendorEmail.toLowerCase().split("@").at(-1) ?? "";
  if (!vendor.allowedEmailDomains.some((domain) => emailDomain === domain || emailDomain.endsWith(`.${domain}`))) {
    return NextResponse.json({ error: "Written quote email is outside the verified vendor domains." }, { status: 400 });
  }
  const db = getDb();
  const [materialRequest] = await db.select().from(procurementRequests).where(eq(procurementRequests.id, input.requestId)).limit(1);
  if (!materialRequest) return NextResponse.json({ error: "Procurement request not found." }, { status: 404 });
  const [duplicate] = await db.select({ id: vendorQuotes.id }).from(vendorQuotes).where(and(
    eq(vendorQuotes.requestId, input.requestId),
    eq(vendorQuotes.vendorId, input.vendorId),
    eq(vendorQuotes.vendorQuoteRef, input.vendorQuoteRef),
  )).limit(1);
  if (duplicate) return NextResponse.json({ quoteId: duplicate.id, duplicate: true }, { status: 200 });
  const matchesRequest = input.section.toUpperCase() === materialRequest.section.toUpperCase()
    && input.quantity === materialRequest.quantity
    && input.pieceLengthFt === materialRequest.pieceLengthFt
    && input.grade.toUpperCase() === materialRequest.grade.toUpperCase()
    && input.domesticCompliance === materialRequest.domesticRequirement
    && (!materialRequest.mtrRequired || input.mtrIncluded);
  const quoteId = `quote_${crypto.randomUUID().slice(0, 12)}`;
  await db.insert(vendorQuotes).values({
    id: quoteId,
    projectId: materialRequest.projectId,
    requestId: input.requestId,
    vendorId: input.vendorId,
    vendorName: vendor.name,
    vendorEmail: input.vendorEmail,
    vendorPhone: vendor.phone,
    vendorQuoteRef: input.vendorQuoteRef,
    materialCents: input.materialCents,
    freightCents: input.freightCents,
    taxCents: input.taxCents,
    deliveredTotalCents: input.deliveredTotalCents,
    earliestDeliveryAt: input.earliestDeliveryAt,
    validUntil: input.validUntil,
    grade: input.grade,
    domesticCompliance: input.domesticCompliance,
    mtrIncluded: input.mtrIncluded,
    writtenQuoteReceived: true,
    source: input.source,
    status: matchesRequest ? "qualified" : "exception_review",
    rawJson: JSON.stringify({ ...input, evidenceReference: input.evidenceReference }),
  });
  await db.update(procurementRequests).set({ status: matchesRequest ? "quoted" : "quote_exception", updatedAt: new Date().toISOString() })
    .where(eq(procurementRequests.id, input.requestId));
  const quotes = await db.select().from(vendorQuotes).where(and(eq(vendorQuotes.requestId, input.requestId), eq(vendorQuotes.status, "qualified")));
  const ranked = rankQuotes(quotes, materialRequest.requiredOnSiteAt);
  return NextResponse.json({
    quoteId,
    qualified: matchesRequest,
    exception: matchesRequest ? null : "Quote does not exactly match section, count, length, grade, domestic requirement, or MTR requirement.",
    recommendation: quoteSummary(quotes, materialRequest.requiredOnSiteAt),
    rankedQuoteIds: ranked.map((quote) => quote.id),
  }, { status: matchesRequest ? 201 : 202 });
}
