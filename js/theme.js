/* classic script in <head>, runs before the first paint: applies the theme main.js cached, so a chosen theme doesn't flash */
try {
  const theme = localStorage.getItem("theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {}
