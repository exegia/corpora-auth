/**
 * Follows the OS light/dark setting.
 *
 * `styles.css` keys its dark palette on `html.dark` rather than on
 * `prefers-color-scheme`, so a window can be flipped independently of the OS
 * later without restructuring the stylesheet. This puts the class on `<html>`
 * before React renders and keeps it in sync afterwards.
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
