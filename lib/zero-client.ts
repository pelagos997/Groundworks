import type { GroundworkRuntimeEnv } from "./runtime-env";

export function hasZeroCredentials(runtime: GroundworkRuntimeEnv) {
  return Boolean(
    runtime.ZERO_PRIVATE_KEY?.startsWith("0x")
    || (runtime.ZERO_ACCESS_TOKEN && runtime.ZERO_REFRESH_TOKEN),
  );
}

export async function createZeroClient(runtime: GroundworkRuntimeEnv) {
  const { ZeroClient } = await import("@zeroxyz/sdk");
  if (runtime.ZERO_PRIVATE_KEY?.startsWith("0x")) {
    return ZeroClient.fromPrivateKey(runtime.ZERO_PRIVATE_KEY as `0x${string}`);
  }
  if (runtime.ZERO_ACCESS_TOKEN && runtime.ZERO_REFRESH_TOKEN) {
    return new ZeroClient({
      session: {
        accessToken: runtime.ZERO_ACCESS_TOKEN,
        refreshToken: runtime.ZERO_REFRESH_TOKEN,
      },
    });
  }
  throw new Error("Zero credentials are not configured.");
}
