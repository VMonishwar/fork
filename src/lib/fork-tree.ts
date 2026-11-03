export type Role = "root" | "user" | "assistant";

export interface ForkNode {
  id: string;
  parentId: string | null;
  role: Role;
  content: string;
  children: string[];
  seq: number;
  createdAt: number;
  /** Branch-context note the AI was given when writing this reply. */
  awareness?: string;
  /** Started with an explicit "Branch" click: always opens its own lane. */
  branch?: boolean;
  /** How long the AI took to write this reply, in milliseconds. */
  ms?: number;
}

export interface Conversation {
  id: string;
  title: string;
  rootId: string;
  activeId: string;
  nodes: Record<string, ForkNode>;
  seq: number;
  createdAt: number;
  updatedAt: number;
  /** Optional branch labels keyed by node id. */
  labels?: Record<string, string>;
}

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export function newConversation(title = "New conversation"): Conversation {
  const rootId = uid();
  const now = Date.now();
  return {
    id: uid(),
    title,
    rootId,
    activeId: rootId,
    nodes: {
      [rootId]: { id: rootId, parentId: null, role: "root", content: "", children: [], seq: 0, createdAt: now },
    },
    seq: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** Root-to-node ids, root included. */
export function pathTo(c: Conversation, id: string): string[] {
  const out: string[] = [];
  let cur: ForkNode | undefined = c.nodes[id];
  while (cur) {
    out.unshift(cur.id);
    cur = cur.parentId ? c.nodes[cur.parentId] : undefined;
  }
  return out;
}

/** Follow most recently added child down to a leaf. */
export function tipOf(c: Conversation, id: string): string {
  let cur = c.nodes[id]!;
  while (cur.children.length) cur = c.nodes[cur.children[cur.children.length - 1]!]!;
  return cur.id;
}

/** Immutable add. Enforces strict alternation. */
export function addNode(
  c: Conversation,
  parentId: string,
  role: "user" | "assistant",
  content: string,
  opts: { branch?: boolean } = {},
): { conv: Conversation; id: string } {
  const parent = c.nodes[parentId];
  if (!parent) throw new Error("Parent not found");
  const ok =
    role === "assistant" ? parent.role === "user" : parent.role === "root" || parent.role === "assistant";
  if (!ok) throw new Error(`A ${role} message cannot follow a ${parent.role} message`);
  const id = uid();
  const seq = c.seq + 1;
  const node: ForkNode = { id, parentId, role, content, children: [], seq, createdAt: Date.now(), ...(opts.branch ? { branch: true } : {}) };
  const nodes = { ...c.nodes, [id]: node, [parentId]: { ...parent, children: [...parent.children, id] } };
  let title = c.title;
  if (role === "user" && parent.role === "root" && parent.children.length === 0 && title === "New conversation") {
    title = content.slice(0, 40) || title;
  }
  return { conv: { ...c, nodes, seq, title, updatedAt: Date.now() }, id };
}

/** Where a new message typed in the main input attaches. */
export function attachPointFor(c: Conversation): string {
  const a = c.nodes[c.activeId]!;
  return a.role === "user" ? (a.parentId as string) : a.id;
}

export interface RailRow {
  id: string;
  lane: number;
  parentId: string | null;
  parentLane: number;
  role: Role;
  content: string;
}

/** Lane layout like a git graph: first child inherits lane, later children open new lanes. */
export function layoutRail(c: Conversation): { rows: RailRow[]; laneOf: Record<string, number>; lanes: number } {
  const laneOf: Record<string, number> = { [c.rootId]: 0 };
  let next = 1;
  const ordered = Object.values(c.nodes)
    .filter((n) => n.role !== "root")
    .sort((a, b) => a.seq - b.seq);
  for (const n of ordered) {
    const p = c.nodes[n.parentId as string]!;
    // Regenerated replies (assistant leaves beside the first reply) are versions, not branches.
    const version = n.role === "assistant" && n.children.length === 0;
    // The first child that isn't an explicit branch continues the parent's lane.
    const firstPlain = p.children.find((id) => !c.nodes[id]!.branch);
    laneOf[n.id] = firstPlain === n.id || version ? laneOf[p.id]! : next++;
  }
  const rows = ordered.map((n) => ({
    id: n.id,
    lane: laneOf[n.id]!,
    parentId: n.parentId,
    parentLane: laneOf[n.parentId as string]!,
    role: n.role,
    content: n.content,
  }));
  return { rows, laneOf, lanes: next };
}

export function laneColorVar(lane: number) {
  return lane === 0 ? "var(--lane-0)" : `var(--lane-${((lane - 1) % 6) + 1})`;
}

export function isConversation(x: unknown): x is Conversation {
  const c = x as Conversation;
  return !!c && typeof c === "object" && typeof c.rootId === "string" && !!c.nodes?.[c.rootId];
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/** An older regenerated reply that isn't being viewed: a version, not a branch. */
function isStaleVersion(c: Conversation, n: ForkNode, active: Set<string>): boolean {
  if (n.role !== "assistant" || n.children.length) return false;
  const p = c.nodes[n.parentId as string]!;
  const leaves = p.children.filter((id) => c.nodes[id]!.role === "assistant" && c.nodes[id]!.children.length === 0);
  if (leaves.length < 2) return false;
  const shown = leaves.find((id) => active.has(id)) ?? leaves[leaves.length - 1];
  return shown !== n.id;
}

/** Real branch tips, oldest first. Skips unanswered user messages and older reply versions. */
export function branchTips(c: Conversation): string[] {
  const active = new Set(pathTo(c, c.activeId));
  return Object.values(c.nodes)
    .filter((n) => n.role === "assistant" && (n.children.length === 0 ? !isStaleVersion(c, n, active) : n.children.every((id) => c.nodes[id]!.branch)))
    .sort((a, b) => a.seq - b.seq)
    .map((n) => n.id);
}

/** Short human name for a branch tip: its label, or the user message that opened it. */
export function branchName(c: Conversation, tipId: string): string {
  const ids = pathTo(c, tipId);
  for (let i = ids.length - 1; i >= 0; i--) {
    const l = c.labels?.[ids[i]!];
    if (l) return l;
  }
  const firstUser = [...ids].reverse().map((id) => c.nodes[id]!).find((n) => n.role === "user");
  return clip(firstUser?.content ?? "Branch", 40);
}

/**
 * Note describing the alternatives the user left behind on the way to `nodeId`:
 * for every fork on the path, the sibling branches not taken. Null when there are none.
 */
export function divergenceNote(c: Conversation, nodeId: string, max = 3): string | null {
  const path = pathTo(c, nodeId);
  const onPath = new Set(path);
  const notes: string[] = [];
  for (const id of path) {
    const n = c.nodes[id]!;
    for (const sib of n.children) {
      if (onPath.has(sib)) continue;
      const s = c.nodes[sib]!;
      const tip = c.nodes[tipOf(c, sib)]!;
      const what = s.role === "user" ? `the user asked "${clip(s.content, 120)}"` : `you replied "${clip(s.content, 120)}"`;
      const end = tip.id !== s.id ? `; that branch ended with "${clip(tip.content, 140)}"` : "";
      notes.push(`- In another branch, ${what}${end}.`);
    }
  }
  if (!notes.length) return null;
  return (
    "[Branch context — this conversation branches. Alternatives the user explored elsewhere:\n" +
    notes.slice(-max).join("\n") +
    "\nThe user chose a different direction here. Answer for this branch; mention the other branches only if useful.]"
  );
}

/** Prompt asking the model to compare and synthesize two branches. */
export function comparePrompt(c: Conversation, a: string, b: string): string {
  const show = (tip: string) =>
    pathTo(c, tip)
      .map((id) => c.nodes[id]!)
      .filter((n) => n.role !== "root")
      .map((n) => `${n.role === "user" ? "User" : "Assistant"}: ${clip(n.content, 1200)}`)
      .join("\n");
  return (
    `Two branches of the same conversation are below.\n\n=== Branch A: ${branchName(c, a)} ===\n${show(a)}\n\n` +
    `=== Branch B: ${branchName(c, b)} ===\n${show(b)}\n\n` +
    "Compare them: where they agree, where they differ, pros and cons of each, then give one synthesized recommendation that combines the best of both. Use short headings and bullets."
  );
}

export interface BranchSummary { tipId: string; lane: number; name: string; length: number; isActive: boolean }

/** One entry per branch tip, oldest first. */
export function branchSummaries(c: Conversation): BranchSummary[] {
  const { laneOf } = layoutRail(c);
  return branchTips(c).map((tipId) => ({
    tipId,
    lane: laneOf[tipId] ?? 0,
    name: branchName(c, tipId),
    length: pathTo(c, tipId).length - 1,
    isActive: laneOf[tipId] === laneOf[c.activeId] && (pathTo(c, tipId).includes(c.activeId) || pathTo(c, c.activeId).includes(tipId)),
  })).sort((x, y) => x.lane - y.lane);
}

/** Node ids with more than one child (where the chat splits). */
export function forkPoints(c: Conversation): string[] {
  const active = new Set(pathTo(c, c.activeId));
  return Object.values(c.nodes)
    .filter((n) => n.children.filter((id) => !isStaleVersion(c, c.nodes[id]!, active)).length > 1 || n.children.some((id) => c.nodes[id]!.branch))
    .map((n) => n.id);
}

/** How many sibling branches branch off the path to nodeId. */
export function otherBranchCount(c: Conversation, nodeId: string): number {
  const path = pathTo(c, nodeId);
  const on = new Set(path);
  let n = 0;
  for (const id of path.slice(0, -1)) for (const ch of c.nodes[id]!.children) if (!on.has(ch)) n++;
  return n;
}

// ---------- Topic detection (no AI) ----------
const STOP = new Set("one two use using used way thing things something number numbers example question answer help explain mean means say said work works good great sure right let lets could see look find try again now here only well really still even each other same new first last next many such over after before because while being been will shall may might must our ours mine yours his her him she he we me my the and for you your are was were what with this that from have has can could would should how why who when where which there their them they then than into about also just like make does did not but all any some more most very much get got give tell show please want need know think its it's i'm yes okay thanks thank hello hi hey".split(" "));
const FOLLOW_UP = /^(and|also|but|so|then|what about|how about|why|ok|okay|thanks|thank|it|that|this|those|these|more|explain|continue|go on|again|another|same|now)\b/i;

/** Crude stemmer so divide / dividing / divided / divides map to one word. */
export function stem(w: string): string {
  if (w.length <= 4) return w;
  const s = w.replace(/(ingly|ing|edly|ed|es|s|ly)$/, "");
  return (s.length >= 3 ? s : w).replace(/e$/, "");
}

export function topicWords(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.toLowerCase().match(/[a-z0-9]*\d[a-z0-9+\-*/^=.]*/g) ?? []) if (m.length >= 3) out.add(m);
  for (const w of s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.add(stem(w));
  }
  return out;
}

/** First user message of the topic that `nodeId` belongs to (walks back while messages stay on topic). */
function topicStart(c: Conversation, nodeId: string): string | null {
  const full = pathTo(c, nodeId);
  const onPath = new Set(full);
  const users = full.map((id) => c.nodes[id]!).filter((n) => n.role === "user");
  if (!users.length) return null;
  let start = users[users.length - 1]!;
  for (let i = users.length - 1; i > 0; i--) {
    const cur = users[i]!;
    const prev = users[i - 1]!;
    const prevReply = prev.children.map((id) => c.nodes[id]!).find((n) => onPath.has(n.id));
    if (startsNewTopic(cur.content, prev.content + " " + (prevReply?.content ?? ""))) break;
    start = prev;
  }
  return start.id;
}

/** True when `text` shares no meaningful words with `context` and doesn't read like a follow-up. */
export function startsNewTopic(text: string, context: string): boolean {
  if (FOLLOW_UP.test(text.trim())) return false;
  const a = topicWords(text);
  if (!a.size) return false;
  const b = topicWords(context);
  for (const w of a) if (b.has(w)) return false;
  return true;
}

/**
 * If a message typed at `attachId` changes topic, the node it should branch from instead
 * (the point where the current topic began). Null when it continues the current topic.
 */
export function topicBranchPoint(c: Conversation, attachId: string, text: string): string | null {
  const att = c.nodes[attachId];
  if (!att || att.role !== "assistant") return null;
  const start = topicStart(c, attachId);
  if (!start) return null;
  const ctx = pathTo(c, attachId).slice(pathTo(c, start).length - 1).map((id) => c.nodes[id]!.content).join(" ");
  if (!startsNewTopic(text, ctx)) return null;
  const anchor = c.nodes[start]!.parentId;
  // Never fork from the very start: the first topic change continues main, later ones branch off main.
  if (!anchor || anchor === c.rootId) return null;
  return anchor;
}

/** Rebuild a straight-line chat so each change of topic becomes its own branch. */
export function splitByTopic(c: Conversation): Conversation {
  const ids = pathTo(c, tipOf(c, c.rootId)).slice(1);
  if (Object.keys(c.nodes).length - 1 !== ids.length) return c; // only for unbranched chats
  let out: Conversation = { ...newConversation(c.title), id: c.id, createdAt: c.createdAt };
  const map: Record<string, string> = {};
  let at = out.rootId;
  for (const id of ids) {
    const n = c.nodes[id]!;
    let parent = at;
    if (n.role === "user") parent = topicBranchPoint(out, at, n.content) ?? at;
    const r = addNode(out, parent, n.role as "user" | "assistant", n.content);
    out = r.conv;
    out.nodes[r.id] = { ...out.nodes[r.id]!, createdAt: n.createdAt, ...(n.awareness ? { awareness: n.awareness } : {}) };
    map[id] = r.id;
    at = r.id;
  }
  const labels = Object.fromEntries(Object.entries(c.labels ?? {}).map(([k, v]) => [map[k] ?? k, v]));
  return { ...out, title: c.title, activeId: map[c.activeId] ?? at, labels };
}

/**
 * Hash-table index of topic words → branch tips that mention them.
 * Lookups are O(words in the message), like a hash table keyed by each word.
 */
export function topicIndex(c: Conversation): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const tip of branchTips(c)) {
    for (const id of pathTo(c, tip)) {
      for (const w of topicWords(c.nodes[id]!.content)) {
        let s = index.get(w);
        if (!s) index.set(w, (s = new Set()));
        s.add(tip);
      }
    }
  }
  return index;
}

/**
 * Existing branch (tip id) on a different path whose topic best matches `text`, or null.
 * Words shared by every branch (e.g. from the common start) don't count.
 */
export function matchingBranch(c: Conversation, attachId: string, text: string): string | null {
  const tips = branchTips(c);
  if (tips.length < 2) return null;
  const here = new Set(pathTo(c, attachId));
  const index = topicIndex(c);
  const hereWords = new Set<string>();
  for (const id of here) for (const w of topicWords(c.nodes[id]!.content)) hereWords.add(w);
  const score = new Map<string, number>();
  let hereScore = 0;
  for (const w of topicWords(text)) {
    const hits = index.get(w);
    if (hereWords.has(w)) hereScore++;
    if (!hits || hits.size === tips.length) continue;
    for (const t of hits) score.set(t, (score.get(t) ?? 0) + 1);
  }
  let best: string | null = null;
  let top = 0;
  for (const [t, s] of score) if (s > top && !here.has(t)) { best = t; top = s; }
  // Only move when confident: 2+ shared topic words and clearly more than the current branch.
  if (!best || top < 2 || top <= hereScore) return null;
  const tip = c.nodes[best]!;
  return tip.role === "assistant" ? best : null;
}

/** Re-attach a user message (and everything under it) to a different parent. */
export function moveNode(c: Conversation, id: string, newParentId: string): Conversation {
  const n = c.nodes[id];
  const np = c.nodes[newParentId];
  if (!n || !np || n.role !== "user" || n.parentId === newParentId) return c;
  if (np.role === "user") throw new Error("A user message cannot follow a user message");
  if (pathTo(c, newParentId).includes(id)) throw new Error("Cannot move a message under itself");
  const old = c.nodes[n.parentId as string]!;
  const nodes = {
    ...c.nodes,
    [old.id]: { ...old, children: old.children.filter((x) => x !== id) },
    [np.id]: { ...np, children: [...np.children, id] },
    [id]: { ...n, parentId: newParentId },
  };
  return { ...c, nodes, updatedAt: Date.now() };
}

/** Message one step up/down the current path, or the neighbouring branch at the nearest split. */
export function navTarget(c: Conversation, dir: "up" | "down" | "left" | "right"): string | null {
  const path = pathTo(c, c.activeId);
  if (dir === "up") return path.length > 2 ? path[path.length - 2]! : null;
  if (dir === "down") { const a = c.nodes[c.activeId]!; return a.children.length ? a.children[a.children.length - 1]! : null; }
  for (let i = path.length - 1; i > 0; i--) {
    const sibs = c.nodes[path[i - 1]!]!.children;
    if (sibs.length < 2) continue;
    const j = sibs.indexOf(path[i]!) + (dir === "left" ? -1 : 1);
    return j >= 0 && j < sibs.length ? tipOf(c, sibs[j]!) : null;
  }
  return null;
}

/** Rules the AI follows inside the branching chat (sent as the system message). */
export const BRANCH_RULES = `You are the AI inside a branching chat app. The conversation is a tree: a main trunk plus branches opened from any message.
- Answer from the current path only. Never use or reveal content from sibling or unrelated branches.
- Treat the branch anchor (the message this branch started from) as the focus unless the user clearly changes subject.
- If the user refers to something outside your context, name the branch it probably comes from (if listed below) and ask whether to pull it in. Do not guess its content.
- Facts stay local to their branch unless the user asks to add them to main.
- When a branch reaches a clear answer, you may offer one line starting "Takeaway:" that stands alone and can be sent back to main.
- Name the branch only when context switches or the user seems lost. Don't restate the full path.
- Be accurate: correct wrong premises kindly and directly, in the branch where they appear.
- Friendly, clear, concise. No filler.`;

/** Branch-scoped context packet: path titles, older-turn summary, other branch titles (titles only). */
export function contextPacket(
  c: Conversation, nodeId: string, opts: { listOthers?: boolean; keep?: number } = {},
): { system: string; messages: { role: "user" | "assistant"; content: string }[] } {
  const keep = opts.keep ?? 8;
  const nodes = pathTo(c, nodeId).map((id) => c.nodes[id]!).filter((n) => n.role !== "root");
  const crumbs = ["Main"];
  for (const n of nodes) if (n.branch && n.role === "user") crumbs.push(`"${clip(n.content, 50)}"`);
  const branchStart = [...nodes].reverse().find((n) => n.branch);
  const lines = [BRANCH_RULES, "", `Current path: ${crumbs.join(" > ")}`];
  if (branchStart) {
    const anchor = branchStart.parentId ? c.nodes[branchStart.parentId] : undefined;
    if (anchor && anchor.role !== "root") lines.push(`Branch anchor: "${clip(anchor.content, 160)}"`);
  } else lines.push("You are on the main thread.");
  const older = nodes.slice(0, Math.max(0, nodes.length - keep));
  if (older.length)
    lines.push("Summary of earlier turns on this path:", ...older.map((n) => `- ${n.role === "user" ? "User" : "You"}: ${clip(n.content, 100)}`));
  if (opts.listOthers) {
    const onPath = new Set(pathTo(c, nodeId));
    const titles = branchTips(c).filter((t) => !onPath.has(t)).map((t) => `"${branchName(c, t)}"`);
    if (titles.length) lines.push(`Other branches exist (titles only, content not available): ${titles.slice(0, 6).join(", ")}`);
  }
  return {
    system: lines.join("\n"),
    messages: nodes.slice(-keep).map((n) => ({ role: n.role as "user" | "assistant", content: n.content })),
  };
}
