import type { AgentPhoneWebhook } from "./agentphone";
import type { GroundworkRuntimeEnv } from "./runtime-env";

type JsonRecord = Record<string, unknown>;
const DEFAULT_PHONE_PROJECT_ID = "soma_drilled_shafts_001";

export type SupabasePhoneWriteStatus = "stored" | "not_configured";

export function isSupabasePhoneStoreConfigured(runtime: GroundworkRuntimeEnv) {
  return Boolean(runtime.SUPABASE_URL && supabaseKey(runtime));
}

export async function recordAgentPhoneWebhook(input: {
  runtime: GroundworkRuntimeEnv;
  webhookId: string;
  payload: AgentPhoneWebhook;
}): Promise<SupabasePhoneWriteStatus> {
  if (!isSupabasePhoneStoreConfigured(input.runtime)) return "not_configured";
  const data = input.payload.data;
  const projectId = input.runtime.GROUNDWORK_PROJECT_ID ?? DEFAULT_PHONE_PROJECT_ID;
  const callId = stringValue(data, "callId", "call_id");
  const messageId = stringValue(data, "messageId", "message_id", "id");
  const conversationId = stringValue(data, "conversationId", "conversation_id");
  const fromNumber = stringValue(data, "from", "fromNumber", "from_number");
  const toNumber = stringValue(data, "to", "toNumber", "to_number") ?? input.runtime.AGENTPHONE_NUMBER ?? null;
  const direction = stringValue(data, "direction") ?? inferDirection(fromNumber, input.runtime.AGENTPHONE_NUMBER);

  await supabaseUpsert(input.runtime, "phone_webhook_events", [{
    provider_event_id: input.webhookId,
    project_id: projectId,
    provider: "agentphone",
    event_type: input.payload.event,
    channel: input.payload.channel,
    agent_id: input.payload.agentId,
    number_id: stringValue(data, "numberId", "phoneNumberId", "number_id") ?? input.runtime.AGENTPHONE_NUMBER_ID ?? null,
    conversation_id: conversationId,
    call_id: callId,
    message_id: messageId,
    from_number: fromNumber,
    to_number: toNumber,
    direction,
    occurred_at: validTimestamp(input.payload.timestamp) ?? new Date().toISOString(),
    processing_status: "received",
    payload: redactSensitivePayload(input.payload),
  }], "provider_event_id");

  if (input.payload.channel === "voice" && callId) {
    await recordAgentPhoneCallSnapshot({
      runtime: input.runtime,
      call: {
        ...data,
        id: callId,
        agentId: input.payload.agentId,
        status: input.payload.event === "agent.call_ended" ? (stringValue(data, "status") ?? "completed") : (stringValue(data, "status") ?? "in-progress"),
        fromNumber,
        toNumber,
        direction,
      },
      disclosureGiven: Boolean(input.payload.conversationState?.disclosureAccepted),
    });
  }

  if (input.payload.event === "agent.message" && input.payload.channel !== "voice") {
    await recordAgentPhoneMessageSnapshot({
      runtime: input.runtime,
      message: {
        ...data,
        id: messageId ?? input.webhookId,
        agentId: input.payload.agentId,
        conversationId,
        fromNumber,
        toNumber,
        direction,
        channel: input.payload.channel,
        timestamp: input.payload.timestamp,
      },
    });
  }
  return "stored";
}

export async function recordAgentPhoneCallSnapshot(input: {
  runtime: GroundworkRuntimeEnv;
  call: JsonRecord;
  disclosureGiven?: boolean;
}): Promise<SupabasePhoneWriteStatus> {
  if (!isSupabasePhoneStoreConfigured(input.runtime)) return "not_configured";
  const callId = stringValue(input.call, "id", "callId", "call_id");
  if (!callId) throw new Error("AgentPhone call snapshot is missing an ID.");
  const projectId = input.runtime.GROUNDWORK_PROJECT_ID ?? DEFAULT_PHONE_PROJECT_ID;
  const state = objectValue(input.call, "conversationState", "conversation_state");
  const rawDurationSeconds = numberValue(input.call, "durationSeconds", "duration_seconds", "duration");
  await supabaseUpsert(input.runtime, "phone_calls", [{
    provider_call_id: callId,
    project_id: projectId,
    provider: "agentphone",
    agent_id: stringValue(input.call, "agentId", "agent_id") ?? input.runtime.AGENTPHONE_AGENT_ID ?? null,
    number_id: stringValue(input.call, "phoneNumberId", "numberId", "number_id") ?? input.runtime.AGENTPHONE_NUMBER_ID ?? null,
    from_number: stringValue(input.call, "fromNumber", "from", "from_number"),
    to_number: stringValue(input.call, "toNumber", "to", "to_number"),
    direction: stringValue(input.call, "direction"),
    status: stringValue(input.call, "status") ?? "unknown",
    started_at: timestampValue(input.call, "startedAt", "started_at", "createdAt", "created_at"),
    ended_at: timestampValue(input.call, "endedAt", "ended_at", "completedAt", "completed_at"),
    duration_seconds: rawDurationSeconds === null ? null : Math.max(0, Math.round(rawDurationSeconds)),
    summary: stringValue(input.call, "summary"),
    disclosure_given: input.disclosureGiven ?? booleanValue(state, "disclosureAccepted", "disclosure_accepted") ?? false,
    transcription_consent: booleanValue(state, "transcriptionConsent", "transcription_consent") ?? input.disclosureGiven ?? false,
    procurement_request_id: stringValue(input.call, "procurementRequestId", "procurement_request_id"),
  }], "provider_call_id");

  const transcripts = arrayValue(input.call, "transcripts", "transcript");
  const turns = transcripts.flatMap((value, index) => {
    if (typeof value === "string") {
      return value.trim() ? [{
        provider_turn_id: `${callId}:${index}`,
        project_id: projectId,
        provider_call_id: callId,
        turn_index: index,
        speaker: null,
        direction: null,
        content: value.trim(),
        occurred_at: null,
        confidence: null,
      }] : [];
    }
    if (!value || typeof value !== "object") return [];
    const turn = value as JsonRecord;
    const content = stringValue(turn, "content", "text", "transcript", "message");
    if (!content) return [];
    return [{
      provider_turn_id: `${callId}:${index}`,
      project_id: projectId,
      provider_call_id: callId,
      turn_index: index,
      speaker: stringValue(turn, "speaker", "role", "participant"),
      direction: stringValue(turn, "direction"),
      content,
      occurred_at: timestampValue(turn, "at", "timestamp", "createdAt", "created_at"),
      confidence: normalizedConfidence(numberValue(turn, "confidence")),
    }];
  });
  if (turns.length) await supabaseUpsert(input.runtime, "phone_transcript_turns", turns, "provider_call_id,turn_index");
  return "stored";
}

export async function recordAgentPhoneMessageSnapshot(input: {
  runtime: GroundworkRuntimeEnv;
  message: JsonRecord;
}): Promise<SupabasePhoneWriteStatus> {
  if (!isSupabasePhoneStoreConfigured(input.runtime)) return "not_configured";
  const messageId = stringValue(input.message, "id", "messageId", "message_id");
  if (!messageId) throw new Error("AgentPhone message snapshot is missing an ID.");
  const projectId = input.runtime.GROUNDWORK_PROJECT_ID ?? DEFAULT_PHONE_PROJECT_ID;
  await supabaseUpsert(input.runtime, "phone_messages", [{
    provider_message_id: messageId,
    project_id: projectId,
    provider: "agentphone",
    agent_id: stringValue(input.message, "agentId", "agent_id") ?? input.runtime.AGENTPHONE_AGENT_ID ?? null,
    number_id: stringValue(input.message, "numberId", "phoneNumberId", "number_id") ?? input.runtime.AGENTPHONE_NUMBER_ID ?? null,
    conversation_id: stringValue(input.message, "conversationId", "conversation_id"),
    from_number: stringValue(input.message, "fromNumber", "from", "from_number"),
    to_number: stringValue(input.message, "toNumber", "to", "to_number"),
    direction: stringValue(input.message, "direction"),
    channel: stringValue(input.message, "channel") ?? "sms",
    status: stringValue(input.message, "status"),
    body: stringValue(input.message, "body", "message", "text"),
    sent_at: timestampValue(input.message, "sentAt", "sent_at", "timestamp", "createdAt", "created_at"),
    delivered_at: timestampValue(input.message, "deliveredAt", "delivered_at"),
    procurement_request_id: stringValue(input.message, "procurementRequestId", "procurement_request_id"),
  }], "provider_message_id");
  return "stored";
}

export async function createPhoneSyncRun(runtime: GroundworkRuntimeEnv) {
  if (!isSupabasePhoneStoreConfigured(runtime)) return null;
  const id = crypto.randomUUID();
  await supabaseUpsert(runtime, "phone_sync_runs", [{
    id,
    project_id: runtime.GROUNDWORK_PROJECT_ID ?? DEFAULT_PHONE_PROJECT_ID,
    provider: "agentphone",
    status: "running",
    calls_seen: 0,
    messages_seen: 0,
  }], "id");
  return id;
}

export async function finishPhoneSyncRun(runtime: GroundworkRuntimeEnv, input: {
  id: string;
  status: "completed" | "failed";
  callsSeen: number;
  messagesSeen: number;
  error?: string | null;
}) {
  await supabasePatch(runtime, "phone_sync_runs", `id=eq.${encodeURIComponent(input.id)}`, {
    status: input.status,
    calls_seen: input.callsSeen,
    messages_seen: input.messagesSeen,
    error: input.error?.slice(0, 2000) ?? null,
    completed_at: new Date().toISOString(),
  });
}

async function supabaseUpsert(runtime: GroundworkRuntimeEnv, table: string, rows: JsonRecord[], onConflict: string) {
  if (!rows.length) return;
  const { url, key } = supabaseConnection(runtime);
  const endpoint = new URL(`/rest/v1/${table}`, url);
  endpoint.searchParams.set("on_conflict", onConflict);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: supabaseHeaders(key, "resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`Supabase ${table} upsert failed with ${response.status}: ${(await response.text()).slice(0, 500)}`);
}

async function supabasePatch(runtime: GroundworkRuntimeEnv, table: string, query: string, values: JsonRecord) {
  const { url, key } = supabaseConnection(runtime);
  const endpoint = new URL(`/rest/v1/${table}?${query}`, url);
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(key, "return=minimal"),
    body: JSON.stringify(values),
  });
  if (!response.ok) throw new Error(`Supabase ${table} update failed with ${response.status}: ${(await response.text()).slice(0, 500)}`);
}

function supabaseConnection(runtime: GroundworkRuntimeEnv) {
  const key = supabaseKey(runtime);
  if (!runtime.SUPABASE_URL || !key) throw new Error("Supabase phone store is not configured.");
  const url = new URL(runtime.SUPABASE_URL);
  if (url.protocol !== "https:" || (!url.hostname.endsWith(".supabase.co") && url.hostname !== "localhost")) {
    throw new Error("SUPABASE_URL must be an HTTPS supabase.co project URL.");
  }
  return { url, key };
}

function supabaseKey(runtime: GroundworkRuntimeEnv) {
  return runtime.SUPABASE_SECRET_KEY ?? runtime.SUPABASE_SERVICE_ROLE_KEY ?? null;
}

function supabaseHeaders(key: string, prefer: string) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    prefer,
  };
}

function redactSensitivePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitivePayload);
  if (!value || typeof value !== "object") return value;
  const result: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll("_", "");
    if (["authorization", "apikey", "secret", "mediaurl", "recordingurl", "downloadurl"].includes(normalized)) {
      result[key] = "[redacted]";
    } else {
      result[key] = redactSensitivePayload(child);
    }
  }
  return result;
}

function stringValue(value: JsonRecord, ...keys: string[]) {
  for (const key of keys) if (typeof value[key] === "string" && value[key]) return value[key] as string;
  return null;
}

function numberValue(value: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    if (value[key] === null || value[key] === undefined || value[key] === "") continue;
    const number = Number(value[key]);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function booleanValue(value: JsonRecord | null, ...keys: string[]) {
  if (!value) return null;
  for (const key of keys) if (typeof value[key] === "boolean") return value[key] as boolean;
  return null;
}

function objectValue(value: JsonRecord, ...keys: string[]): JsonRecord | null {
  for (const key of keys) if (value[key] && typeof value[key] === "object" && !Array.isArray(value[key])) return value[key] as JsonRecord;
  return null;
}

function arrayValue(value: JsonRecord, ...keys: string[]) {
  for (const key of keys) if (Array.isArray(value[key])) return value[key] as unknown[];
  return [];
}

function timestampValue(value: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    const timestamp = validTimestamp(value[key]);
    if (timestamp) return timestamp;
  }
  return null;
}

function validTimestamp(value: unknown) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function normalizedConfidence(value: number | null) {
  if (value === null) return null;
  if (value > 1 && value <= 100) return value / 100;
  return value >= 0 && value <= 1 ? value : null;
}

function inferDirection(fromNumber: string | null, agentNumber?: string) {
  if (!fromNumber || !agentNumber) return null;
  return fromNumber === agentNumber ? "outbound" : "inbound";
}
