import { describe, it, expect } from "vitest";
import { newConversation, addNode, attachPointFor, tipOf, pathTo, layoutRail } from "./fork-tree";

describe("fork tree", () => {
  it("rejects user after user", () => {
    const c = newConversation();
    const { conv, id } = addNode(c, c.rootId, "user", "hi");
    expect(() => addNode(conv, id, "user", "x")).toThrow();
  });
  it("main input on active user message becomes sibling", () => {
    let c = newConversation();
    const r = addNode(c, c.rootId, "user", "a");
    c = { ...r.conv, activeId: r.id };
    expect(attachPointFor(c)).toBe(c.rootId);
  });
  it("tip follows most recent child and branches get new lanes", () => {
    let c = newConversation();
    const u = addNode(c, c.rootId, "user", "q");
    c = u.conv;
    const a1 = addNode(c, u.id, "assistant", "r1");
    c = a1.conv;
    const a2 = addNode(c, u.id, "assistant", "r2");
    c = a2.conv;
    expect(tipOf(c, c.rootId)).toBe(a2.id);
    expect(pathTo(c, a2.id)).toEqual([c.rootId, u.id, a2.id]);
    const { laneOf } = layoutRail(c);
    expect(laneOf[a1.id]).toBe(0);
    expect(laneOf[a2.id]).toBe(0); // regenerated reply = version, same lane
  });
});

import { divergenceNote, branchTips, comparePrompt } from "./fork-tree";
describe("branch awareness", () => {
  it("mentions the sibling branch not taken, and nothing when there is none", () => {
    let c = newConversation();
    const u1 = addNode(c, c.rootId, "user", "Use Python?"); c = u1.conv;
    const a1 = addNode(c, u1.id, "assistant", "Python is great"); c = a1.conv;
    expect(divergenceNote(c, a1.id)).toBeNull();
    const u2 = addNode(c, c.rootId, "user", "Use Rust?"); c = u2.conv;
    const note = divergenceNote(c, u2.id)!;
    expect(note).toContain("Use Python?");
    expect(note).toContain("Python is great");
    expect(note).not.toContain("Use Rust?");
    expect(branchTips(c)).toEqual([a1.id]); // unanswered u2 is not a branch
    expect(comparePrompt(c, a1.id, u2.id)).toMatch(/Branch A[\s\S]*Python[\s\S]*Branch B[\s\S]*Rust/);
  });
});

import { branchSummaries, forkPoints, otherBranchCount } from "./fork-tree";
describe("branch summaries", () => {
  it("lists branches, fork points and other-branch counts", () => {
    let c = newConversation();
    const u1 = addNode(c, c.rootId, "user", "hi"); c = u1.conv;
    const a1 = addNode(c, u1.id, "assistant", "hello"); c = a1.conv;
    const u2 = addNode(c, a1.id, "user", "path A"); c = u2.conv;
    const r2 = addNode(c, u2.id, "assistant", "A reply"); c = r2.conv;
    const u3 = addNode(c, a1.id, "user", "path B"); c = u3.conv;
    const r3 = addNode(c, u3.id, "assistant", "B reply"); c = { ...r3.conv, activeId: r3.id };
    expect(forkPoints(c)).toEqual([a1.id]);
    const s = branchSummaries(c);
    expect(s).toHaveLength(2);
    expect(s.find((b) => b.tipId === r3.id)?.isActive).toBe(true);
    expect(s.find((b) => b.tipId === r2.id)?.isActive).toBe(false);
    expect(otherBranchCount(c, u3.id)).toBe(1);
    expect(otherBranchCount(c, a1.id)).toBe(0);
  });
});

import { startsNewTopic, topicBranchPoint, splitByTopic, branchTips as tips2 } from "./fork-tree";
describe("topic branching", () => {
  it("detects topic changes but not follow-ups", () => {
    expect(startsNewTopic("can you do quadratic formula", "What is x in 2x+4=8 subtract 4 divide both sides x = 2")).toBe(true);
    expect(startsNewTopic("what about dividing by 3", "divide both sides")).toBe(false);
    expect(startsNewTopic("solve 2x+4=8 differently", "What is x in 2x+4=8")).toBe(false);
  });
  it("splits the user's straight chat into a main line and branches", () => {
    let c = newConversation();
    const say = (p: string, role: "user" | "assistant", t: string) => { const r = addNode(c, p, role, t); c = r.conv; return r.id; };
    const u1 = say(c.rootId, "user", "hello");
    const a1 = say(u1, "assistant", "Hello! How can I help you today?");
    const u2 = say(a1, "user", "What is x in 2x+4=8");
    const a2 = say(u2, "assistant", "Subtract 4 from both sides, divide by 2, x = 2");
    say(a2, "user", "can you do quadratic formula");
    expect(topicBranchPoint(c, a2, "can you do quadratic formula")).not.toBeNull();
    const s = splitByTopic(c);
    expect(tips2(s).length).toBe(1); // the unanswered quadratic message is not a branch yet
    expect(forkPoints(s).length).toBe(1);
    // main keeps hello → x question; the quadratic topic branches off main at the first reply
    const quad = Object.values(s.nodes).find((n) => n.content === "can you do quadratic formula")!;
    expect(s.nodes[quad.parentId!]!.content).toBe("Hello! How can I help you today?");
    expect(topicBranchPoint(c, a1, "What is x in 2x+4=8")).toBeNull();
    expect(Object.keys(s.nodes).length).toBe(Object.keys(c.nodes).length);
  });
});

import { matchingBranch } from "./fork-tree";
describe("hash-table branch matching", () => {
  it("routes a message back to the branch whose topic it matches", () => {
    let c = newConversation();
    const say = (p: string, role: "user" | "assistant", t: string) => { const r = addNode(c, p, role, t); c = r.conv; return r.id; };
    const u1 = say(c.rootId, "user", "hello");
    const a1 = say(u1, "assistant", "Hi there");
    const u2 = say(a1, "user", "explain photosynthesis");
    const a2 = say(u2, "assistant", "Plants turn sunlight into sugar");
    const u3 = say(a1, "user", "quadratic formula please");
    const a3 = say(u3, "assistant", "x equals minus b plus or minus root discriminant");
    expect(matchingBranch(c, a3, "more about photosynthesis in plants")).toBe(a2);
    expect(matchingBranch(c, a3, "quadratic discriminant again")).toBeNull();
    expect(matchingBranch(c, a3, "tell me a joke")).toBeNull();
  });
});

import { stem, moveNode, navTarget } from "./fork-tree";
describe("reliable branching", () => {
  const build = () => {
    let c = newConversation();
    const say = (p: string, role: "user" | "assistant", t: string) => { const r = addNode(c, p, role, t); c = r.conv; return r.id; };
    const u1 = say(c.rootId, "user", "hello");
    const a1 = say(u1, "assistant", "Hi there");
    const u2 = say(a1, "user", "explain photosynthesis");
    const a2 = say(u2, "assistant", "Plants turn sunlight into sugar");
    const u3 = say(a1, "user", "quadratic formula please");
    const a3 = say(u3, "assistant", "x equals minus b plus or minus root discriminant");
    return { c, a1, a2, a3, u3 };
  };
  it("one shared word does not move the message", () => {
    const { c, a3 } = build();
    expect(matchingBranch(c, a3, "what do plants eat")).toBeNull();
  });
  it("two shared topic words do", () => {
    const { c, a2, a3 } = build();
    expect(matchingBranch(c, a3, "plants and sunlight")).toBe(a2);
  });
  it("word endings match", () => {
    expect(stem("dividing")).toBe(stem("divide"));
    expect(stem("divided")).toBe(stem("divides"));
  });
  it("older reply versions are not branches", () => {
    let c = newConversation();
    const u = addNode(c, c.rootId, "user", "q"); c = u.conv;
    const v1 = addNode(c, u.id, "assistant", "r1"); c = v1.conv;
    const v2 = addNode(c, u.id, "assistant", "r2"); c = { ...v2.conv, activeId: v2.id };
    expect(branchTips(c)).toEqual([v2.id]);
    expect(forkPoints(c)).toEqual([]);
  });
  it("moveNode re-attaches and keeps alternation", () => {
    const { c, a1, a2, u3 } = build();
    const m = moveNode(c, u3, a2);
    expect(m.nodes[u3]!.parentId).toBe(a2);
    expect(m.nodes[a1]!.children).not.toContain(u3);
    expect(() => moveNode(c, u3, u3)).toThrow();
  });
  it("keyboard nav switches to the neighbouring branch", () => {
    const { c, a2, a3 } = build();
    expect(navTarget({ ...c, activeId: a3 }, "left")).toBe(a2);
    expect(navTarget({ ...c, activeId: a2 }, "right")).toBe(a3);
  });
});

import { branchSummaries as summaries } from "./fork-tree";
describe("explicit branch clicks", () => {
  it("branching from the latest reply opens a new lane and keeps main listed", () => {
    let c = newConversation();
    const u = addNode(c, c.rootId, "user", "hello"); c = u.conv;
    const a = addNode(c, u.id, "assistant", "hi"); c = a.conv;
    const b = addNode(c, a.id, "user", "a joke please", { branch: true }); c = b.conv;
    const r = addNode(c, b.id, "assistant", "joke"); c = { ...r.conv, activeId: r.id };
    const { laneOf } = layoutRail(c);
    expect(laneOf[a.id]).toBe(0);
    expect(laneOf[b.id]).toBe(1);
    const s = summaries(c);
    expect(s.map((x) => x.lane)).toEqual([0, 1]);
    expect(s.find((x) => x.isActive)?.lane).toBe(1);
  });
  it("continuing main after a branch stays on main's lane", () => {
    let c = newConversation();
    const u = addNode(c, c.rootId, "user", "hello"); c = u.conv;
    const a = addNode(c, u.id, "assistant", "hi"); c = a.conv;
    const b = addNode(c, a.id, "user", "branch msg", { branch: true }); c = b.conv;
    const m = addNode(c, a.id, "user", "main msg"); c = m.conv;
    const { laneOf } = layoutRail(c);
    expect(laneOf[m.id]).toBe(0);
    expect(laneOf[b.id]).toBe(1);
  });
});
