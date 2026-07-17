import { z } from "zod";

export const POLICY_VERSION = "groundwork-phone-procurement-v2.0";
export const ZERO_MAX_PAY_USDC = 0.6;
export const ZERO_RFQ_BATCH_MAX_USDC = 1.8;
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
  canRequestQuotes: z.boolean().default(false),
  canApprovePurchase: z.boolean().default(false),
  purchaseLimitCents: z.number().int().nonnegative().default(0),
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
    "Capture a complete material request and calculate quantity extensions",
    "Solicit nonbinding quotes from the verified vendor directory after an authorized caller confirms the RFQ",
  ],
  approvalRequired: [
    "Commit any schedule candidate",
    "Place an outbound Zero voice call",
    "Send outbound SMS or email beyond the active inbound conversation",
    "Spend up to the per-action Zero ceiling",
    "Select a written vendor quote and release a purchase order",
  ],
  prohibited: [
    "Engineering design or interpretation",
    "Safety direction or stop-work clearance",
    "Means-and-methods direction",
    "Inventing cost, contract, change-order, material-grade, or delivery authority",
    "Treating a verbal quote or phone transcript as a binding order",
    "Accepting a substitute section, grade, length, or domestic-compliance basis without human approval",
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
    postIntakeReasoningMaxPayUsdc: 0.1,
    zeroRfqBatchMaxUsdc: ZERO_RFQ_BATCH_MAX_USDC,
    rfqCallsAreNonbinding: true,
    demoVendorOverrideRequiresExplicitMode: true,
    writtenQuoteRequiredForPurchase: true,
    explicitPoApprovalRequired: true,
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
    canRequestQuotes: false,
    canApprovePurchase: false,
    purchaseLimitCents: 0,
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

export function evaluateRfqSourcing(input: {
  contact: FieldContact | null;
  requestComplete: boolean;
  explicitConfirmation: boolean;
  liveActionsEnabled: boolean;
  vendorCount: number;
  demoMode?: boolean;
  maxPayPerVendor: number;
  buyerIdentityConfigured: boolean;
  withinCallingHours: boolean;
}): PolicyDecision {
  const reasons: string[] = [];
  if (!input.contact) reasons.push("requester_not_allowlisted");
  if (input.contact && !input.contact.canRequestQuotes) reasons.push("rfq_authority_missing");
  if (!input.requestComplete) reasons.push("material_request_incomplete");
  if (!input.explicitConfirmation) reasons.push("rfq_confirmation_missing");
  if (!input.liveActionsEnabled) reasons.push("live_actions_disabled");
  if (!input.buyerIdentityConfigured) reasons.push("buyer_identity_incomplete");
  if (!input.withinCallingHours) reasons.push("outside_vendor_calling_hours");
  if (input.demoMode ? input.vendorCount !== 1 : input.vendorCount < 2 || input.vendorCount > 3) {
    reasons.push("vendor_batch_out_of_policy");
  }
  if (input.maxPayPerVendor > ZERO_MAX_PAY_USDC) reasons.push("max_pay_exceeds_policy");
  if (input.vendorCount * input.maxPayPerVendor > ZERO_RFQ_BATCH_MAX_USDC) reasons.push("batch_spend_exceeds_policy");
  return reasons.length
    ? decision("deny", reasons)
    : decision("allow", ["authorized_requester", "complete_confirmed_rfq", "verified_vendor_batch", "nonbinding_only", "spend_within_limit"]);
}

export function evaluatePurchaseApproval(input: {
  contact: FieldContact | null;
  writtenQuoteReceived: boolean;
  quoteMatchesRequest: boolean;
  quoteExpired: boolean;
  deliveredTotalCents: number;
  poNumber: string;
  explicitConfirmation: boolean;
}): PolicyDecision {
  const reasons: string[] = [];
  if (!input.contact) reasons.push("approver_not_allowlisted");
  if (input.contact && !input.contact.canApprovePurchase) reasons.push("purchase_authority_missing");
  if (!input.writtenQuoteReceived) reasons.push("written_quote_required");
  if (!input.quoteMatchesRequest) reasons.push("quote_does_not_match_request");
  if (input.quoteExpired) reasons.push("quote_expired");
  if (!input.explicitConfirmation) reasons.push("purchase_confirmation_missing");
  if (!/^PO[-A-Z0-9]{3,32}$/i.test(input.poNumber)) reasons.push("valid_po_number_required");
  if (input.deliveredTotalCents <= 0) reasons.push("delivered_total_required");
  if (input.contact && input.deliveredTotalCents > input.contact.purchaseLimitCents) reasons.push("purchase_limit_exceeded");
  return reasons.length
    ? decision("deny", reasons)
    : decision("allow", ["authorized_buyer", "written_matching_quote", "delivered_total_within_limit", "explicit_po_confirmation"]);
}

function decision(value: PolicyDecision["decision"], reasons: string[]): PolicyDecision {
  return { decision: value, reasons, policyVersion: POLICY_VERSION };
}
