import OpenAI from "openai";

/** Works with OpenAI or any OpenAI-compatible provider (Gemini, Groq, OpenRouter) via OPENAI_BASE_URL. */
export function llmClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY?.trim(),
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
    timeout: 30_000,
    maxRetries: 1,
  });
}

export function llmModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}
