import { z } from "zod";

export const POLICY_VERSION = "groundwork-field-contact-v1.0";
export const ZERO_MAX_PAY_USDC = 0.6;
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const ContactSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  phone: z.string().regex(/^\+\d{10,15}$/),
  inboundConsent: z.boolean().default(true),
  outboundVoiceConsent: z.boolean().default(false),
  outboundSmsConsent: z.boolean().default(false),
});

export type FieldContact = z.infer<typeof ContactSchema>;
export type PolicyDecision = {
  decision: "allow" | "deny" | "intake_only" | "approval_required";
  reasons: string[];
  policyVersion: typeof POLICY_VERSION;
};

export const AGENT_POLICY_MANIFEST = {
  version: POLICY_VERSION,
  defaults: "deny",
  automatic: [
    "Verify signed inbound webhook deliveries",
    "Accept reports and private images from allowlisted, consented field contacts",
    "Read back extracted facts and request explicit confirmation",
    "Normalize confirmed observations into versioned field events",
    "Search and inspect Zero capabilities without spending",
  ],
  approvalRequired: [
    "Commit any schedule candidate",
    "Place an outbound Zero voice call",
    "Send outbound SMS or email beyond the active inbound conversation",
    "Spend up to the per-action Zero ceiling",
  ],
  prohibited: [
    "Engineering design or interpretation",
    "Safety direction or stop-work clearance",
    "Means-and-methods direction",
    "Cost, contract, or change-order authorization",
    "Contacting a number absent from the consented allowlist",
    "Publishing field images or using face recognition",
  ],
  controls: {
    callerAllowlist: true,
    explicitReadback: true,
    webhookHmac: "HMAC-SHA256 with five-minute replay window",
    idempotency: "X-Webhook-ID",
    mediaVisibility: "private",
    allowedMediaTypes: ALLOWED_MEDIA_TYPES,
    maxMediaBytes: MAX_MEDIA_BYTES,
    zeroMaxPayUsdc: ZERO_MAX_PAY_USDC,
  },
} as const;

export function parseContacts(raw?: string): FieldContact[] {
  if (!raw) return [];
  try {
    return z.array(ContactSchema).parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function findContact(phone: string, contactsRaw?: string, callersRaw?: string): FieldContact | null {
  const fromDirectory = parseContacts(contactsRaw).find((contact) => contact.phone === phone);
  if (fromDirectory) return fromDirectory;
  const allowed = (callersRaw ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!allowed.includes(phone)) return null;
  return {
    id: `caller_${phone.slice(-4)}`,
    name: `Field contact ${phone.slice(-4)}`,
    role: "field crew",
    phone,
    inboundConsent: true,
    outboundVoiceConsent: false,
    outboundSmsConsent: false,
  };
}

export function evaluateInboundContact(contact: FieldContact | null): PolicyDecision {
  if (!contact) return decision("deny", ["caller_not_allowlisted"]);
  if (!contact.inboundConsent) return decision("deny", ["inbound_consent_missing"]);
  return decision("allow", ["caller_allowlisted", "inbound_consent_recorded"]);
}

export function classifyRestrictedRequest(text: string): string | null {
  const value = text.toLowerCase();
  if (/\b(is it safe|safe to|stop work|resume work|clearance|hazard)\b/.test(value)) return "safety_direction";
  if (/\b(design|capacity|reinforcement|engineer|bearing|structural)\b/.test(value)) return "engineering_direction";
  if (/\b(change order|authorize cost|approve cost|contract|price)\b/.test(value)) return "commercial_authority";
  if (/\b(how should we drill|means and methods|means-and-methods|what tool should)\b/.test(value)) return "means_and_methods";
  return null;
}

export function evaluateMedia(contentType: string, bytes: number): PolicyDecision {
  const reasons: string[] = [];
  if (!ALLOWED_MEDIA_TYPES.includes(contentType as (typeof ALLOWED_MEDIA_TYPES)[number])) reasons.push("media_type_not_allowed");
  if (bytes <= 0 || bytes > MAX_MEDIA_BYTES) reasons.push("media_size_out_of_policy");
  return reasons.length ? decision("deny", reasons) : decision("allow", ["private_image_within_limits"]);
}

export function evaluateZeroVoiceAction(input: {
  contact: FieldContact | null;
  approvedPlan: boolean;
  liveActionsEnabled: boolean;
  maxPay: number;
}): PolicyDecision {
  const reasons: string[] = [];
  if (!input.contact) reasons.push("recipient_not_allowlisted");
  if (input.contact && !input.contact.outboundVoiceConsent) reasons.push("voice_consent_missing");
  if (!input.approvedPlan) reasons.push("schedule_commit_not_approved");
  if (!input.liveActionsEnabled) reasons.push("live_actions_disabled");
  if (input.maxPay > ZERO_MAX_PAY_USDC) reasons.push("max_pay_exceeds_policy");
  return reasons.length ? decision("deny", reasons) : decision("allow", ["approved_commit", "consented_recipient", "spend_within_limit"]);
}

function decision(value: PolicyDecision["decision"], reasons: string[]): PolicyDecision {
  return { decision: value, reasons, policyVersion: POLICY_VERSION };
}
