import { NextResponse } from "next/server";

type CommunicationRequest = {
  kind?: "voice" | "email";
  approved?: boolean;
  replanId?: string;
};

const queries = {
  voice: "place an AI disclosed phone call to a construction field crew",
  email: "send a transactional schedule confirmation email to a construction crew",
};

export async function POST(request: Request) {
  const body = (await request.json()) as CommunicationRequest;

  if (!body.approved) {
    return NextResponse.json(
      { error: "A committed schedule approval is required before communication discovery." },
      { status: 403 },
    );
  }

  if (!body.kind || !(body.kind in queries)) {
    return NextResponse.json({ error: "Unknown communication kind." }, { status: 400 });
  }

  let capability: { id: string; name: string; method: string; url: string } | null = null;
  let discoveryStatus: "live" | "fallback" = "fallback";

  try {
    const { ZeroClient } = await import("@zeroxyz/sdk");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const client = new ZeroClient();
    const result = await client.search(queries[body.kind], {
      limit: 3,
      availabilityStatus: "healthy",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const match = result.capabilities[0];
    if (match) {
      capability = {
        id: match.token ?? match.id,
        name: match.name,
        method: match.method ?? "POST",
        url: match.url,
      };
      discoveryStatus = "live";
    }
  } catch {
    // The stage demo remains deterministic when Zero discovery is unavailable.
  }

  return NextResponse.json({
    mode: "sandbox",
    discoveryStatus,
    capability,
    action: body.kind === "voice" ? "call_prepared" : "email_prepared",
    replanId: body.replanId,
    receiptId: `zero_demo_${crypto.randomUUID().slice(0, 8)}`,
    disclosure: body.kind === "voice" ? "AI identity and recording disclosure required" : null,
  });
}
