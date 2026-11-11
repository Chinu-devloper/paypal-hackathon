import { getEnvStatus } from "@/server/env";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const env = getEnvStatus();
    return json({ env, paypalClientId: env.paypalLive ? process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID?.trim() ?? null : null });
  });
}
