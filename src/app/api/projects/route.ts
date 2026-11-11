import { z } from "zod";
import { handle, json, readBody } from "@/server/http";
import { generateScope, MAX_BUDGET, MAX_PROMPT_CHARS, MIN_BUDGET } from "@/server/ai/scope";
import { searchProducts } from "@/server/channel3";
import { itemsFromPlan } from "@/server/items";
import { addAuditLog, insertProject, listProjects } from "@/server/repo";
import type { Project } from "@/shared/types";
import { EMAIL_RE, newId } from "@/server/utils";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  prompt: z.string().trim().min(15, "Describe the project in at least a sentence").max(MAX_PROMPT_CHARS),
  totalBudget: z.number().min(MIN_BUDGET).max(MAX_BUDGET).nullable().optional(),
  clientEmail: z.string().trim().regex(EMAIL_RE, "Invalid client email").default("sb-client@business.example.com"),
  freelancerEmail: z.string().trim().regex(EMAIL_RE, "Invalid freelancer email").default("sb-freelancer@personal.example.com"),
});

export async function GET() {
  return handle(async () => json({ projects: listProjects() }));
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readBody(req, createSchema);
    const { plan, engine, note } = await generateScope({ prompt: body.prompt, totalBudget: body.totalBudget ?? null });

    const project: Project = {
      id: newId("prj"),
      scenarioKey: null,
      title: plan.projectTitle,
      prompt: body.prompt,
      totalBudget: plan.totalBudget,
      clientEmail: body.clientEmail,
      freelancerEmail: body.freelancerEmail,
      createdAt: new Date().toISOString(),
    };
    const items = itemsFromPlan(project.id, plan, body.freelancerEmail);
    for (const item of items) {
      if (item.kind === "PROCUREMENT" && item.searchQuery) {
        const found = await searchProducts(item.searchQuery, item.maxBudget, 3);
        item.candidates = found.products;
      }
    }
    insertProject(project, items);
    addAuditLog(project.id, null, "INFO", "PROJECT_CREATED", `AI Scope Architect (${engine}) generated ${plan.milestones.length} milestone(s) and ${plan.procurementItems.length} procurement item(s).`);
    return json({ project, items, engine, note: note ?? null }, 201);
  });
}
