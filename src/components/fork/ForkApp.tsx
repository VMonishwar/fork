import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  GitBranch, RotateCw, Send, Settings as SettingsIcon, Plus, Trash2, Pencil, Download, Upload,
  ChevronLeft, ChevronRight, Eraser, Check, X, Columns2, Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  addNode, attachPointFor, contextPacket, otherBranchCount, splitByTopic, navTarget, forkPoints, isConversation, laneColorVar, layoutRail, newConversation, pathTo, tipOf, uid,
  type Conversation,
} from "@/lib/fork-tree";
import { complete, defaultSettings, providerLabel, ProviderError, type Settings } from "@/lib/providers";
import { BranchRail } from "./BranchRail";
import { SettingsDialog } from "./SettingsDialog";
import { CompareDialog } from "./CompareDialog";
import { loadChats, saveChats, requestPersistence } from "@/lib/chat-store";
import forkLogo from "@/assets/fork-logo.png";
import { EasterEggs, useLogoEgg } from "./EasterEggs";

const ACTIVE_KEY = "fork:active";
const SETTINGS_KEY = "fork:settings";
const AWARE_KEY = "fork:awareness";

interface ReqError { message: string; rateLimited: boolean }

export function ForkApp() {
  const logoEgg = useLogoEgg();
  const [railOpen, setRailOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [errors, setErrors] = useState<Record<string, ReqError>>({});
  const [input, setInput] = useState("");
  const [confirm, setConfirm] = useState<null | { kind: "reset" | "delete"; id: string }>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [branching, setBranching] = useState<string | null>(null);
  const [branchVal, setBranchVal] = useState("");
  const [aware, setAware] = useState(true);
  const [compareOpen, setCompareOpen] = useState(false);
  const [topicNote, setTopicNote] = useState<null | { text: string }>(null);
  const [stream, setStream] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestPersistence();
    void loadChats().then((saved) => { try {
      const list: Conversation[] = Array.isArray(saved) ? saved.filter(isConversation) : [];
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
      if (s) setSettings({ ...defaultSettings, ...s });
      if (localStorage.getItem(AWARE_KEY) === "off") setAware(false);
      const l = list.length ? list : [newConversation()];
      setConvs(l);
      const a = localStorage.getItem(ACTIVE_KEY);
      setCurrentId(l.find((c) => c.id === a)?.id ?? l[0]!.id);
    } catch {
      const c = newConversation();
      setConvs([c]);
      setCurrentId(c.id);
    }
    setLoaded(true);
    });
  }, []);

  useEffect(() => { if (loaded) saveChats(convs); }, [convs, loaded]);
  useEffect(() => { if (loaded) localStorage.setItem(ACTIVE_KEY, currentId); }, [currentId, loaded]);
  useEffect(() => { if (loaded) localStorage.setItem(AWARE_KEY, aware ? "on" : "off"); }, [aware, loaded]);
  useEffect(() => { if (loaded) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings, loaded]);

  const conv = convs.find((c) => c.id === currentId);
  const update = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConvs((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [conv?.activeId, pending, stream.length > 0]);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [pending]);

  const requestReply = useCallback(
    async (snapshot: Conversation, userId: string) => {
      setPending(userId);
      setErrors((e) => { const n = { ...e }; delete n[userId]; return n; });
      const packet = contextPacket(snapshot, userId, { listOthers: aware });
      const sent = [{ role: "system" as const, content: packet.system }, ...packet.messages];
      const t0 = Date.now();
      setStartedAt(t0);
      setNow(t0);
      setStream("");
      try {
        const text = await complete(settings, sent, setProgress, { onToken: setStream });
        const ms = Date.now() - t0;
        update(snapshot.id, (c) => {
          const r = addNode(c, userId, "assistant", text || "(empty reply)");
          const nodes = { ...r.conv.nodes, [r.id]: { ...r.conv.nodes[r.id]!, ms, ...(aware && packet.system.includes("Other branches exist") ? { awareness: packet.system.split("\n").filter((l) => l.startsWith("Current path") || l.startsWith("Other branches")).join("\n") } : {}) } };
          return { ...r.conv, nodes, activeId: r.id };
        });
      } catch (err) {
        const pe = err instanceof ProviderError ? err : null;
        setErrors((e) => ({
          ...e,
          [userId]: {
            message: pe?.message ?? (err instanceof Error ? err.message : "Something went wrong."),
            rateLimited: pe?.rateLimited ?? false,
          },
        }));
      } finally {
        setPending(null);
        setProgress("");
        setStream("");
      }
    },
    [settings, update, aware],
  );

  const sendAt = (parentId: string, text: string, branch = false) => {
    if (!conv || !text.trim() || pending) return;
    const r = addNode(conv, parentId, "user", text.trim(), { branch });
    const next = { ...r.conv, activeId: r.id };
    update(conv.id, () => next);
    void requestReply(next, r.id);
    return r.id;
  };

  // Like a normal chat: the main box always continues the branch you're on. Branches only start from a Branch click.
  const sendMain = (text: string) => {
    if (!conv || !text.trim() || pending) return;
    sendAt(attachPointFor(conv), text);
    setTopicNote(null);
  };

  const findBranches = () => {
    if (!conv) return;
    const next = splitByTopic(conv);
    const n = forkPoints(next).length;
    update(conv.id, () => next);
    setTopicNote({ text: n ? "Split this chat into branches by topic." : "No topic changes found — this chat stays one branch." });
  };

  const regenerate = (assistantId: string) => {
    if (!conv || pending) return;
    void requestReply(conv, conv.nodes[assistantId]!.parentId as string);
  };

  const labelBranch = (id: string) => {
    if (!conv) return;
    const v = prompt("Name this branch (leave empty to remove):", conv.labels?.[id] ?? "");
    if (v === null) return;
    update(conv.id, (c) => {
      const labels = { ...(c.labels ?? {}) };
      if (v.trim()) labels[id] = v.trim().slice(0, 24); else delete labels[id];
      return { ...c, labels };
    });
  };

  const jump = (id: string) => conv && update(conv.id, (c) => ({ ...c, activeId: id }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !conv) return;
      const dir = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[e.key as "ArrowUp"];
      if (!dir) return;
      const t = navTarget(conv, dir);
      if (t) { e.preventDefault(); update(conv.id, (c) => ({ ...c, activeId: t })); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conv, update]);

  const newConv = () => {
    const c = newConversation();
    setConvs((cs) => [c, ...cs]);
    setCurrentId(c.id);
  };

  const doConfirm = () => {
    if (!confirm) return;
    if (confirm.kind === "reset") {
      update(confirm.id, (c) => ({ ...newConversation(c.title === "New conversation" ? c.title : c.title), id: c.id }));
    } else {
      const rest = convs.filter((c) => c.id !== confirm.id);
      const l = rest.length ? rest : [newConversation()];
      setConvs(l);
      if (currentId === confirm.id) setCurrentId(l[0]!.id);
    }
    setConfirm(null);
  };

  const exportConv = () => {
    if (!conv) return;
    const blob = new Blob([JSON.stringify(conv, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${conv.title.replace(/[^\w-]+/g, "_") || "fork"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importConv = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      if (!isConversation(data)) throw new Error();
      const c = { ...data, id: uid() };
      setConvs((cs) => [c, ...cs]);
      setCurrentId(c.id);
    } catch {
      alert("That file isn't a valid Fork conversation.");
    }
  };

  if (!loaded || !conv) return <div className="min-h-screen bg-background" />;

  const path = pathTo(conv, conv.activeId).slice(1).map((id) => conv.nodes[id]!);
  const { laneOf } = layoutRail(conv);
  const active = conv.nodes[conv.activeId]!;
  const pendingErr = active.role === "user" ? errors[active.id] : undefined;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground md:flex-row">
      <EasterEggs />
      {/* Conversations */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <img src={forkLogo} alt="Fork logo" width={32} height={32} onClick={logoEgg.onClick} className={`pixel-img size-8 shrink-0 cursor-pointer ${logoEgg.className}`} />
          <span className="font-pixel text-xl leading-7 tracking-wide text-primary">Fork</span>
        </div>
        <div className="p-2">
          <Button variant="outline" className="w-full justify-start" onClick={newConv}>
            <Plus /> New conversation
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2" aria-label="Conversations">
          {convs.map((c) => (
            <div key={c.id} className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${c.id === currentId ? "bg-accent" : "hover:bg-accent/60"}`}>
              {renaming === c.id ? (
                <form className="flex flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); update(c.id, (x) => ({ ...x, title: renameVal.trim() || x.title })); setRenaming(null); }}>
                  <input autoFocus aria-label="Conversation name" value={renameVal} onChange={(e) => setRenameVal(e.target.value)} className="min-w-0 flex-1 rounded border border-input bg-background px-1 text-sm" />
                  <button type="submit" aria-label="Save name"><Check className="size-4" /></button>
                  <button type="button" aria-label="Cancel" onClick={() => setRenaming(null)}><X className="size-4" /></button>
                </form>
              ) : (
                <>
                  <button className="min-w-0 flex-1 truncate text-left" onClick={() => setCurrentId(c.id)}>{c.title}</button>
                  <button aria-label="Rename" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => { setRenaming(c.id); setRenameVal(c.title); }}><Pencil className="size-3.5 text-muted-foreground" /></button>
                  <button aria-label="Delete" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => setConfirm({ kind: "delete", id: c.id })}><Trash2 className="size-3.5 text-muted-foreground" /></button>
                </>
              )}
            </div>
          ))}
        </nav>
        <div className="grid grid-cols-2 gap-1 border-t border-border p-2">
          <Button variant="ghost" size="sm" onClick={exportConv}><Download /> Export</Button>
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}><Upload /> Import</Button>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-2 md:hidden">
        <img src={forkLogo} alt="Fork logo" width={32} height={32} onClick={logoEgg.onClick} className={`pixel-img size-8 shrink-0 cursor-pointer ${logoEgg.className}`} />
        <span className="font-pixel text-xl leading-7 tracking-wide text-primary">Fork</span>
        <select aria-label="Conversation" value={currentId} onChange={(e) => setCurrentId(e.target.value)} className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm">
          {convs.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <Button size="icon" variant="ghost" aria-label="New conversation" onClick={newConv}><Plus /></Button>
        <Button size="icon" variant="ghost" aria-label="Export" onClick={exportConv}><Download /></Button>
        <Button size="icon" variant="ghost" aria-label="Import" onClick={() => fileRef.current?.click()}><Upload /></Button>
        <Button size="icon" variant="ghost" aria-label="Delete conversation" onClick={() => setConfirm({ kind: "delete", id: conv.id })}><Trash2 /></Button>
      </header>
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importConv(f); e.target.value = ""; }} />

      {/* Branch rail */}
      <section className={`${railOpen ? "max-h-48" : "max-h-9 overflow-hidden md:overflow-auto"} shrink-0 overflow-auto border-b border-border bg-card md:max-h-none md:w-72 md:border-b-0 md:border-r`} aria-label="Branch graph">
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-card px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          <button className="flex items-center gap-2 md:pointer-events-none" aria-expanded={railOpen} onClick={() => setRailOpen((o) => !o)}><GitBranch className="size-3.5" /> Branches <span className="md:hidden">{railOpen ? "▴" : "▾"}</span></button>
          {forkPoints(conv).length === 0 && path.filter((n) => n.role === "user").length > 1 && (
            <button onClick={findBranches} className="ml-auto rounded border border-border px-1.5 py-0.5 normal-case tracking-normal text-foreground hover:bg-accent">Find branches by topic</button>
          )}
        </div>
        <div className="pb-3"><BranchRail conv={conv} onJump={jump} onLabel={labelBranch} /></div>
      </section>

      {/* Chat */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <h1 className="truncate text-sm font-semibold">{conv.title}</h1>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setCompareOpen(true)}><Columns2 /> <span className="hidden sm:inline">Compare</span></Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirm({ kind: "reset", id: conv.id })}><Eraser /> Reset</Button>
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <SettingsIcon /> <span className="font-mono text-[11px]">{providerLabel[settings.provider]}</span>
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-2 px-3 py-4">
            {path.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
                <GitBranch className="mx-auto mb-3 size-6" style={{ color: laneColorVar(0) }} />
                <p>This is the trunk. Send a message to start.</p>
                <p className="mt-1 text-sm">Later, branch from any message to explore a different reply.</p>
              </div>
            )}
            {path.map((n) => {
              const parent = conv.nodes[n.parentId as string]!;
              const sibs = parent.children;
              const idx = sibs.indexOf(n.id);
              const color = laneColorVar(laneOf[n.id] ?? 0);
              const isUser = n.role === "user";
              const branchParent = isUser ? (n.parentId as string) : n.id;
              return (
                <article key={n.id} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                  {(sibs.length > 1 || n.branch) && isUser && (
                    <div className="my-1 flex w-full items-center gap-2 font-mono text-[10px] uppercase tracking-wider" style={{ color: color }}>
                      <span className="h-px flex-1" style={{ background: color, opacity: 0.4 }} />
                      <GitBranch className="size-3" /> {(laneOf[n.id] ?? 0) === 0 ? "main" : `branch ${laneOf[n.id]}`}{sibs.length > 1 ? ` · option ${idx + 1} of ${sibs.length}` : " · branched here"}
                      <span className="h-px flex-1" style={{ background: color, opacity: 0.4 }} />
                    </div>
                  )}
                  <div className={`mb-0.5 flex items-center gap-2 px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground ${isUser ? "flex-row-reverse" : ""}`}>
                    <span className="flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: color }} />{isUser ? "You" : "Assistant"}</span>
                    {!isUser && n.ms !== undefined && <span className="normal-case" title="Time the AI took to reply">{(n.ms / 1000).toFixed(1)}s</span>}
                    {sibs.length > 1 && (
                      <span className="flex items-center gap-0.5 rounded-full border px-1 normal-case" style={{ borderColor: color }}>
                        <button aria-label="Previous branch" disabled={idx === 0} className="rounded-full p-0.5 hover:bg-accent disabled:opacity-30" onClick={() => jump(tipOf(conv, sibs[idx - 1]!))}><ChevronLeft className="size-3.5" /></button>
                        <span>{isUser ? "branch" : "version"} {idx + 1}/{sibs.length}</span>
                        <button aria-label="Next branch" disabled={idx === sibs.length - 1} className="rounded-full p-0.5 hover:bg-accent disabled:opacity-30" onClick={() => jump(tipOf(conv, sibs[idx + 1]!))}><ChevronRight className="size-3.5" /></button>
                      </span>
                    )}
                  </div>
                  <div
                    className={`fork-md max-w-[92%] md:max-w-[85%] break-words px-3 py-2 text-[13px] leading-snug ${isUser ? "rounded-2xl rounded-br-sm bg-primary text-primary-foreground" : "rounded-2xl rounded-bl-sm border border-border bg-card"}`}
                    style={isUser ? undefined : { borderLeftColor: color, borderLeftWidth: 3 }}
                  >
                    {isUser ? <p className="whitespace-pre-wrap">{n.content}</p> : <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{mathify(n.content)}</ReactMarkdown>}
                  </div>
                  {!isUser && n.awareness && (
                    <details className="mt-0.5 max-w-[85%] text-[11px] text-muted-foreground">
                      <summary className="flex cursor-pointer list-none items-center gap-1 text-primary"><Brain className="size-3" /> Aware of {(n.awareness.match(/^- /gm) ?? []).length} other branch{(n.awareness.match(/^- /gm) ?? []).length === 1 ? "" : "es"}</summary>
                      <pre className="mt-1 whitespace-pre-wrap rounded border border-border bg-card p-2 font-mono text-[10px]">{n.awareness}</pre>
                    </details>
                  )}
                  <div className={`mt-0.5 flex gap-1 ${isUser ? "flex-row-reverse" : ""}`}>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-muted-foreground" disabled={!!pending} onClick={() => { setBranching(n.id); setBranchVal(isUser ? n.content : ""); }}>
                      <GitBranch /> {isUser ? "Edit as new branch" : "Branch from this reply"}
                    </Button>
                    {!isUser && (
                      <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-muted-foreground" disabled={!!pending} onClick={() => regenerate(n.id)}>
                        <RotateCw /> Different reply
                      </Button>
                    )}
                  </div>
                  {branching === n.id && (
                    <form className="mt-1 flex w-full max-w-[85%] gap-2" onSubmit={(e) => { e.preventDefault(); sendAt(branchParent, branchVal, true); setBranching(null); }}>
                      <textarea autoFocus aria-label="New branch message" placeholder={isUser ? "Edit your message…" : "Ask something different from here…"} value={branchVal}
                        onChange={(e) => setBranchVal(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } if (e.key === "Escape") setBranching(null); }}
                        rows={2} className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-[13px]" />
                      <div className="flex flex-col gap-1">
                        <Button type="submit" size="sm" disabled={!branchVal.trim()}><GitBranch /> Branch</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setBranching(null)}>Cancel</Button>
                      </div>
                    </form>
                  )}
                </article>
              );
            })}
            {pending && pending === conv.activeId && (
              <div className="flex flex-col items-start">
                <div className="mb-0.5 flex items-center gap-2 px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground" role="status">
                  <span className="flex gap-1">
                    {[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-pulse rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 150}ms` }} />)}
                  </span>
                  <span className="normal-case">{progress || (stream ? "Writing…" : "Thinking…")} {(Math.max(0, now - startedAt) / 1000).toFixed(1)}s</span>
                </div>
                {stream && (
                  <div className="fork-md max-w-[92%] md:max-w-[85%] break-words rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-[13px] leading-snug"
                    style={{ borderLeftColor: laneColorVar(laneOf[pending] ?? 0), borderLeftWidth: 3 }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{mathify(stream)}</ReactMarkdown>
                  </div>
                )}
              </div>
            )}
            {pendingErr && !pending && (
              <div role="alert" className="rounded-md border border-destructive/50 px-4 py-3 text-sm">
                <p className="text-destructive">{pendingErr.message}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => requestReply(conv, active.id)}><RotateCw /> Retry</Button>
                  {(pendingErr.rateLimited || /Settings/.test(pendingErr.message)) && (
                    <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}>
                      {pendingErr.rateLimited ? "Switch provider" : "Open settings"}
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <form className="border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); sendMain(input); setInput(""); }}>
          {topicNote && (
            <div className="mx-auto mb-1.5 flex max-w-3xl items-center gap-2 text-[11px] text-primary" role="status">
              <GitBranch className="size-3.5" /> {topicNote.text}
              <button type="button" className="ml-auto text-muted-foreground" aria-label="Dismiss" onClick={() => setTopicNote(null)}><X className="size-3.5" /></button>
            </div>
          )}
          <div className="mx-auto mb-1.5 flex max-w-3xl items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <Brain className={`size-3.5 ${aware ? "text-primary" : ""}`} />
            <span>{(() => { const k = otherBranchCount(conv, conv.activeId); return !aware ? "Branch awareness off — the AI only sees this branch" : k === 0 ? "No other branches yet" : `AI knows about ${k} other branch${k === 1 ? "" : "es"}`; })()}</span>
            <button type="button" role="switch" aria-checked={aware} aria-label="Branch awareness" onClick={() => setAware((v) => !v)}
              className={`ml-auto rounded-full border px-2 py-0.5 ${aware ? "border-primary text-primary" : "border-border"}`}>{aware ? "on" : "off"}</button>
          </div>
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              aria-label="Message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
              rows={1}
              placeholder={active.role === "user" ? "Send as a new branch of your last message…" : "Message…"}
              className="max-h-40 min-h-9 flex-1 resize-none rounded-md border border-input bg-card px-3 py-1.5 text-base md:text-[13px]"
            />
            <Button type="submit" size="icon" aria-label="Send" disabled={!input.trim() || !!pending}><Send /></Button>
          </div>
        </form>
      </main>

      <CompareDialog open={compareOpen} onOpenChange={setCompareOpen} conv={conv} settings={settings} onJump={jump} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} onChange={setSettings} />
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === "reset" ? "Reset this conversation?" : "Delete this conversation?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "reset" ? "All messages and branches will be cleared." : "It will be removed from this browser."} This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doConfirm}>{confirm?.kind === "reset" ? "Reset" : "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Models often write \( \) and \[ \]; the math renderer expects $ and $$. */
function mathify(s: string) {
  return s.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m}$$`).replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`);
}
