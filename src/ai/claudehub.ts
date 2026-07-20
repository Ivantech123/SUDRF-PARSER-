/** A2chatski (Anthropic-compatible) client */

const DEFAULT_BASE = "https://api.claudehub.fun";
/** Haiku 4.5 currently returns invalid_request on this gateway; Sonnet is stable. */
const DEFAULT_MODEL = "claude-sonnet-4.6";

export function claudeHubConfigured(): boolean {
  return Boolean(process.env.CLAUDEHUB_API_KEY?.trim() || process.env.CLAUDEHUB_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.CLAUDEHUB_API_KEY?.trim() || process.env.CLAUDEHUB_KEY?.trim();
  if (!key) throw new Error("CLAUDEHUB_API_KEY не задан в .env");
  return key;
}

function baseUrl(): string {
  return (process.env.CLAUDEHUB_BASE_URL || DEFAULT_BASE).replace(/\/$/, "").replace(/\/v1$/, "");
}

export function claudeHubModel(): string {
  return process.env.CLAUDEHUB_MODEL?.trim() || DEFAULT_MODEL;
}

export async function chatCompletion(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const res = await fetch(`${baseUrl()}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: claudeHubModel(),
      max_tokens: opts.maxTokens ?? 1800,
      temperature: opts.temperature ?? 0.4,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`A2chatski ${res.status}: ${text.slice(0, 400)}`);
  }

  let data: {
    content?: Array<{ type?: string; text?: string }>;
  };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error("A2chatski: невалидный JSON в ответе");
  }

  const joined = (data.content ?? [])
    .filter((b) => b?.type === "text" && b.text)
    .map((b) => b.text!)
    .join("");
  if (joined.trim()) return joined.trim();
  throw new Error("A2chatski: пустой ответ модели");
}
