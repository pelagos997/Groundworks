import { NextResponse } from "next/server";
import {
  createPhoneSyncRun,
  finishPhoneSyncRun,
  isSupabasePhoneStoreConfigured,
  recordAgentPhoneCallSnapshot,
  recordAgentPhoneMessageSnapshot,
} from "../../../../lib/supabase-phone-data";
import { getRuntimeEnv } from "../../../../lib/runtime-env";

type JsonRecord = Record<string, unknown>;

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!runtime.GROUNDWORK_INTERNAL_API_TOKEN || supplied !== runtime.GROUNDWORK_INTERNAL_API_TOKEN) {
    return NextResponse.json({ error: "Internal sync authentication required." }, { status: 401 });
  }
  if (!runtime.AGENTPHONE_API_KEY || !runtime.AGENTPHONE_NUMBER_ID) {
    return NextResponse.json({ error: "AgentPhone sync credentials are incomplete." }, { status: 503 });
  }
  if (!isSupabasePhoneStoreConfigured(runtime)) {
    return NextResponse.json({ error: "Supabase phone store is not configured." }, { status: 503 });
  }

  const syncRunId = await createPhoneSyncRun(runtime);
  if (!syncRunId) return NextResponse.json({ error: "Supabase phone store is not configured." }, { status: 503 });
  let callsSeen = 0;
  let messagesSeen = 0;
  try {
    const [callsPayload, messagesPayload] = await Promise.all([
      agentPhoneGet(runtime.AGENTPHONE_API_KEY, "/v1/calls?limit=50"),
      agentPhoneGet(runtime.AGENTPHONE_API_KEY, `/v1/numbers/${encodeURIComponent(runtime.AGENTPHONE_NUMBER_ID)}/messages?limit=50`),
    ]);
    const calls = recordsFrom(callsPayload, "calls");
    const messages = recordsFrom(messagesPayload, "messages");

    for (const call of calls) {
      const callId = firstString(call, "id", "callId", "call_id");
      const detailed = callId ? await agentPhoneGet(runtime.AGENTPHONE_API_KEY, `/v1/calls/${encodeURIComponent(callId)}`) : call;
      await recordAgentPhoneCallSnapshot({ runtime, call: asRecord(detailed) });
      callsSeen += 1;
    }
    for (const message of messages) {
      await recordAgentPhoneMessageSnapshot({ runtime, message });
      messagesSeen += 1;
    }
    await finishPhoneSyncRun(runtime, { id: syncRunId, status: "completed", callsSeen, messagesSeen });
    return NextResponse.json({ syncRunId, callsSeen, messagesSeen, status: "completed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync_failed";
    await finishPhoneSyncRun(runtime, { id: syncRunId, status: "failed", callsSeen, messagesSeen, error: message });
    return NextResponse.json({ syncRunId, callsSeen, messagesSeen, status: "failed", error: message }, { status: 502 });
  }
}

async function agentPhoneGet(apiKey: string, path: string) {
  const url = new URL(path, "https://api.agentphone.ai");
  if (url.hostname !== "api.agentphone.ai") throw new Error("AgentPhone request host rejected.");
  const response = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`AgentPhone ${url.pathname} returned ${response.status}.`);
  return response.json() as Promise<unknown>;
}

function recordsFrom(value: unknown, key: string): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  const nested = value[key] ?? value.data;
  return Array.isArray(nested) ? nested.filter(isRecord) : [];
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstString(value: JsonRecord, ...keys: string[]) {
  for (const key of keys) if (typeof value[key] === "string") return value[key] as string;
  return null;
}
