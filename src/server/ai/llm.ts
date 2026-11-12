import OpenAI from "openai";

/** Works with OpenAI or any OpenAI-compatible provider (Gemini, Groq, OpenRouter) via OPENAI_BASE_URL. */
export function llmClient(opts: { timeoutMs?: number; retries?: number } = {}): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY?.trim(),
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
    timeout: opts.timeoutMs ?? 30_000,
    maxRetries: opts.retries ?? 1,
  });
}

export function llmModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/** One JSON-mode completion. Providers shed load with 429/503 for a few seconds, so those get a single patient retry. */
export async function chatJson(messages: ChatMessage[], opts: { temperature?: number; timeoutMs?: number } = {}): Promise<unknown> {
  const call = () =>
    llmClient({ timeoutMs: opts.timeoutMs ?? 40_000, retries: 0 }).chat.completions.create({
      model: llmModel(),
      temperature: opts.temperature ?? 0.2,
      response_format: { type: "json_object" },
      messages,
    });
  let res;
  try {
    res = await call();
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 429 && status !== 503) throw err;
    await new Promise((r) => setTimeout(r, 3000));
    res = await call();
  }
  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty response from model");
  return JSON.parse(raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
}
