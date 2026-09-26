"use client";
import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "kernelagent.theme";

/** The current theme and a setter that applies and remembers it. Light is the default. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("light");
  useEffect(() => {
    setThemeState(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);
  const setTheme = (t: Theme) => {
    if (t === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // storage blocked: the choice lasts for this page only
    }
    setThemeState(t);
  };
  return [theme, setTheme];
}
