import { NextResponse } from "next/server";
import { z } from "zod";
import { runReplanGraph } from "../../../lib/replan-graph";

const RequestSchema = z.object({
  event: z.enum(["hot_weather", "inspector_cancelled", "crew_declined", "shaft_obstruction"]),
});

export async function POST(request: Request) {
  const parsed = RequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid replan event" }, { status: 400 });
  }
  const result = await runReplanGraph(parsed.data.event);
  return NextResponse.json(result);
}
