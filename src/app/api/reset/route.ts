import { handle, json, requireDemoTools } from "@/server/http";
import { resetAll } from "@/server/repo";
import { seedDemoData } from "@/server/seed";

export const dynamic = "force-dynamic";

export async function POST() {
  return handle(async () => {
    requireDemoTools();
    resetAll();
    seedDemoData();
    return json({ ok: true });
  });
}
