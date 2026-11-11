import type { EnvStatus } from "../shared/types";

function clean(v: string | undefined): string {
  return (v ?? "").trim();
}

export function demoToolsEnabled(): boolean {
  return clean(process.env.ENABLE_DEMO_TOOLS).toLowerCase() !== "false";
}

export function getEnvStatus(): EnvStatus {
  const paypalLive = Boolean(clean(process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID) && clean(process.env.PAYPAL_CLIENT_SECRET));
  const openai = Boolean(clean(process.env.OPENAI_API_KEY));
  const channel3 = Boolean(clean(process.env.CHANNEL3_API_KEY));
  const missing: string[] = [];
  if (!paypalLive) missing.push("PayPal Sandbox credentials");
  if (!openai) missing.push("OPENAI_API_KEY");
  if (!channel3) missing.push("CHANNEL3_API_KEY");
  return {
    paypalLive,
    openai,
    channel3,
    paypalEnv: clean(process.env.PAYPAL_ENV).toLowerCase() === "live" ? "live" : "sandbox",
    simulationMode: missing.length > 0,
    demoTools: demoToolsEnabled(),
    missing,
  };
}

export function paypalBaseUrl(): string {
  return getEnvStatus().paypalEnv === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

export function paypalCredentials(): { clientId: string; secret: string } | null {
  const clientId = clean(process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID);
  const secret = clean(process.env.PAYPAL_CLIENT_SECRET);
  return clientId && secret ? { clientId, secret } : null;
}
