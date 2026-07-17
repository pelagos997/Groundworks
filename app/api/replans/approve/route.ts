import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "../../../../db";
import { approvedReplans, scheduleCandidates } from "../../../../db/schema";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { runReplanGraph } from "../../../../lib/replan-graph";
import { DEFAULT_PROJECT_ID, getRuntimeEnv } from "../../../../lib/runtime-env";

const ApprovalSchema = z.object({
  commitId: z.string().min(1),
  event: z.enum(["hot_weather", "inspector_cancelled", "crew_declined", "shaft_obstruction"]),
});

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = ApprovalSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid approval request." }, { status: 400 });
  const canonical = await runReplanGraph(parsed.data.event);
  if (canonical.commitId !== parsed.data.commitId || !canonical.tests.every((test) => test.passed)) {
    return NextResponse.json({ error: "Candidate does not match a fully validated plan." }, { status: 409 });
  }
  const db = getDb();
  const projectId = getRuntimeEnv().GROUNDWORK_PROJECT_ID ?? DEFAULT_PROJECT_ID;
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  await db.insert(approvedReplans).values({
    commitId: canonical.commitId,
    projectId,
    event: canonical.event,
    approvedBy: user.email,
    expiresAt,
  }).onConflictDoUpdate({
    target: approvedReplans.commitId,
    set: { approvedBy: user.email, approvedAt: new Date().toISOString(), expiresAt },
  });
  await db.update(scheduleCandidates).set({ status: "approved" }).where(eq(scheduleCandidates.commitId, canonical.commitId));
  return NextResponse.json({ approved: true, commitId: canonical.commitId, expiresAt });
}
