import { NextResponse } from "next/server";
import { normalizeForemanCall } from "../../../lib/nexla-data-products";
import { deliverToNexla } from "../../../lib/nexla";
import { getRuntimeEnv } from "../../../lib/runtime-env";

type FieldEventRequest = { transcript?: string };

export async function POST(request: Request) {
  const body = (await request.json()) as FieldEventRequest;
  const transcript = body.transcript?.trim();

  if (!transcript) {
    return NextResponse.json({ error: "A confirmed transcript is required." }, { status: 400 });
  }

  const event = normalizeForemanCall(transcript);
  const nexlaStatus = await deliverToNexla(getRuntimeEnv().NEXLA_FIELD_EVENTS_WEBHOOK_URL, event);

  return NextResponse.json({
    event,
    nexla: {
      status: nexlaStatus,
      dataProduct: "groundwork_field_events_v1",
      output: "groundwork_schedule_events_v1",
    },
  });
}
