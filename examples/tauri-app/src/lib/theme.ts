/**
 * Follows the OS light/dark setting.
 *
 * `@exegia/auth-ui` declares `@custom-variant dark (&:is(.dark *))`, so the
 * dark palette is keyed on a *class*, not on `prefers-color-scheme` — the
 * media query alone styles nothing. This puts the class on `<html>` before
 * React renders and keeps it in sync afterwards.
 *
 * Called from `main.tsx`, so every window gets it: each one is a separate
 * webview with its own document, and a class set in the picker does not reach
 * the method windows.
 */
export function followSystemTheme(): void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");

  const apply = (dark: boolean): void => {
    document.documentElement.classList.toggle("dark", dark);
  };

  apply(query.matches);
  query.addEventListener("change", (e) => apply(e.matches));
}
