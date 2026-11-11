import { llmClient, llmModel } from "./llm";

/** Writes a realistic demo deliverable for custom projects where no built-in sample exists. */
export async function generateSampleDeliverable(title: string, criteria: string[], kind: "passing" | "partial"): Promise<string | null> {
  const list = criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const instruction =
    kind === "passing"
      ? "Fully and concretely satisfy EVERY criterion with real content (code, document text, data), not statements about the work."
      : "Fully satisfy every criterion EXCEPT the last one, which must be missing or only briefly mentioned without substance.";
  try {
    const completion = await llmClient().chat.completions.create({
      model: llmModel(),
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: `You are a freelancer submitting milestone work for "${title}". Write the actual deliverable in under 450 words. ${instruction} Output only the deliverable.`,
        },
        { role: "user", content: `Acceptance criteria:\n${list}` },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    return text && text.length > 40 ? text : null;
  } catch {
    return null;
  }
}
