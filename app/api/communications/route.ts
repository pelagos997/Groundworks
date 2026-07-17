import { NextResponse } from "next/server";

type CapabilityKind = "voice" | "email" | "sms" | "weather" | "transcription";

type CommunicationRequest = {
  kind?: CapabilityKind;
  approved?: boolean;
  replanId?: string;
};

const queries: Record<CapabilityKind, string> = {
  voice: "place an AI-disclosed phone call to a construction field crew and return a transcript",
  email: "send a transactional schedule confirmation email to a construction crew",
  sms: "send an SMS with a project field-report confirmation link",
  weather: "live National Weather Service alerts and jobsite wind conditions by coordinates",
  transcription: "transcribe a multilingual construction field voice memo",
};

export async function POST(request: Request) {
  const body = (await request.json()) as CommunicationRequest;

  if (!body.kind || !(body.kind in queries)) {
    return NextResponse.json({ error: "Unknown capability kind." }, { status: 400 });
  }

  const sideEffect = ["voice", "email", "sms"].includes(body.kind);
  let candidates: Array<{
    id: string;
    name: string;
    brand: string;
    method: string;
    url: string;
    price: string;
    rating: string;
    availability: string;
  }> = [];
  let discoveryStatus: "live" | "fallback" = "fallback";

  try {
    const { ZeroClient } = await import("@zeroxyz/sdk");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const client = new ZeroClient();
      const result = await client.search(queries[body.kind], {
        limit: 3,
        availabilityStatus: "healthy",
        signal: controller.signal,
      });
      candidates = result.capabilities.map((match) => ({
        id: match.token ?? match.id,
        name: match.canonicalName ?? match.name,
        brand: match.brandName ?? new URL(match.url).hostname,
        method: match.method ?? "GET",
        url: match.url,
        price: match.pricing?.summary ?? `${match.cost.amount} ${match.cost.asset}`,
        rating: match.rating.stars ?? "Unrated",
        availability: match.availabilityStatus ?? "unknown",
      }));
      if (sideEffect) {
        candidates.sort((left, right) => Number(right.method === "POST") - Number(left.method === "POST"));
      }
      if (candidates.length > 0) discoveryStatus = "live";
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // The deterministic demo still shows the requested capability when discovery is unavailable.
  }

  return NextResponse.json({
    mode: "discovery",
    kind: body.kind,
    query: queries[body.kind],
    discoveryStatus,
    candidates,
    selected: candidates[0] ?? null,
    policy: sideEffect && !body.approved ? "approval_required" : "eligible",
    action: sideEffect ? "prepared_not_executed" : "read_only_discovery",
    replanId: body.replanId,
    receiptId: `zero_discovery_${crypto.randomUUID().slice(0, 8)}`,
  });
}
