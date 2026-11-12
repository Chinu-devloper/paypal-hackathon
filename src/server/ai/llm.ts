import OpenAI from "openai";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const GEMINI_MODEL = "gemini-flash-lite-latest";

/** Defaults to Google Gemini; OPENAI_BASE_URL / OPENAI_MODEL override it. */
export function llmClient(opts: { timeoutMs?: number; retries?: number } = {}): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY?.trim(),
    baseURL: process.env.OPENAI_BASE_URL?.trim() || GEMINI_BASE_URL,
    timeout: opts.timeoutMs ?? 30_000,
    maxRetries: opts.retries ?? 1,
  });
}

export function llmModel(): string {
  return process.env.OPENAI_MODEL?.trim() || GEMINI_MODEL;
}

/** Plain-language reason for a failed model call. Provider messages can echo parts of the API key, so they are never shown. */
export function describeLlmError(err: unknown): string {
  const e = err as { status?: number; name?: string; message?: string };
  if (e.status === 401 || e.status === 403) return "the AI provider rejected the credentials; check OPENAI_API_KEY (a Google Gemini key)";
  if (e.status === 404) return "the AI provider does not know the configured model; check OPENAI_MODEL";
  if (e.status === 429 || e.status === 503) return "the AI provider is busy right now";
  if (e.name === "APIConnectionTimeoutError" || /timed? ?out/i.test(e.message ?? "")) return "the AI provider took too long to answer";
  if (e.name === "ZodError" || e.name === "SyntaxError") return "the AI provider returned an answer the platform could not use";
  return "the AI provider returned an error";
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
