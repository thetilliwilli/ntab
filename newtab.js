const DEFAULT_LINKS = [
  { name: "Gmail", url: "https://mail.google.com" },
  { name: "GitHub", url: "https://github.com" },
  { name: "YouTube", url: "https://youtube.com" },
  { name: "Calendar", url: "https://calendar.google.com" },
  { name: "Claude", url: "https://claude.ai" },
];

const SEARCH_URL = "https://www.google.com/search?q=";

/* clock + greeting */

function tick() {
  const now = new Date();
  document.getElementById("clock").textContent = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  document.getElementById("date").textContent = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const h = now.getHours();
  const part = h < 5 ? "night" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  document.getElementById("greeting").textContent = `Good ${part}.`;
}

tick();
setInterval(tick, 1000);

/* search */

document.getElementById("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = document.getElementById("q").value.trim();
  if (q) location.href = SEARCH_URL + encodeURIComponent(q);
});

/* shortcuts */

function render(links) {
  const box = document.getElementById("links");
  box.textContent = "";
  for (const { name, url, target } of links) {
    const a = document.createElement("a");
    a.href = url;
    a.title = url;
    if (target) a.target = target;

    const icon = document.createElement("div");
    icon.className = "favicon";
    icon.textContent = name.trim().charAt(0) || "?";

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = name;

    a.append(icon, label);
    box.append(a);
  }
}

function parse(text) {
  return text
    .split("\n")
    .map((line) => {
      const [name, url, target] = line.split("|").map((s) => (s || "").trim());
      if (!name || !url) return null;
      return { name, url: /^https?:\/\//i.test(url) ? url : `https://${url}`, target };
    })
    .filter(Boolean);
}

function serialize(links) {
  return links.map(({ name, url, target }) => `${name} | ${url} ${target ? " | " + target : ""}`).join("\n");
}

let links = DEFAULT_LINKS;

chrome.storage.local.get({ links: DEFAULT_LINKS }).then((data) => {
  links = data.links;
  render(links);
});

render(links);

const dialog = document.getElementById("editor");

document.getElementById("edit").addEventListener("click", () => {
  document.getElementById("editor-text").value = serialize(links);
  dialog.showModal();
});

dialog.addEventListener("close", () => {
  if (dialog.returnValue !== "save") return;
  links = parse(document.getElementById("editor-text").value);
  render(links);
  chrome.storage.local.set({ links });
});
