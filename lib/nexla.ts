export async function deliverToNexla(webhookUrl: string | undefined, payload: unknown) {
  if (!webhookUrl) return "demo_replay" as const;
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.ok ? "delivered" as const : "delivery_failed" as const;
  } catch {
    return "delivery_failed" as const;
  }
}
