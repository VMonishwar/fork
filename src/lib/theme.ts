// Theme handling: light is the default, dark is opt-in and remembered in this browser.
// Only the <html> class changes; src/styles.css holds the two palettes (:root and .dark).

export type Theme = "light" | "dark";

export const THEME_KEY = "fork.theme";

/** The stored theme, or "light" when nothing was chosen (or storage is blocked). */
export function readTheme(store: Pick<Storage, "getItem"> | null = null): Theme {
  try {
    const s = store ?? (typeof localStorage === "undefined" ? null : localStorage);
    return s?.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Put the theme on <html> so the palette in styles.css applies. */
export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** Remember the choice and apply it straight away. */
export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage blocked: the theme still applies for this visit */
  }
  applyTheme(theme);
}
