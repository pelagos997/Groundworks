import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../../../db";
import { vendorRfqCalls } from "../../../../../../db/schema";
import { getRuntimeEnv } from "../../../../../../lib/runtime-env";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const runtime = getRuntimeEnv();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!runtime.GROUNDWORK_PROCUREMENT_WEBHOOK_TOKEN || supplied !== runtime.GROUNDWORK_PROCUREMENT_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "Procurement webhook authentication required." }, { status: 401 });
  }
  if (!runtime.ZERO_PRIVATE_KEY?.startsWith("0x")) {
    return NextResponse.json({ error: "Zero signing wallet is not configured." }, { status: 503 });
  }
  const { id } = await context.params;
  const db = getDb();
  const [call] = await db.select().from(vendorRfqCalls).where(eq(vendorRfqCalls.id, id)).limit(1);
  if (!call?.externalCallId) return NextResponse.json({ error: "RFQ call not found or has no external call ID." }, { status: 404 });

  const { ZeroClient } = await import("@zeroxyz/sdk");
  const client = ZeroClient.fromPrivateKey(runtime.ZERO_PRIVATE_KEY as `0x${string}`);
  const search = await client.search("get StablePhone call status and transcript", {
    limit: 5,
    availabilityStatus: "healthy",
    maxCost: "0",
  });
  let selected: Awaited<ReturnType<typeof client.capabilities.get>> | null = null;
  let capabilityId: string | null = null;
  for (const match of search.capabilities) {
    if (match.method !== "GET" || !match.url.includes(":id")) continue;
    const token = match.token ?? match.id;
    selected = await client.capabilities.get(token);
    capabilityId = token;
    break;
  }
  if (!selected || !capabilityId) {
    return NextResponse.json({ error: "Zero found no healthy compatible call-status capability." }, { status: 503 });
  }
  const url = selected.url.replace(":id", encodeURIComponent(call.externalCallId));
  const result = await client.fetch(url, { method: "GET", maxPay: "0", capabilityId });
  const body = asRecord(result.body);
  const status = firstString(body, ["status", "state", "call_status"]) ?? (result.outcome === "success" ? "unknown" : "failed");
  const transcript = firstString(body, ["transcript", "text", "summary"]);
  await db.update(vendorRfqCalls).set({
    status,
    transcript,
    responseJson: JSON.stringify({ status: result.status, body: result.body, warnings: result.warnings }),
    updatedAt: new Date().toISOString(),
  }).where(eq(vendorRfqCalls.id, id));
  return NextResponse.json({ id, status, transcript, outcome: result.outcome });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function firstString(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof value[key] === "string") return value[key] as string;
  return null;
}
