/* inside the sandboxed render frame (render.html). handshake: the frame says { ready } when it loads and again when
   the page asks { hello } (the frame may load before the page listens, so either side can be first).

   the page sends { id, code, text, type, url, style }. `code` is a function source like  w => w.document.title;
   it is called with `w`, a window-like object: w.document is the response parsed as a document (HTML as HTML,
   anything else as text in a <pre>; DOMParser: its scripts don't run, nothing loads, no layout), w.text the body
   as it came, w.json the body parsed as JSON, w.url the request URL. (a real window would need a nested frame,
   and a frame inside a sandboxed page gets an origin of its own: its document is out of reach.)
   what it returns is shown in #out: an element (or a list of them) as its HTML, `w` itself as the body text,
   a string with tags as HTML, any other string or number as text, anything else as JSON.
   answers: { id, ok, text, error } and { height } whenever #out changes size */

const out = document.getElementById("out");
const send = (msg) => parent.postMessage(msg, "*");

new ResizeObserver(() => send({ height: out.offsetHeight })).observe(out);

const looksLikeHtml = (s) => /<[a-z!/][^>]*>/i.test(s);
const isHtml = (text, type) => /html|xml/i.test(type) || (!type && /^\s*</.test(text));

/* the response as a document; relative links resolve against the request URL */
function parse(text, type, url) {
  const doc = isHtml(text, type) ? new DOMParser().parseFromString(text, "text/html") : document.implementation.createHTMLDocument("");
  if (!isHtml(text, type)) doc.body.append(Object.assign(doc.createElement("pre"), { textContent: text }));
  if (url && !url.startsWith("data:") && !doc.querySelector("base[href]")) doc.head.prepend(Object.assign(doc.createElement("base"), { href: url }));
  return doc;
}

const isNode = (v) => typeof v?.nodeType === "number";
const isNodeList = (v) => typeof v === "object" && v !== null && typeof v.length === "number" && typeof v.item === "function";

function show(value, w) {
  out.className = "";
  if (value === w) value = w.text; // the window itself: the whole body
  if (value == null) value = "";
  if (isNode(value)) value = value.outerHTML ?? value.textContent;
  else if (isNodeList(value)) value = [...value].map((n) => n.outerHTML ?? n.textContent).join("\n");
  else if (typeof value !== "string") value = typeof value === "object" ? JSON.stringify(value, null, 2) ?? String(value) : String(value);
  if (looksLikeHtml(value)) out.innerHTML = value;
  else {
    out.textContent = value;
    out.className = "text";
  }
}

let text = "";
let current = 0; // the job being done; an older one that finishes later is dropped

addEventListener("message", async (e) => {
  if (e.source !== parent) return;
  if (e.data?.hello) return send({ ready: true });
  const { id, code, type = "", url = "", style } = e.data ?? {};
  current = id;
  text = e.data?.text ?? "";
  Object.assign(document.body.style, style ?? {});
  document.getElementById("base").href = url && !url.startsWith("data:") ? url : "";
  try {
    const fn = (0, eval)(`(${code}\n)`);
    if (typeof fn !== "function") throw new Error("render must be a function, e.g.  w => w.document.title");
    const body = text;
    const w = {
      document: parse(body, type, url),
      text: body,
      url,
      get json() {
        return JSON.parse(body);
      },
    };
    const value = await fn(w);
    if (id !== current) return;
    show(value, w);
    send({ id, ok: true, text: out.innerText });
  } catch (err) {
    if (id !== current) return;
    const p = document.createElement("div");
    p.className = "err";
    p.textContent = `render: ${err?.message ?? err}`;
    out.className = "";
    out.replaceChildren(p);
    send({ id, ok: false, error: String(err?.message ?? err) });
  }
});

send({ ready: true });
