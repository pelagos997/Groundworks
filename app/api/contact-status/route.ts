import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { AGENT_POLICY_MANIFEST, parseContacts } from "../../../lib/agent-policy";
import { getRuntimeEnv } from "../../../lib/runtime-env";

export async function GET() {
  if (!(await getChatGPTUser())) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const runtime = getRuntimeEnv();
  const contacts = parseContacts(runtime.GROUNDWORK_CONTACTS_JSON);
  const configured = Boolean(
    runtime.AGENTPHONE_API_KEY &&
    runtime.AGENTPHONE_AGENT_ID &&
    runtime.AGENTPHONE_NUMBER &&
    runtime.AGENTPHONE_WEBHOOK_SECRET &&
    runtime.DB &&
    runtime.MEDIA,
  );
  return NextResponse.json({
    provider: "AgentPhone",
    number: runtime.AGENTPHONE_NUMBER ?? null,
    configured,
    capabilities: { voice: configured, sms: configured, mms: configured, privateMedia: Boolean(runtime.MEDIA) },
    allowlistedContacts: contacts.length,
    zeroLiveActions: runtime.ZERO_LIVE_ACTIONS === "true" && Boolean(runtime.ZERO_PRIVATE_KEY),
    policy: AGENT_POLICY_MANIFEST,
  });
}
