import { handle, json } from "@/server/http";
import { listApiCalls } from "@/server/repo";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const projectId = new URL(req.url).searchParams.get("projectId");
    return json({ calls: listApiCalls(projectId, 100) });
  });
}
