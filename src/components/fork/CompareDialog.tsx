import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { branchName, branchTips, comparePrompt, laneColorVar, layoutRail, type Conversation } from "@/lib/fork-tree";
import { complete, type Settings } from "@/lib/providers";

export function CompareDialog({
  open, onOpenChange, conv, settings, onJump,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  conv: Conversation;
  settings: Settings;
  onJump: (id: string) => void;
}) {
  const tips = branchTips(conv);
  const { laneOf } = layoutRail(conv);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setA(tips[tips.length - 2] ?? "");
    setB(tips[tips.length - 1] ?? "");
    setResult("");
    setErr("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conv.id]);

  const synth = async () => {
    setBusy(true); setErr(""); setResult("");
    try {
      setResult(await complete(settings, [{ role: "user", content: comparePrompt(conv, a, b) }]));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally { setBusy(false); }
  };

  const Pick = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <div className="min-w-0 flex-1 space-y-2">
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-1 text-[12px]">
        {tips.map((t) => <option key={t} value={t}>{branchName(conv, t)}</option>)}
      </select>
      {value && (
        <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-card p-2 text-[12px]" style={{ borderLeftColor: laneColorVar(laneOf[value] ?? 0), borderLeftWidth: 3 }}>
          <p className="whitespace-pre-wrap">{conv.nodes[value]?.content}</p>
          <Button variant="link" size="sm" className="h-auto p-0 text-[11px]" onClick={() => { onJump(value); onOpenChange(false); }}>Open this branch</Button>
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compare branches</DialogTitle>
          <DialogDescription>Pick two branch ends to see them side by side, then let the AI combine them.</DialogDescription>
        </DialogHeader>
        {tips.length < 2 ? (
          <p className="text-sm text-muted-foreground">You need at least two branches. Use "Edit as new branch" or "Branch from this reply" first.</p>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Pick value={a} onChange={setA} label="Branch A" />
              <Pick value={b} onChange={setB} label="Branch B" />
            </div>
            <Button onClick={synth} disabled={busy || !a || !b || a === b}>
              <Sparkles /> {busy ? "Comparing…" : "Compare & synthesize"}
            </Button>
            {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
            {result && (
              <div className="fork-md max-h-72 overflow-y-auto rounded-md border border-border p-3 text-[13px]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
