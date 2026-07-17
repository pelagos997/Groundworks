import { NextResponse } from "next/server";
import { normalizeForemanCall } from "../../../lib/nexla-data-products";

type FieldEventRequest = { transcript?: string };

export async function POST(request: Request) {
  const body = (await request.json()) as FieldEventRequest;
  const transcript = body.transcript?.trim();

  if (!transcript) {
    return NextResponse.json({ error: "A confirmed transcript is required." }, { status: 400 });
  }

  const event = normalizeForemanCall(transcript);
  const webhookUrl = process.env.NEXLA_FIELD_EVENTS_WEBHOOK_URL;
  let nexlaStatus: "demo_replay" | "delivered" | "delivery_failed" = "demo_replay";

  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });
      nexlaStatus = response.ok ? "delivered" : "delivery_failed";
    } catch {
      nexlaStatus = "delivery_failed";
    }
  }

  return NextResponse.json({
    event,
    nexla: {
      status: nexlaStatus,
      dataProduct: "groundwork_field_events_v1",
      output: "groundwork_schedule_events_v1",
    },
  });
}
