import { handle, json } from "@/server/http";
import { PaymentError } from "@/server/errors";
import { deleteProject, getBundle, listAuditLog } from "@/server/repo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const bundle = getBundle(id);
    if (!bundle) throw new PaymentError("NOT_FOUND", "Project not found", 404);
    return json({ ...bundle, auditLog: listAuditLog(id) });
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const bundle = getBundle(id);
    if (!bundle) throw new PaymentError("NOT_FOUND", "Project not found", 404);
    if (bundle.items.some((i) => i.isProcessingPayment)) {
      throw new PaymentError("IS_PROCESSING_PAYMENT", "A payment is in progress for this project", 409);
    }
    deleteProject(id);
    return json({ ok: true });
  });
}
