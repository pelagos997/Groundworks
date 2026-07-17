import { env } from "cloudflare:workers";

export type GroundworkRuntimeEnv = {
  DB?: D1Database;
  MEDIA?: R2Bucket;
  AGENTPHONE_API_KEY?: string;
  AGENTPHONE_AGENT_ID?: string;
  AGENTPHONE_NUMBER?: string;
  AGENTPHONE_NUMBER_ID?: string;
  AGENTPHONE_WEBHOOK_SECRET?: string;
  AGENTPHONE_MEDIA_HOSTS?: string;
  GROUNDWORK_ALLOWED_CALLERS?: string;
  GROUNDWORK_CONTACTS_JSON?: string;
  GROUNDWORK_PROJECT_ID?: string;
  GROUNDWORK_BUYER_COMPANY?: string;
  GROUNDWORK_BUYER_NAME?: string;
  GROUNDWORK_BUYER_CALLBACK?: string;
  GROUNDWORK_RFQ_EMAIL?: string;
  GROUNDWORK_DELIVERY_ADDRESS?: string;
  GROUNDWORK_HPILE_GRADE?: string;
  GROUNDWORK_ALLOW_AFTER_HOURS_RFQ?: string;
  GROUNDWORK_PROCUREMENT_WEBHOOK_TOKEN?: string;
  GROUNDWORK_INTERNAL_API_TOKEN?: string;
  GROUNDWORK_PO_RELEASES_ENABLED?: string;
  NEXLA_FIELD_EVENTS_WEBHOOK_URL?: string;
  ZERO_PRIVATE_KEY?: string;
  ZERO_ACCESS_TOKEN?: string;
  ZERO_REFRESH_TOKEN?: string;
  ZERO_LIVE_ACTIONS?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export function getRuntimeEnv(): GroundworkRuntimeEnv {
  return env as unknown as GroundworkRuntimeEnv;
}

export const DEFAULT_PROJECT_ID = "soma_drilled_shafts_001";
