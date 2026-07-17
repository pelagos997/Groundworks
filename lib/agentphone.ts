import { z } from "zod";

const ConversationStateSchema = z.preprocess(
  (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null,
  z.record(z.string(), z.unknown()).nullable(),
);

const RecentHistorySchema = z.preprocess(
  (value) => Array.isArray(value) ? value : [],
  z.array(z.unknown()),
);

export const AgentPhoneWebhookSchema = z.object({
  event: z.enum(["agent.message", "agent.call_ended", "agent.reaction"]),
  channel: z.enum(["voice", "sms", "mms", "imessage"]),
  timestamp: z.string().optional().default(""),
  agentId: z.string(),
  data: z.record(z.string(), z.unknown()),
  conversationState: ConversationStateSchema.optional().default(null),
  recentHistory: RecentHistorySchema.optional().default([]),
});

export type AgentPhoneWebhook = z.infer<typeof AgentPhoneWebhookSchema>;
export type FieldObservation = {
  elementId: string | null;
  depthFt: number | null;
  condition: string | null;
  alternateElement: string | null;
  workStopped: boolean;
  rawText: string;
};

export async function verifyAgentPhoneWebhook(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  nowMs?: number;
}): Promise<boolean> {
  if (!input.signature || !input.timestamp || !/^\d+$/.test(input.timestamp)) return false;
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - Number(input.timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${input.timestamp}.${input.rawBody}`),
  );
  const expected = `sha256=${toHex(new Uint8Array(digest))}`;
  return constantTimeEqual(expected, input.signature);
}

export function parseFieldObservation(text: string): FieldObservation {
  const normalized = text.replace(/\s+/g, " ").trim();
  const shaftMatches = [...normalized.matchAll(/\bDS[-\s]?(\d{1,3})\b/gi)];
  const elementId = shaftMatches[0] ? `DS-${shaftMatches[0][1].padStart(2, "0")}` : null;
  const alternateElement = shaftMatches[1] ? `DS-${shaftMatches[1][1].padStart(2, "0")}` : null;
  const depthMatch = normalized.match(/\b(\d{1,3}(?:\.\d+)?)\s*(?:ft|feet|foot)\b/i);
  const condition = detectCondition(normalized);
  return {
    elementId,
    depthFt: depthMatch ? Math.round(Number(depthMatch[1])) : null,
    condition,
    alternateElement,
    workStopped: /\b(stop|stopped|shut down|stand down|holding)\b/i.test(normalized),
    rawText: normalized.slice(0, 5000),
  };
}

export function isExplicitConfirmation(text: string): boolean {
  return /^(yes[,\s]|yes$|confirm(?:ed)?\b|correct\b|that(?:'s| is) correct\b)/i.test(text.trim());
}

export function hasReportableFact(observation: FieldObservation): boolean {
  return Boolean(observation.elementId && observation.condition);
}

export function buildReadback(observation: FieldObservation): string {
  const depth = observation.depthFt ? ` at ${observation.depthFt} feet` : "";
  const stopped = observation.workStopped ? " Work is stopped." : "";
  const alternate = observation.alternateElement ? ` ${observation.alternateElement} is the reported alternate.` : "";
  return `I heard ${observation.condition} at ${observation.elementId}${depth}.${stopped}${alternate} Say confirm if that is correct.`;
}

export function getWebhookText(payload: AgentPhoneWebhook): string {
  const value = payload.channel === "voice" ? payload.data.transcript : payload.data.message;
  return typeof value === "string" ? value.trim() : "";
}

export function getCaller(payload: AgentPhoneWebhook): string {
  const value = payload.data.from ?? payload.data.fromNumber;
  return typeof value === "string" ? value : "";
}

export function getConversationId(payload: AgentPhoneWebhook): string {
  const value = payload.data.conversationId ?? payload.data.callId;
  return typeof value === "string" ? value : `${payload.agentId}:${getCaller(payload)}`;
}

export function getMediaUrl(payload: AgentPhoneWebhook): string | null {
  const value = payload.data.mediaUrl;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const body = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", body);
  return toHex(new Uint8Array(digest));
}

function detectCondition(text: string): string | null {
  const tests: Array<[RegExp, string]> = [
    [/\b(refusal|hard layer|hard rock)\b/i, "refusal"],
    [/\b(obstruction|boulder|debris)\b/i, "obstruction"],
    [/\b(caving|collapse|sloughing)\b/i, "sidewall instability"],
    [/\b(slurry loss|lost slurry|fluid loss)\b/i, "slurry loss"],
    [/\b(cage stuck|cage hang|reinforcing cage)\b/i, "cage placement issue"],
    [/\b(concrete delay|batch delay|truck delay)\b/i, "concrete delivery delay"],
    [/\b(inspector.*cancel|inspection.*cancel|no inspector)\b/i, "inspection unavailable"],
    [/\b(complete|completed|finished)\b/i, "production complete"],
  ];
  return tests.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
