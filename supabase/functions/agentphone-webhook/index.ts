// Public AgentPhone ingress for Supabase Edge Functions.
// JWT verification is disabled in config.toml; every request is instead verified
// with AgentPhone's timestamped HMAC before data is written or forwarded.

type JsonRecord = Record<string, unknown>;

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const rawBody = await request.text();
  const signature = request.headers.get("x-webhook-signature");
  const timestamp = request.headers.get("x-webhook-timestamp");
  const webhookId = request.headers.get("x-webhook-id");
  const webhookSecret = Deno.env.get("AGENTPHONE_WEBHOOK_SECRET") ?? "";
  if (!webhookId || !await verifyWebhook(rawBody, signature, timestamp, webhookSecret)) {
    return json({ error: "Invalid AgentPhone webhook signature." }, 401);
  }
  let payload: JsonRecord;
  try {
    payload = JSON.parse(rawBody) as JsonRecord;
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  try {
    await persistEvent(webhookId, payload);
  } catch (error) {
    console.error("Supabase webhook persistence failed", error instanceof Error ? error.message : "unknown_error");
    return json({ error: "Phone event persistence failed." }, 503);
  }

  const upstream = Deno.env.get("GROUNDWORK_UPSTREAM_WEBHOOK_URL");
  const bypassToken = Deno.env.get("GROUNDWORK_UPSTREAM_BYPASS_TOKEN");
  if (!upstream || !bypassToken) return json({ received: true, stored: true }, 200);
  const upstreamUrl = new URL(upstream);
  if (upstreamUrl.protocol !== "https:") return json({ error: "Upstream URL rejected." }, 500);
  const response = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-id": webhookId,
      "x-webhook-signature": signature ?? "",
      "x-webhook-timestamp": timestamp ?? "",
      "OAI-Sites-Authorization": `Bearer ${bypassToken}`,
    },
    body: rawBody,
  });
  return new Response(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json" } });
});

async function persistEvent(webhookId: string, payload: JsonRecord) {
  const data = isRecord(payload.data) ? payload.data : {};
  const projectId = Deno.env.get("GROUNDWORK_PROJECT_ID") ?? "soma_drilled_shafts_001";
  const eventType = stringValue(payload, "event") ?? "unknown";
  const channel = stringValue(payload, "channel") ?? "unknown";
  const callId = stringValue(data, "callId", "call_id");
  const messageId = stringValue(data, "messageId", "message_id", "id");
  const common = {
    project_id: projectId,
    agent_id: stringValue(payload, "agentId", "agent_id"),
    number_id: stringValue(data, "numberId", "phoneNumberId", "number_id"),
    from_number: stringValue(data, "from", "fromNumber", "from_number"),
    to_number: stringValue(data, "to", "toNumber", "to_number"),
    direction: stringValue(data, "direction"),
  };
  await upsert("phone_webhook_events", [{
    provider_event_id: webhookId,
    project_id: projectId,
    provider: "agentphone",
    event_type: eventType,
    channel,
    ...common,
    conversation_id: stringValue(data, "conversationId", "conversation_id"),
    call_id: callId,
    message_id: messageId,
    occurred_at: validTimestamp(payload.timestamp) ?? new Date().toISOString(),
    processing_status: "received",
    payload: redact(payload),
  }], "provider_event_id");

  if (channel === "voice" && callId) {
    const state = isRecord(payload.conversationState) ? payload.conversationState : {};
    await upsert("phone_calls", [{
      provider_call_id: callId,
      provider: "agentphone",
      ...common,
      status: eventType === "agent.call_ended" ? (stringValue(data, "status") ?? "completed") : (stringValue(data, "status") ?? "in-progress"),
      started_at: timestampValue(data, "startedAt", "started_at"),
      ended_at: timestampValue(data, "endedAt", "ended_at", "completedAt", "completed_at"),
      duration_seconds: numberValue(data, "durationSeconds", "duration_seconds", "duration"),
      summary: stringValue(data, "summary"),
      disclosure_given: state.disclosureAccepted === true,
      transcription_consent: state.transcriptionConsent === true || state.disclosureAccepted === true,
      procurement_request_id: stringValue(data, "procurementRequestId", "procurement_request_id"),
    }], "provider_call_id");
    const transcripts = Array.isArray(data.transcripts) ? data.transcripts : [];
    const turns = transcripts.flatMap((value, index) => {
      const turn = isRecord(value) ? value : {};
      const content = typeof value === "string" ? value : stringValue(turn, "content", "text", "transcript", "message");
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
      }];
    });
    if (turns.length) await upsert("phone_transcript_turns", turns, "provider_call_id,turn_index");
  }

  if (eventType === "agent.message" && channel !== "voice") {
    await upsert("phone_messages", [{
      provider_message_id: messageId ?? webhookId,
      provider: "agentphone",
      ...common,
      conversation_id: stringValue(data, "conversationId", "conversation_id"),
      channel,
      status: stringValue(data, "status"),
      body: stringValue(data, "body", "message", "text"),
      sent_at: timestampValue(data, "sentAt", "sent_at", "timestamp") ?? validTimestamp(payload.timestamp),
      delivered_at: timestampValue(data, "deliveredAt", "delivered_at"),
      procurement_request_id: stringValue(data, "procurementRequestId", "procurement_request_id"),
    }], "provider_message_id");
  }
}

async function upsert(table: string, rows: JsonRecord[], onConflict: string) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("Supabase function bindings are unavailable.");
  const endpoint = new URL(`/rest/v1/${table}`, url);
  endpoint.searchParams.set("on_conflict", onConflict);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`Supabase ${table} upsert failed with ${response.status}.`);
}

async function verifyWebhook(body: string, signature: string | null, timestamp: string | null, secret: string) {
  if (!signature || !timestamp || !secret || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const expected = `sha256=${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const normalized = key.toLowerCase().replaceAll("_", "");
    return [key, ["authorization", "apikey", "secret", "mediaurl", "recordingurl", "downloadurl"].includes(normalized) ? "[redacted]" : redact(child)];
  }));
}

function isRecord(value: unknown): value is JsonRecord { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function stringValue(value: JsonRecord, ...keys: string[]) { for (const key of keys) if (typeof value[key] === "string" && value[key]) return value[key] as string; return null; }
function numberValue(value: JsonRecord, ...keys: string[]) { for (const key of keys) { if (value[key] === null || value[key] === undefined || value[key] === "") continue; const result = Number(value[key]); if (Number.isFinite(result)) return result; } return null; }
function validTimestamp(value: unknown) { return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null; }
function timestampValue(value: JsonRecord, ...keys: string[]) { for (const key of keys) { const result = validTimestamp(value[key]); if (result) return result; } return null; }
function json(value: unknown, status: number) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
