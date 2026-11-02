/* inside the sandboxed render frame (render.html). handshake: the frame says { ready } when it loads and again when
   the page asks { hello } (the frame may load before the page listens, so either side can be first).
   the page sends { id, code, text, style }; the frame evaluates
   `code` (a function source like  x => x.slice(0, 100)), calls it with the response text and shows what it returns:
   a string with tags as HTML, any other string as text, anything else as JSON. it answers { id, ok, text, error }
   and { height } whenever its content changes size */

const send = (msg) => parent.postMessage(msg, "*");

new ResizeObserver(() => send({ height: document.documentElement.scrollHeight })).observe(document.body);

const looksLikeHtml = (s) => /<[a-z!/][^>]*>/i.test(s);

addEventListener("message", async (e) => {
  if (e.source !== parent) return;
  if (e.data?.hello) return send({ ready: true });
  const { id, code, text, style } = e.data ?? {};
  Object.assign(document.body.style, style ?? {});
  document.body.className = "";
  try {
    const fn = (0, eval)(`(${code}\n)`);
    if (typeof fn !== "function") throw new Error("render must be a function, e.g.  x => x");
    let out = await fn(text);
    if (out == null) out = "";
    else if (typeof out !== "string") out = JSON.stringify(out, null, 2) ?? String(out);
    if (looksLikeHtml(out)) document.body.innerHTML = out;
    else {
      document.body.textContent = out;
      document.body.className = "text";
    }
    send({ id, ok: true, text: document.body.innerText });
  } catch (err) {
    const p = document.createElement("div");
    p.className = "err";
    p.textContent = `render: ${err?.message ?? err}`;
    document.body.replaceChildren(p);
    send({ id, ok: false, error: String(err?.message ?? err) });
  }
});

send({ ready: true });
