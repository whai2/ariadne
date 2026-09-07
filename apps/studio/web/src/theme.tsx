import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

// 라이트/다크 테마. 값은 `document.documentElement[data-theme]`로 스위칭되고(styles.css의
// :root[data-theme="light"] 오버라이드), 선택은 localStorage에 남는다. 다크가 기본.

export type Theme = "light" | "dark";

const KEY = "ariadne-studio-theme";

const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "dark",
  toggle: () => {},
});

function initialTheme(): Theme {
  // `?theme=light|dark`로 딥링크(공유·미리보기)할 수 있다. URL이 저장값보다 우선.
  try {
    const q = new URLSearchParams(location.search).get("theme");
    if (q === "light" || q === "dark") return q;
  } catch {
    // location 접근 실패 — 다음 소스로.
  }
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // private 모드 등 — 기본값으로.
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // 저장 실패는 무시 — 이번 세션엔 적용돼 있다.
    }
  }, [theme]);
  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
