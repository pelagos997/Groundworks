import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  AgentPhoneWebhookSchema,
  buildReadback,
  getCaller,
  getConversationId,
  getMediaUrl,
  getWebhookText,
  hasReportableFact,
  isExplicitConfirmation,
  parseFieldObservation,
  sha256Hex,
  verifyAgentPhoneWebhook,
  type FieldObservation,
} from "../../../../lib/agentphone";
import {
  POLICY_VERSION,
  MAX_MEDIA_BYTES,
  classifyRestrictedRequest,
  evaluateInboundContact,
  evaluateMedia,
  findContact,
  type FieldContact,
  type PolicyDecision,
} from "../../../../lib/agent-policy";
import { getDb } from "../../../../db";
import {
  contactConversations,
  fieldEvents,
  fieldMedia,
  policyDecisions,
  scheduleCandidates,
  webhookDeliveries,
} from "../../../../db/schema";
import { createFieldEvent } from "../../../../lib/nexla-data-products";
import { deliverToNexla } from "../../../../lib/nexla";
import { runReplanGraph } from "../../../../lib/replan-graph";
import { DEFAULT_PROJECT_ID, getRuntimeEnv, type GroundworkRuntimeEnv } from "../../../../lib/runtime-env";

type VoiceResponse = { text: string; hangup?: boolean; send_message?: { body: string } };

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const rawBody = await request.text();
  if (!runtime.AGENTPHONE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Inbound contact is not configured." }, { status: 503 });
  }

  const signatureValid = await verifyAgentPhoneWebhook({
    rawBody,
    signature: request.headers.get("x-webhook-signature"),
    timestamp: request.headers.get("x-webhook-timestamp"),
    secret: runtime.AGENTPHONE_WEBHOOK_SECRET,
  });
  if (!signatureValid) return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });

  const parsed = AgentPhoneWebhookSchema.safeParse(safeJson(rawBody));
  if (!parsed.success) return NextResponse.json({ error: "Invalid AgentPhone event." }, { status: 400 });

  const webhookId = request.headers.get("x-webhook-id");
  if (!webhookId) return NextResponse.json({ error: "Missing webhook delivery ID." }, { status: 400 });

  const payload = parsed.data;
  const caller = getCaller(payload);
  const db = getDb();
  const payloadHash = await sha256Hex(rawBody);
  const inserted = await db.insert(webhookDeliveries).values({
    id: webhookId,
    provider: "agentphone",
    eventType: payload.event,
    channel: payload.channel,
    caller,
    status: "processing",
    payloadHash,
    payloadJson: rawBody,
  }).onConflictDoNothing().returning({ id: webhookDeliveries.id });

  if (inserted.length === 0) {
    const [prior] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, webhookId)).limit(1);
    if (payload.channel === "voice" && prior?.responseJson) {
      return NextResponse.json(JSON.parse(prior.responseJson) as VoiceResponse);
    }
    return NextResponse.json({ received: true, duplicate: true });
  }

  const contact = findContact(caller, runtime.GROUNDWORK_CONTACTS_JSON, runtime.GROUNDWORK_ALLOWED_CALLERS);
  const inboundDecision = evaluateInboundContact(contact);
  await recordPolicyDecision(db, projectId(runtime), caller || "unknown", "receive_field_contact", inboundDecision);

  try {
    if (inboundDecision.decision !== "allow" || !contact) {
      const response = payload.channel === "voice"
        ? { text: "This project line only accepts approved field contacts. Please contact the project superintendent.", hangup: true }
        : { received: true, accepted: false };
      await finishDelivery(db, webhookId, "rejected_policy", response);
      return NextResponse.json(response);
    }

    if (payload.event === "agent.call_ended" || payload.event === "agent.reaction") {
      await finishDelivery(db, webhookId, "recorded", { received: true });
      return NextResponse.json({ received: true });
    }

    const conversation = await getOrCreateConversation(db, runtime, payload, contact);
    const response = payload.channel === "voice"
      ? await handleVoice({ db, runtime, webhookId, payload, contact, conversation })
      : await handleMessage({ db, runtime, webhookId, payload, contact, conversation });
    await finishDelivery(db, webhookId, "processed", response);
    return NextResponse.json(response);
  } catch (error) {
    await finishDelivery(db, webhookId, "failed", { error: error instanceof Error ? error.message : "processing_failed" });
    return NextResponse.json({ error: "Inbound event could not be processed." }, { status: 500 });
  }
}

async function handleVoice(input: HandlerInput): Promise<VoiceResponse> {
  const text = getWebhookText(input.payload);
  if (!input.conversation.disclosureAccepted) {
    if (!/\b(i consent|consent|i agree|agree)\b/i.test(text)) {
      await input.db.update(contactConversations).set({ state: "awaiting_consent", updatedAt: new Date().toISOString() })
        .where(eq(contactConversations.id, input.conversation.id));
      return {
        text: "This is Groundwork, an AI superintendent assistant. This call is transcribed for the project record. I can record field facts but cannot give engineering, safety, or means-and-methods direction. Say I consent to continue, or hang up.",
      };
    }
    await input.db.update(contactConversations).set({
      disclosureAccepted: true,
      state: "collecting",
      updatedAt: new Date().toISOString(),
    }).where(eq(contactConversations.id, input.conversation.id));
    return { text: "Thank you. Report the shaft ID, observed condition, depth if known, whether work stopped, and any cleared alternate shaft." };
  }

  const restricted = classifyRestrictedRequest(text);
  if (restricted) {
    await recordPolicyDecision(input.db, projectId(input.runtime), input.contact.id, "respond_to_restricted_request", {
      decision: "intake_only",
      reasons: [restricted],
      policyVersion: POLICY_VERSION,
    });
  }

  if (isExplicitConfirmation(text) && input.conversation.pendingObservationJson) {
    const observation = JSON.parse(input.conversation.pendingObservationJson) as FieldObservation;
    await commitConfirmedEvent(input, observation, text, "inbound_voice");
    return {
      text: `Confirmed. I recorded ${observation.condition} at ${observation.elementId} and started a schedule candidate for superintendent approval. Send site photos to this same number. I have not issued engineering or safety direction.`,
      send_message: { body: `Groundwork recorded ${observation.condition} at ${observation.elementId}. Reply with site photos and a short caption. Schedule changes still require superintendent approval.` },
    };
  }

  const observation = parseFieldObservation(text);
  if (hasReportableFact(observation)) {
    await input.db.update(contactConversations).set({
      pendingObservationJson: JSON.stringify(observation),
      state: "awaiting_readback",
      updatedAt: new Date().toISOString(),
    }).where(eq(contactConversations.id, input.conversation.id));
    const prefix = restricted ? "I cannot advise on that request, but I can record the observed facts. " : "";
    return { text: `${prefix}${buildReadback(observation)}` };
  }

  return {
    text: restricted
      ? "I cannot provide engineering, safety, commercial, or means-and-methods direction. I can record an observed field condition for superintendent review."
      : "I need an observed condition and shaft ID. For example: DS-02 hit refusal at 34 feet and work stopped.",
  };
}

async function handleMessage(input: HandlerInput) {
  const text = getWebhookText(input.payload);
  const mediaUrl = getMediaUrl(input.payload);
  let mediaStatus: string | null = null;
  if (mediaUrl) mediaStatus = await storePrivateMedia(input, mediaUrl, text);

  if (isExplicitConfirmation(text) && input.conversation.pendingObservationJson) {
    const observation = JSON.parse(input.conversation.pendingObservationJson) as FieldObservation;
    await commitConfirmedEvent(input, observation, text, "inbound_message");
    await sendAgentPhoneReply(input.runtime, input.contact.phone, `Confirmed: ${observation.condition} at ${observation.elementId}. A schedule candidate is awaiting superintendent approval.`);
    return { received: true, confirmed: true, mediaStatus };
  }

  const observation = parseFieldObservation(text);
  if (hasReportableFact(observation)) {
    await input.db.update(contactConversations).set({
      pendingObservationJson: JSON.stringify(observation),
      state: "awaiting_readback",
      updatedAt: new Date().toISOString(),
    }).where(eq(contactConversations.id, input.conversation.id));
    await sendAgentPhoneReply(input.runtime, input.contact.phone, `${buildReadback(observation)} Reply CONFIRM or CORRECT.`);
  } else if (mediaUrl) {
    await sendAgentPhoneReply(input.runtime, input.contact.phone, "Photo received privately. Reply with the shaft ID and a short factual caption so it can be attached to the correct field event.");
  } else {
    await sendAgentPhoneReply(input.runtime, input.contact.phone, "Groundwork received your message. Include a shaft ID and observed condition; schedule changes require a confirmed read-back and superintendent approval.");
  }
  return { received: true, pendingConfirmation: hasReportableFact(observation), mediaStatus };
}

type HandlerInput = {
  db: ReturnType<typeof getDb>;
  runtime: GroundworkRuntimeEnv;
  webhookId: string;
  payload: ReturnType<typeof AgentPhoneWebhookSchema.parse>;
  contact: FieldContact;
  conversation: typeof contactConversations.$inferSelect;
};

async function commitConfirmedEvent(input: HandlerInput, observation: FieldObservation, confirmationText: string, source: "inbound_voice" | "inbound_message") {
  const event = createFieldEvent({
    eventId: `field_${crypto.randomUUID().slice(0, 12)}`,
    projectId: projectId(input.runtime),
    source,
    provider: "agentphone",
    contact: {
      contactId: input.contact.id,
      name: input.contact.name,
      role: input.contact.role,
      verified: true,
    },
    observation,
    disclosureAccepted: source === "inbound_message" || input.conversation.disclosureAccepted,
  });
  const nexlaStatus = await deliverToNexla(input.runtime.NEXLA_FIELD_EVENTS_WEBHOOK_URL, event);
  await input.db.insert(fieldEvents).values({
    id: event.eventId,
    projectId: event.projectId,
    provider: "agentphone",
    providerEventId: input.webhookId,
    conversationId: input.conversation.id,
    caller: input.contact.phone,
    eventType: observation.condition ?? "field_observation",
    elementId: observation.elementId,
    depthFt: observation.depthFt,
    condition: observation.condition,
    alternateElement: observation.alternateElement,
    transcript: `${observation.rawText}\nCONFIRMATION: ${confirmationText}`,
    confidence: 9400,
    confirmed: true,
    nexlaStatus,
  }).onConflictDoNothing();
  await input.db.update(fieldMedia).set({
    fieldEventId: event.eventId,
    elementId: observation.elementId,
  }).where(eq(fieldMedia.conversationId, input.conversation.id));
  await input.db.update(contactConversations).set({
    pendingObservationJson: null,
    state: "confirmed",
    updatedAt: new Date().toISOString(),
  }).where(eq(contactConversations.id, input.conversation.id));

  const replanEvent = observation.condition === "inspection unavailable" ? "inspector_cancelled" : "shaft_obstruction";
  const candidate = await runReplanGraph(replanEvent);
  await input.db.insert(scheduleCandidates).values({
    commitId: candidate.commitId,
    projectId: event.projectId,
    triggerEventId: event.eventId,
    event: replanEvent,
    resultJson: JSON.stringify(candidate),
    status: "proposed",
  }).onConflictDoUpdate({
    target: scheduleCandidates.commitId,
    set: { triggerEventId: event.eventId, resultJson: JSON.stringify(candidate), status: "proposed", createdAt: new Date().toISOString() },
  });
}

async function storePrivateMedia(input: HandlerInput, mediaUrl: string, caption: string) {
  if (!input.runtime.MEDIA) return "storage_unavailable";
  const url = new URL(mediaUrl);
  if (url.protocol !== "https:" || !isAllowedMediaHost(url.hostname, input.runtime.AGENTPHONE_MEDIA_HOSTS)) return "source_rejected";
  const headers: Record<string, string> = {};
  if (url.hostname.endsWith("agentphone.ai") && input.runtime.AGENTPHONE_API_KEY) headers.authorization = `Bearer ${input.runtime.AGENTPHONE_API_KEY}`;
  const response = await fetch(url, { headers, redirect: "error" });
  if (!response.ok) return "download_failed";
  const contentType = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0];
  const declaredBytes = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_MEDIA_BYTES) return "media_rejected";
  const typeDecision = evaluateMedia(contentType, Math.max(1, declaredBytes));
  if (typeDecision.decision !== "allow") return "media_rejected";
  const body = await readLimitedBody(response.body, MAX_MEDIA_BYTES);
  if (!body) return "media_rejected";
  const mediaDecision = evaluateMedia(contentType, body.byteLength);
  await recordPolicyDecision(input.db, projectId(input.runtime), input.contact.id, "store_field_image", mediaDecision);
  if (mediaDecision.decision !== "allow") return "media_rejected";
  const mediaId = `media_${crypto.randomUUID().slice(0, 12)}`;
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const key = `${projectId(input.runtime)}/${new Date().toISOString().slice(0, 10)}/${mediaId}.${extension}`;
  await input.runtime.MEDIA.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: { projectId: projectId(input.runtime), callerId: input.contact.id, visibility: "private" },
  });
  const observation = parseFieldObservation(caption);
  await input.db.insert(fieldMedia).values({
    id: mediaId,
    projectId: projectId(input.runtime),
    conversationId: input.conversation.id,
    caller: input.contact.phone,
    elementId: observation.elementId,
    caption: caption.slice(0, 1000) || null,
    storageKey: key,
    sourceUrlHash: await sha256Hex(mediaUrl),
    contentType,
    bytes: body.byteLength,
    status: "stored_private",
  });
  return "stored_private";
}

async function sendAgentPhoneReply(runtime: GroundworkRuntimeEnv, to: string, body: string) {
  if (!runtime.AGENTPHONE_API_KEY || !runtime.AGENTPHONE_AGENT_ID) return false;
  const response = await fetch("https://api.agentphone.ai/v1/messages", {
    method: "POST",
    headers: { authorization: `Bearer ${runtime.AGENTPHONE_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ to_number: to, body, agent_id: runtime.AGENTPHONE_AGENT_ID }),
  });
  return response.ok;
}

async function getOrCreateConversation(db: ReturnType<typeof getDb>, runtime: GroundworkRuntimeEnv, payload: HandlerInput["payload"], contact: FieldContact) {
  const externalId = getConversationId(payload);
  const [existing] = await db.select().from(contactConversations).where(eq(contactConversations.externalId, externalId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(contactConversations).values({
    id: `conv_${crypto.randomUUID().slice(0, 12)}`,
    projectId: projectId(runtime),
    provider: "agentphone",
    externalId,
    caller: contact.phone,
    state: payload.channel === "voice" ? "awaiting_consent" : "collecting",
    disclosureAccepted: payload.channel !== "voice",
  }).returning();
  return created;
}

async function recordPolicyDecision(db: ReturnType<typeof getDb>, project: string, subject: string, action: string, result: PolicyDecision) {
  await db.insert(policyDecisions).values({
    id: `policy_${crypto.randomUUID().slice(0, 12)}`,
    projectId: project,
    subject,
    action,
    decision: result.decision,
    reasonsJson: JSON.stringify(result.reasons),
    policyVersion: result.policyVersion,
  });
}

async function finishDelivery(db: ReturnType<typeof getDb>, id: string, status: string, response: unknown) {
  await db.update(webhookDeliveries).set({ status, responseJson: JSON.stringify(response) }).where(eq(webhookDeliveries.id, id));
}

function projectId(runtime: GroundworkRuntimeEnv) {
  return runtime.GROUNDWORK_PROJECT_ID ?? DEFAULT_PROJECT_ID;
}

function isAllowedMediaHost(hostname: string, configured?: string) {
  if (hostname === "agentphone.ai" || hostname.endsWith(".agentphone.ai")) return true;
  const allowed = (configured ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(hostname.toLowerCase());
}

function safeJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

async function readLimitedBody(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<ArrayBuffer | null> {
  if (!stream) return null;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel("media_size_out_of_policy");
      return null;
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}
