import { beforeEach, describe, expect, it, vi } from "vitest";
import { complete, parseModelSuggestion, setFreeBackoff, setGeminiBackoff } from "./providers";
setGeminiBackoff(0);

const RETIRED_BODY = JSON.stringify({
  error: {
    code: 404,
    message:
      "This model models/gemini-2.5-flash is no longer available to new users. " +
      "Please update your code to use models/gemini-3.8-flash for the latest features and improvements.",
  },
});

const ok = (text: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  text: async () => "",
});
const err = (status: number, body: string) => ({
  ok: false,
  status,
  json: async () => ({}),
  text: async () => body,
});

const geminiSettings = { provider: "gemini" as const, groqKey: "", geminiKey: "AIzaTest" };

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("gemini model selection", () => {
  it("reads the replacement model out of the 404 message", () => {
    expect(parseModelSuggestion(RETIRED_BODY)).toBe("gemini-3.8-flash");
    expect(parseModelSuggestion('{"error":{"code":404,"message":"Requested entity was not found."}}')).toBeNull();
  });

  it("retries with the model Google asks for and remembers it", async () => {
    localStorage.setItem("fork:gemini-model", "gemini-2.5-flash");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(err(404, RETIRED_BODY))
      .mockResolvedValueOnce(ok("hello"));
    vi.stubGlobal("fetch", fetchMock);

    const out = await complete(geminiSettings, [{ role: "user", content: "hi" }]);

    expect(out).toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("models/gemini-2.5-flash:generateContent");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("models/gemini-3.8-flash:generateContent");
    expect(localStorage.getItem("fork:gemini-model")).toBe("gemini-3.8-flash");
  });

  it("says the key was rejected instead of looping when the key is bad", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        err(
          400,
          '{"error":{"code":400,"message":"API key not valid.","reason":"API_KEY_INVALID"}}',
        ),
      ),
    );

    await expect(complete(geminiSettings, [{ role: "user", content: "hi" }])).rejects.toThrow(
      /Gemini rejected your API key/,
    );
  });

  it("gives a readable message when no model is available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(err(404, RETIRED_BODY)));

    await expect(complete(geminiSettings, [{ role: "user", content: "hi" }])).rejects.toThrow(
      /no model available to your key/i,
    );
  });
});

describe("free provider", () => {
  const free = { provider: "free" as const, groqKey: "", geminiKey: "" };
  beforeEach(() => { localStorage.clear(); setFreeBackoff(() => 0); });
  const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), { status: 200 });

  it("sends no key and returns the reply", async () => {
    const f = vi.fn(async () => ok());
    vi.stubGlobal("fetch", f);
    expect(await complete(free, [{ role: "user", content: "x" }])).toBe("hi");
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization|key/i);
  });

  it("retries a 503 then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", f);
    expect(await complete(free, [{ role: "user", content: "x" }])).toBe("hi");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("gives a readable message after 3 failures", async () => {
    const f = vi.fn(async () => new Response("busy", { status: 503 }));
    vi.stubGlobal("fetch", f);
    await expect(complete(free, [{ role: "user", content: "x" }])).rejects.toThrow(/free AI is busy/);
    expect(f).toHaveBeenCalledTimes(3);
  });
});

describe("free provider empty replies", () => {
  it("tries again when the model returns an empty reply", async () => {
    localStorage.clear(); setFreeBackoff(() => 0);
    const empty = new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 });
    const ok = new Response(JSON.stringify({ choices: [{ message: { content: "2" } }] }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(empty).mockResolvedValueOnce(ok));
    expect(await complete({ provider: "free", groqKey: "", geminiKey: "" }, [{ role: "user", content: "1+1" }])).toBe("2");
  });
});

import { cleanKey } from "./providers";
describe("cleanKey", () => {
  it("strips a stray leading dash", () => {
    expect(cleanKey("-AQ.Ab8Test")).toBe("AQ.Ab8Test");
  });
});

describe("gemini AQ keys", () => {
  it("tries another way of sending the key after a 401", async () => {
    localStorage.clear();
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"code":401,"status":"UNAUTHENTICATED"}}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "yo" }] } }] }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect(await complete({ provider: "gemini", groqKey: "", geminiKey: "AQ.Ab8Test" }, [{ role: "user", content: "hi" }])).toBe("yo");
    const h = (f.mock.calls[1] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(h["Authorization"]).toBe("Bearer AQ.Ab8Test");
    expect(localStorage.getItem("fork:gemini-auth")).toBe("bearer");
  });
});

import { readReply } from "./providers";
describe("streaming replies", () => {
  it("assembles a streamed reply piece by piece", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n';
    const res = new Response(sse, { headers: { "content-type": "text/event-stream" } });
    const seen: string[] = [];
    const full = await readReply(res, () => "", (j) => j.choices[0].delta.content, (t) => seen.push(t));
    expect(full).toBe("Hello");
    expect(seen).toEqual(["Hel", "Hello"]);
  });
  it("key test accepts a valid Gemini key even when Gemini is overloaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(err(503, "high demand")));
    const out = await complete(geminiSettings, [{ role: "user", content: "hi" }], undefined, { quick: true });
    expect(out).toMatch(/key was accepted/);
  });
});
