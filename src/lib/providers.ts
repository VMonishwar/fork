export type ProviderId = "free" | "groq" | "gemini" | "webllm";

export interface Settings {
  provider: ProviderId;
  groqKey: string;
  geminiKey: string;
}

export const defaultSettings: Settings = { provider: "free", groqKey: "", geminiKey: "" };

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export class ProviderError extends Error {
  rateLimited: boolean;
  constructor(msg: string, rateLimited = false) {
    super(msg);
    this.rateLimited = rateLimited;
  }
}

/** Options for one AI call. */
export interface CallOpts {
  /** Called with the reply-so-far as words arrive (streaming). */
  onToken?: (full: string) => void;
  /** Connection test: short time limit, no slow retries. */
  quick?: boolean;
}

/** Seconds to wait for a provider to start answering before giving up. */
export const TIMEOUT_MS = 30_000;
export const QUICK_TIMEOUT_MS = 12_000;

/** fetch that gives up when the provider hasn't started answering within `ms`. */
async function timedFetch(name: string, url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted)
      throw new ProviderError(`${name} didn't answer within ${Math.round(ms / 1000)} seconds. It may be busy — try again or switch provider.`, true);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pick = (j: any) => string;

/** Read a reply body: server-sent events when streaming, plain JSON otherwise. */
export async function readReply(res: Response, pick: Pick, pickChunk: Pick, onToken?: (full: string) => void): Promise<string> {
  const ct = res.headers?.get?.("content-type") ?? "";
  if (!ct.includes("event-stream") || !res.body) {
    try { return pick(await res.json()); } catch { return ""; }
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  const line = (l: string) => {
    const t = l.trim();
    if (!t.startsWith("data:")) return;
    const data = t.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const piece = pickChunk(JSON.parse(data));
      if (piece) { full += piece; onToken?.(full); }
    } catch { /* partial or non-JSON line */ }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    lines.forEach(line);
  }
  if (buf) line(buf);
  return full;
}

const openaiFull: Pick = (j) => String(j.choices?.[0]?.message?.content ?? "");
const openaiChunk: Pick = (j) => String(j.choices?.[0]?.delta?.content ?? "");
const geminiText: Pick = (j) =>
  String(j.candidates?.[0]?.content?.parts?.map((p: { text?: string; thought?: boolean }) => (p.thought ? "" : p.text ?? "")).join("") ?? "");

export const WEBLLM_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

export function hasWebGPU() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export function cleanKey(k: string) {
  return k.trim().replace(/^[-–—\s"'`]+|["'`\s]+$/g, "").replace(/^Bearer\s+/i, "").trim();
}

async function failure(name: string, status: number, body: string): Promise<never> {
  const snippet = body.slice(0, 300);
  if (status === 429)
    throw new ProviderError(`${name}'s free tier rate limit was reached. Wait a minute or switch provider.`, true);
  if (status >= 500)
    throw new ProviderError(`${name} is overloaded right now (error ${status}). Wait a moment and try again, or switch provider.`, true);
  if (status === 401 || /API_KEY_INVALID|API key not valid|invalid api key/i.test(body))
    throw new ProviderError(
      `${name} rejected your API key. Check it in Settings — make sure you copied the whole key.`,
    );
  throw new ProviderError(`${name} error ${status}: ${snippet}`);
}

async function groq(key: string, messages: ChatMsg[], o: CallOpts) {
  if (!key) throw new ProviderError("Add your Groq API key in Settings.");
  const res = await timedFetch("Groq", "https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, stream: !!o.onToken, ...(o.quick ? { max_tokens: 5 } : {}) }),
  }, o.quick ? QUICK_TIMEOUT_MS : TIMEOUT_MS);
  if (!res.ok) await failure("Groq", res.status, await res.text());
  return readReply(res, openaiFull, openaiChunk, o.onToken);
}

/**
 * Gemini retires models for new accounts (a 404 tells us to use a newer id), so try
 * newest-first and remember whichever one the key actually has access to.
 */
export const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
];

const GEMINI_MODEL_KEY = "fork:gemini-model";

export function parseModelSuggestion(body: string): string | null {
  // The message names the retired model first and the replacement after "use models/…".
  const use = /\buse\s+models?\/([A-Za-z0-9._-]+)/i.exec(body)?.[1];
  if (use) return use;
  const all = [...body.matchAll(/models\/([A-Za-z0-9._-]+)/g)];
  const last = all[all.length - 1]?.[1];
  if (last) return last;
  return /\b(gemini-[A-Za-z0-9._-]+)\b/.exec(body)?.[1] ?? null;
}

function readGeminiModel(): string | null {
  try {
    return localStorage.getItem(GEMINI_MODEL_KEY);
  } catch {
    return null;
  }
}

function writeGeminiModel(model: string) {
  try {
    localStorage.setItem(GEMINI_MODEL_KEY, model);
  } catch {
    /* private mode etc. — just don't remember it */
  }
}

type GeminiAttempt =
  | { ok: true; text: string }
  | { ok: false; status: number; body: string };

/** Ways to send a key. New "AQ." auth keys are sometimes only accepted one way, so we try each. */
export const GEMINI_AUTH_MODES = ["header", "bearer", "query"] as const;
type AuthMode = (typeof GEMINI_AUTH_MODES)[number];
const GEMINI_AUTH_KEY = "fork:gemini-auth";

async function geminiOnce(key: string, messages: ChatMsg[], model: string, o: CallOpts = {}): Promise<GeminiAttempt> {
  let stored: string | null = null;
  try { stored = localStorage.getItem(GEMINI_AUTH_KEY); } catch { /* ignore */ }
  const modes = [stored as AuthMode | null, ...GEMINI_AUTH_MODES].filter(
    (m, i, a): m is AuthMode => !!m && (GEMINI_AUTH_MODES as readonly string[]).includes(m) && a.indexOf(m) === i,
  );
  let r: GeminiAttempt = { ok: false, status: 0, body: "" };
  for (const mode of modes) {
    r = await geminiCall(key, messages, model, mode, o);
    if (r.ok || r.status !== 401) {
      if (r.ok || r.status !== 400) try { localStorage.setItem(GEMINI_AUTH_KEY, mode); } catch { /* ignore */ }
      return r;
    }
  }
  return r;
}

async function geminiCall(key: string, messages: ChatMsg[], model: string, mode: AuthMode, o: CallOpts = {}): Promise<GeminiAttempt> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (mode === "header") headers["x-goog-api-key"] = key;
  if (mode === "bearer") headers["Authorization"] = `Bearer ${key}`;
  const params = [o.onToken ? "alt=sse" : "", mode === "query" ? `key=${encodeURIComponent(key)}` : ""].filter(Boolean).join("&");
  const q = params ? `?${params}` : "";
  const method = o.onToken ? "streamGenerateContent" : "generateContent";
  const res = await timedFetch("Gemini", `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}${q}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...(messages.some((m) => m.role === "system")
        ? { systemInstruction: { parts: [{ text: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n") }] } }
        : {}),
      contents: messages.filter((m) => m.role !== "system").map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      ...(o.quick ? { generationConfig: { maxOutputTokens: 16 } } : {}),
    }),
  }, o.quick ? QUICK_TIMEOUT_MS : TIMEOUT_MS);
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  return { ok: true, text: await readReply(res, geminiText, geminiText, o.onToken) };
}

/** A retired or unavailable model is a model problem, not a key problem — keep looking. */
function isModelProblem(status: number, body: string) {
  return (
    status === 404 ||
    status >= 500 ||
    (status === 403 && !/API_KEY_INVALID|API key not valid/i.test(body)) ||
    (status === 400 && /not found|not supported|no longer available/i.test(body))
  );
}

export let geminiBackoffMs = 600;
export function setGeminiBackoff(ms: number) { geminiBackoffMs = ms; }

async function gemini(key: string, messages: ChatMsg[], o: CallOpts = {}) {
  if (!key) throw new ProviderError("Add your Gemini API key in Settings.");

  const stored = readGeminiModel();
  const queue = [stored, ...GEMINI_MODELS].filter(
    (m, i, all): m is string => !!m && all.indexOf(m) === i,
  );
  const tried: string[] = [];
  let lastBody = "";

  while (queue.length) {
    const model = queue.shift()!;
    if (tried.includes(model)) continue;
    tried.push(model);

    let r = await geminiOnce(key, messages, model, o);
    if (!r.ok && !o.quick && (r.status === 429 || r.status >= 500)) {
      await new Promise((res) => setTimeout(res, geminiBackoffMs));
      r = await geminiOnce(key, messages, model, o);
    }
    // A connection test only needs to know the key is accepted; overloaded still means a valid key.
    if (o.quick && !r.ok && (r.status === 429 || r.status >= 500)) return "ok (Gemini is busy right now, but your key was accepted)";
    if (r.ok) {
      writeGeminiModel(model);
      return r.text;
    }
    if (isModelProblem(r.status, r.body)) {
      lastBody = r.body;
      // Google names the model it wants us to use — switch to it and retry.
      const suggested = parseModelSuggestion(r.body);
      if (suggested && !tried.includes(suggested) && !queue.includes(suggested)) queue.unshift(suggested);
      continue;
    }
    await failure("Gemini", r.status, r.body);
  }


  throw new ProviderError(
    `Gemini has no model available to your key yet (tried ${tried.join(", ")}). ` +
      `Your key may be brand new or for a different account — try Groq in Settings, ` +
      `or check the key at aistudio.google.com/apikey. ${lastBody.slice(0, 120)}`.trim(),
  );
}

/** Keyless free endpoint (Pollinations). Try models in order, retry busy responses with backoff. */
export const FREE_MODELS = ["openai", "openai-fast"];
const FREE_MODEL_KEY = "fork:free-model";
export const FREE_MAX_ATTEMPTS = 3;
export let freeBackoffMs = (attempt: number) => 400 * 2 ** attempt;
export function setFreeBackoff(fn: (a: number) => number) { freeBackoffMs = fn; }

async function free(messages: ChatMsg[], o: CallOpts = {}) {
  let stored: string | null = null;
  try { stored = localStorage.getItem(FREE_MODEL_KEY); } catch { /* ignore */ }
  const models = [stored, ...FREE_MODELS].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
  let last = 0;
  const attempts = o.quick ? 2 : FREE_MAX_ATTEMPTS;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const model = models[attempt % models.length]!;
    if (attempt > 0 && !o.quick) await new Promise((r) => setTimeout(r, freeBackoffMs(attempt - 1)));
    const res = await timedFetch("The free AI", "https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: !!o.onToken }),
    }, o.quick ? QUICK_TIMEOUT_MS : TIMEOUT_MS);
    if (res.ok) {
      const text = (await readReply(res, openaiFull, openaiChunk, o.onToken)).trim();
      if (!text) { last = 204; continue; }
      try { localStorage.setItem(FREE_MODEL_KEY, model); } catch { /* ignore */ }
      return text;
    }
    last = res.status;
    if (!(res.status === 429 || res.status >= 500 || res.status === 404)) break;
  }
  throw new ProviderError(
    `The free AI is busy right now (error ${last}). Try again in a minute, or add a free Groq or Gemini key in Settings.`,
    true,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let enginePromise: Promise<any> | null = null;

async function webllm(messages: ChatMsg[], onProgress?: (t: string) => void, o: CallOpts = {}) {
  if (!hasWebGPU())
    throw new ProviderError(
      "This browser or device doesn't support WebGPU, so the in-browser model can't run.",
    );
  if (!enginePromise) {
    enginePromise = import("@mlc-ai/web-llm").then((m) =>
      m.CreateMLCEngine(WEBLLM_MODEL, {
        initProgressCallback: (r: { text: string }) => onProgress?.(r.text),
      }),
    );
    enginePromise.catch(() => (enginePromise = null));
  }
  const engine = await enginePromise;
  if (!o.onToken) {
    const r = await engine.chat.completions.create({ messages });
    return String(r.choices?.[0]?.message?.content ?? "");
  }
  let full = "";
  for await (const chunk of await engine.chat.completions.create({ messages, stream: true })) {
    const piece = chunk.choices?.[0]?.delta?.content ?? "";
    if (piece) { full += piece; o.onToken(full); }
  }
  return full;
}

async function withNetwork<T>(name: string, p: () => Promise<T>) {
  try {
    return await p();
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(
      `Couldn't reach ${name}. Check your internet connection, or turn off ad blockers for this site.`,
    );
  }
}

export function complete(s: Settings, messages: ChatMsg[], onProgress?: (t: string) => void, o: CallOpts = {}) {
  if (s.provider === "free") return withNetwork("the free AI", () => free(messages, o));
  if (s.provider === "groq") {
    const k = cleanKey(s.groqKey);
    if (k.startsWith("AIza"))
      throw new ProviderError("That looks like a Gemini key. Choose Google Gemini in Settings.");
    return withNetwork("Groq", () => groq(k, messages, o));
  }
  if (s.provider === "gemini") {
    const k = cleanKey(s.geminiKey);
    if (k.startsWith("gsk_"))
      throw new ProviderError("That looks like a Groq key. Choose Groq in Settings.");
    return withNetwork("Gemini", () => gemini(k, messages, o));
  }
  return webllm(messages, onProgress, o);
}

export const providerLabel: Record<ProviderId, string> = {
  free: "Free AI",
  groq: "Groq",
  gemini: "Gemini",
  webllm: "In-browser",
};
