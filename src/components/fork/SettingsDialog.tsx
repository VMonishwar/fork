import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { complete, hasWebGPU, WEBLLM_MODEL, type ProviderId, type Settings } from "@/lib/providers";
import { readTheme, saveTheme, type Theme } from "@/lib/theme";

const options: { id: ProviderId; name: string; blurb: string }[] = [
  { id: "free", name: "Free AI (no key)", blurb: "No setup — works instantly" },
  { id: "groq", name: "Groq", blurb: "Fast, free API key" },
  { id: "gemini", name: "Google Gemini", blurb: "Free key from AI Studio" },
  { id: "webllm", name: "In-browser model", blurb: "No key, runs on your device" },
];

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const gpu = hasWebGPU();
  const [pixel, setPixel] = useState(true);
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    if (!open) return;
    setPixel(document.documentElement.classList.contains("pixel"));
    setTheme(readTheme());
  }, [open]);
  const pickTheme = (t: Theme) => { setTheme(t); saveTheme(t); };
  const togglePixel = () => {
    const on = !pixel;
    setPixel(on);
    document.documentElement.classList.toggle("pixel", on);
    try { localStorage.setItem("fork.pixel", on ? "on" : "off"); } catch { /* storage blocked */ }
  };
  const [test, setTest] = useState<{ state: "idle" | "busy" | "ok" | "err"; msg?: string }>({ state: "idle" });
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (test.state !== "busy") return;
    const t0 = Date.now();
    const t = setInterval(() => setSecs((Date.now() - t0) / 1000), 100);
    return () => clearInterval(t);
  }, [test.state]);
  const runTest = async () => {
    setSecs(0);
    setTest({ state: "busy" });
    const t0 = Date.now();
    try {
      const out = await complete(settings, [{ role: "user", content: "Reply with: ok" }], undefined, { quick: true });
      const took = ((Date.now() - t0) / 1000).toFixed(1);
      const busy = /busy right now/.test(out);
      setTest({ state: "ok", msg: `${settings.provider === "free" ? "Connected" : "Key works"}${busy ? " (the service is busy, replies may be slow)" : ""} · ${took}s` });
    } catch (e) {
      setTest({ state: "err", msg: e instanceof Error ? e.message : "Test failed." });
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Keys are saved only in this browser and sent only to the provider you choose.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2" role="radiogroup" aria-label="AI provider">
          {options.map((o) => (
            <button
              key={o.id}
              role="radio"
              aria-checked={settings.provider === o.id}
              onClick={() => { setTest({ state: "idle" }); onChange({ ...settings, provider: o.id }); }}
              className={`rounded-md border p-3 text-left ${
                settings.provider === o.id ? "border-primary bg-accent" : "border-border hover:bg-accent"
              }`}
            >
              <div className="text-sm font-semibold">{o.name}</div>
              <div className="font-mono text-[11px] text-muted-foreground">{o.blurb}</div>
            </button>
          ))}
        </div>

        {settings.provider === "groq" && (
          <div className="space-y-2 text-sm">
            <label className="font-mono text-[11px] text-muted-foreground" htmlFor="groq">GROQ API KEY</label>
            <Input id="groq" type="password" value={settings.groqKey} placeholder="gsk_…"
              onChange={(e) => { setTest({ state: "idle" }); onChange({ ...settings, groqKey: e.target.value }); }} />
            <p className="text-muted-foreground">
              Sign in at{" "}
              <a className="text-primary underline" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">
                console.groq.com/keys
              </a>
              , click "Create API Key", and paste it here.
            </p>
          </div>
        )}
        {settings.provider === "gemini" && (
          <div className="space-y-2 text-sm">
            <label className="font-mono text-[11px] text-muted-foreground" htmlFor="gem">GEMINI API KEY</label>
            <Input id="gem" type="password" value={settings.geminiKey} placeholder="AIza…"
              onChange={(e) => { setTest({ state: "idle" }); onChange({ ...settings, geminiKey: e.target.value }); }} />
            <p className="text-muted-foreground">
              Open{" "}
              <a className="text-primary underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                aistudio.google.com/apikey
              </a>
              , click "Create API key", and paste it here.
            </p>
          </div>
        )}
        {settings.provider === "webllm" && (
          <div className="space-y-2 text-sm text-muted-foreground">
            {gpu ? (
              <p>Your browser supports WebGPU. The first reply downloads the model ({WEBLLM_MODEL}, about 0.9 GB), then it's cached.</p>
            ) : (
              <p className="text-destructive">This browser or device doesn't support WebGPU, so the in-browser model can't run here. Try a recent Chrome or Edge on desktop.</p>
            )}
          </div>
        )}
        {settings.provider !== "webllm" && (
          <div className="space-y-1">
            <Button size="sm" variant="outline" disabled={test.state === "busy"} onClick={runTest}>
              {test.state === "busy" ? `Testing… ${secs.toFixed(0)}s` : settings.provider === "free" ? "Test connection" : "Test key"}
            </Button>
            {test.msg && (
              <p role="status" className={`text-sm ${test.state === "ok" ? "text-primary" : "text-destructive"}`}>{test.msg}</p>
            )}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
          <div>
            <div className="font-semibold">Theme</div>
            <div className="font-mono text-[11px] text-muted-foreground">Light is the default; dark is easier on the eyes at night</div>
          </div>
          <div className="flex gap-1" role="radiogroup" aria-label="Theme">
            {(["light", "dark"] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={theme === t} onClick={() => pickTheme(t)}
                className={`rounded-md border px-3 py-1 text-xs capitalize ${theme === t ? "border-primary text-primary" : "border-border"}`}>{t}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
          <div>
            <div className="font-semibold">Pixel theme</div>
            <div className="font-mono text-[11px] text-muted-foreground">Retro pixel look across the app</div>
          </div>
          <button type="button" role="switch" aria-checked={pixel} aria-label="Pixel theme" onClick={togglePixel}
            className={`rounded-md border px-3 py-1 text-xs ${pixel ? "border-primary text-primary" : "border-border"}`}>{pixel ? "on" : "off"}</button>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">
          Free tiers have rate limits. If you hit one, switch provider or wait a minute.
        </p>
      </DialogContent>
    </Dialog>
  );
}
