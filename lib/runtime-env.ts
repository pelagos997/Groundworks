import { env } from "cloudflare:workers";

export type GroundworkRuntimeEnv = {
  DB?: D1Database;
  MEDIA?: R2Bucket;
  AGENTPHONE_API_KEY?: string;
  AGENTPHONE_AGENT_ID?: string;
  AGENTPHONE_NUMBER?: string;
  AGENTPHONE_WEBHOOK_SECRET?: string;
  AGENTPHONE_MEDIA_HOSTS?: string;
  GROUNDWORK_ALLOWED_CALLERS?: string;
  GROUNDWORK_CONTACTS_JSON?: string;
  GROUNDWORK_PROJECT_ID?: string;
  NEXLA_FIELD_EVENTS_WEBHOOK_URL?: string;
  ZERO_PRIVATE_KEY?: string;
  ZERO_LIVE_ACTIONS?: string;
};

export function getRuntimeEnv(): GroundworkRuntimeEnv {
  return env as unknown as GroundworkRuntimeEnv;
}

export const DEFAULT_PROJECT_ID = "soma_drilled_shafts_001";
