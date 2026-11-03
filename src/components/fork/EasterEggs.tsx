import { useEffect, useRef, useState } from "react";

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
const WORDS: Record<string, string> = {
  spoon: "There is no spoon. Only forks.",
  knife: "Knives cut. Forks branch. Choose wisely.",
};

/** Hidden extras: Konami code toggles 8-bit mode, typing "spoon"/"knife" anywhere shows a quip. */
export function EasterEggs() {
  const [msg, setMsg] = useState<string | null>(null);
  const seq = useRef<string[]>([]);
  const typed = useRef("");
  const show = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3000); };

  useEffect(() => {
    console.log("%c🍴 Fork", "font:16px monospace;color:#5ee0d0", "\nYou found the console. Try the Konami code. ↑↑↓↓←→←→BA");
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return; // never react while typing a chat message
      seq.current = [...seq.current, e.key].slice(-KONAMI.length);
      if (seq.current.join() === KONAMI.join()) {
        const on = document.documentElement.classList.toggle("eight-bit");
        if (on) document.documentElement.classList.add("pixel");
        show(on ? "8-BIT MODE UNLOCKED  +1UP" : "Back to 16 million colours");
        seq.current = [];
      }
      if (e.key.length === 1) {
        typed.current = (typed.current + e.key.toLowerCase()).slice(-10);
        for (const w in WORDS) if (typed.current.endsWith(w)) { show(WORDS[w]!); typed.current = ""; }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onEgg = (e: Event) => show((e as CustomEvent<string>).detail);
    window.addEventListener("fork-egg", onEgg);
    return () => window.removeEventListener("fork-egg", onEgg);
  }, []);

  if (!msg) return null;
  return (
    <div role="status" className="pixel-pop fixed bottom-6 left-1/2 z-50 -translate-x-1/2 border-2 border-primary bg-card px-4 py-2 font-pixel text-sm text-primary shadow-[4px_4px_0_var(--primary)]">
      {msg}
    </div>
  );
}

/** Clicking the logo 7 times makes it spin and says hello. */
export function useLogoEgg() {
  const n = useRef(0);
  const [spin, setSpin] = useState(false);
  const onClick = () => {
    n.current += 1;
    if (n.current >= 7) {
      n.current = 0;
      setSpin(true);
      setTimeout(() => setSpin(false), 900);
      window.dispatchEvent(new CustomEvent("fork-egg", { detail: "Fork it! You've forked the fork." }));
    }
  };
  return { onClick, className: spin ? "fork-spin" : "" };
}
