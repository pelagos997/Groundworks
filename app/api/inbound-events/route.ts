import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../db";
import { actionReceipts, fieldEvents, fieldMedia, policyDecisions, scheduleCandidates } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { DEFAULT_PROJECT_ID, getRuntimeEnv } from "../../../lib/runtime-env";

export async function GET() {
  if (!(await getChatGPTUser())) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const projectId = getRuntimeEnv().GROUNDWORK_PROJECT_ID ?? DEFAULT_PROJECT_ID;
  const db = getDb();
  const [events, media, decisions, receipts, candidates] = await Promise.all([
    db.select().from(fieldEvents).where(eq(fieldEvents.projectId, projectId)).orderBy(desc(fieldEvents.createdAt)).limit(20),
    db.select().from(fieldMedia).where(eq(fieldMedia.projectId, projectId)).orderBy(desc(fieldMedia.createdAt)).limit(20),
    db.select().from(policyDecisions).where(eq(policyDecisions.projectId, projectId)).orderBy(desc(policyDecisions.createdAt)).limit(20),
    db.select().from(actionReceipts).where(eq(actionReceipts.projectId, projectId)).orderBy(desc(actionReceipts.createdAt)).limit(20),
    db.select().from(scheduleCandidates).where(eq(scheduleCandidates.projectId, projectId)).orderBy(desc(scheduleCandidates.createdAt)).limit(5),
  ]);
  return NextResponse.json({
    events: events.map((event) => ({ ...event, caller: maskPhone(event.caller) })),
    media: media.map((item) => ({ ...item, caller: maskPhone(item.caller), url: `/api/media/${item.id}` })),
    decisions: decisions.map((item) => ({ ...item, reasons: JSON.parse(item.reasonsJson) as string[], reasonsJson: undefined })),
    receipts,
    candidates: candidates.map((item) => ({ ...item, result: JSON.parse(item.resultJson) as unknown, resultJson: undefined })),
  });
}

function maskPhone(phone: string) {
  return phone.length > 4 ? `••• ••• ${phone.slice(-4)}` : "private";
}
