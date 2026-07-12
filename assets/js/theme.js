import { sendGiscusMessage } from "./giscus.js";

export function restoreTheme() {
  setTheme(sessionStorage.getItem("theme"));
}

export function toggleTheme() {
  const theme =
    !document.body.classList.contains("theme-dark") &&
    (document.body.classList.contains("theme-light") ||
      window.matchMedia("(prefers-color-scheme: light)").matches)
      ? "light"
      : "dark";

  setTheme(theme === "light" ? "dark" : "light");
}

export function setTheme(theme) {
  document.body.classList.toggle("theme-dark", theme === "dark");
  document.body.classList.toggle("theme-light", theme === "light");
  sendGiscusMessage({ setConfig: { theme: theme } });
  sessionStorage.setItem("theme", theme);
}
