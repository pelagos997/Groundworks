import { NextResponse } from "next/server";
import { AGENT_POLICY_MANIFEST } from "../../../lib/agent-policy";

export async function GET() {
  return NextResponse.json(AGENT_POLICY_MANIFEST);
}
