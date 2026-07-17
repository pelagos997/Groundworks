import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "../../../../../db";
import { procurementRequests, purchaseOrders } from "../../../../../db/schema";
import { getRuntimeEnv } from "../../../../../lib/runtime-env";

const AcknowledgementSchema = z.object({
  poNumber: z.string().regex(/^PO[-A-Z0-9]{3,32}$/i),
  vendorAcknowledgementRef: z.string().min(3).max(200),
  acknowledgedAt: z.string().datetime().default(() => new Date().toISOString()),
});

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!runtime.GROUNDWORK_PROCUREMENT_WEBHOOK_TOKEN || supplied !== runtime.GROUNDWORK_PROCUREMENT_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "Procurement webhook authentication required." }, { status: 401 });
  }
  const parsed = AcknowledgementSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid vendor acknowledgement." }, { status: 400 });
  const db = getDb();
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.poNumber, parsed.data.poNumber.toUpperCase())).limit(1);
  if (!po) return NextResponse.json({ error: "Purchase order not found." }, { status: 404 });
  await db.update(purchaseOrders).set({
    status: "acknowledged",
    vendorAcknowledgedAt: parsed.data.acknowledgedAt,
    externalReference: parsed.data.vendorAcknowledgementRef,
  }).where(eq(purchaseOrders.id, po.id));
  await db.update(procurementRequests).set({ status: "ordered_acknowledged", updatedAt: parsed.data.acknowledgedAt })
    .where(eq(procurementRequests.id, po.requestId));
  return NextResponse.json({ purchaseOrderId: po.id, status: "acknowledged" });
}
