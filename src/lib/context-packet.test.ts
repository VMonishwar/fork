import { it, expect } from "vitest";
import { newConversation, addNode, contextPacket } from "./fork-tree";

it("a branch sees its anchor but never a sibling branch's content", () => {
  let c = newConversation();
  const u = addNode(c, c.rootId, "user", "What is the sky made of?"); c = u.conv;
  const a = addNode(c, u.id, "assistant", "Nitrogen and oxygen."); c = a.conv;
  const b1 = addNode(c, a.id, "user", "How could water be the main cause?", { branch: true }); c = b1.conv;
  const b1a = addNode(c, b1.id, "assistant", "SECRET water answer"); c = b1a.conv;
  const b2 = addNode(c, a.id, "user", "What about ozone?", { branch: true }); c = b2.conv;
  const p = contextPacket(c, b2.id, { listOthers: true });
  const all = p.system + p.messages.map((m) => m.content).join(" ");
  expect(all).not.toContain("SECRET");
  expect(p.system).toContain('Branch anchor: "Nitrogen and oxygen."');
  expect(p.messages.map((m) => m.content)).toEqual(["What is the sky made of?", "Nitrogen and oxygen.", "What about ozone?"]);
});
