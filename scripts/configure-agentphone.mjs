import { chmod, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const apiKey = process.env.AGENTPHONE_API_KEY;
const publicUrl = process.env.GROUNDWORK_PUBLIC_URL;
const secretFile = resolve(process.env.AGENTPHONE_WEBHOOK_SECRET_FILE ?? ".agentphone-webhook-secret");

if (!apiKey || !publicUrl) {
  throw new Error("AGENTPHONE_API_KEY and GROUNDWORK_PUBLIC_URL are required.");
}

const webhookUrl = new URL("/api/webhooks/agentphone", publicUrl).toString();
const response = await fetch("https://api.agentphone.ai/v1/webhooks", {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ url: webhookUrl, contextLimit: 12, timeout: 30 }),
});

if (!response.ok) {
  throw new Error(`AgentPhone webhook configuration failed (${response.status}).`);
}

const result = await response.json();
if (!result.secret || typeof result.secret !== "string") {
  throw new Error("AgentPhone did not return a webhook signing secret.");
}

await writeFile(secretFile, `${result.secret}\n`, { mode: 0o600 });
await chmod(secretFile, 0o600);

const testResponse = await fetch("https://api.agentphone.ai/v1/webhooks/test", {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}` },
});

console.log(JSON.stringify({
  webhookId: result.id,
  webhookUrl,
  status: result.status,
  secretFile,
  testAccepted: testResponse.ok,
}, null, 2));
