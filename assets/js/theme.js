setTheme(sessionStorage.getItem("theme"));

function toggleTheme() {
  const theme =
    !document.body.classList.contains("theme-dark") &&
    (document.body.classList.contains("theme-light") ||
      window.matchMedia("(prefers-color-scheme: light)").matches)
      ? "light"
      : "dark";

  setTheme(theme === "light" ? "dark" : "light");
}

function setTheme(theme) {
  document.body.classList.toggle("theme-dark", theme === "dark");
  document.body.classList.toggle("theme-light", theme === "light");
  sessionStorage.setItem("theme", theme);
}
