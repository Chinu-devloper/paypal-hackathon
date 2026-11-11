import { z } from "zod";
import { handle, json, readBody } from "@/server/http";
import { approveProduct } from "@/server/procurement";

export const dynamic = "force-dynamic";

const schema = z.object({ productId: z.string().min(1).max(200) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const { productId } = await readBody(req, schema);
    return json({ item: approveProduct(id, productId) });
  });
}
