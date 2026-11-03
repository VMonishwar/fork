import { describe, expect, it } from "vitest";
import { applyTheme, readTheme, saveTheme, THEME_KEY } from "./theme";

const store = (value: string | null) => ({
  getItem: (k: string) => (k === THEME_KEY ? value : null),
});

describe("readTheme", () => {
  it("is light when nothing has been chosen", () => {
    expect(readTheme(store(null))).toBe("light");
  });

  it("is light for any stored value except dark", () => {
    expect(readTheme(store("light"))).toBe("light");
    expect(readTheme(store("nonsense"))).toBe("light");
  });

  it("is dark only when dark was saved", () => {
    expect(readTheme(store("dark"))).toBe("dark");
  });

  it("is light when storage is blocked", () => {
    expect(readTheme({ getItem: () => { throw new Error("blocked"); } })).toBe("light");
  });
});

describe("applyTheme / saveTheme", () => {
  it("puts the dark class on <html> only for dark", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("remembers the choice and applies it", () => {
    saveTheme("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(readTheme()).toBe("dark");

    saveTheme("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(readTheme()).toBe("light");
  });
});
