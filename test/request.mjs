/* request actions: add with the form (headers, body, render), run: JSON (the public IP from api.ipify.org, needs
   network) through a render function, text, HTML, a failing render, the raw tab, an error status, an unreachable
   server with "Allow access"; the editor row. run: node test/request.mjs
   (SHOTS=dir for screenshots) */
import { newPage, connect, CDP, sleep, ok, resetData, dbAll } from "./cdp.mjs";

const SHOTS = process.env.SHOTS;
const P = await newPage();
await P.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 760, deviceScaleFactor: 1, mobile: false });
await sleep(800);
await P.ev(`localStorage.clear(); sessionStorage.clear()`);
await P.ev(resetData([{ name: "Notes", url: "#/notes" }]));
await P.send("Page.reload");
await sleep(1000);

const add = async ({ name, url, method = "GET", headers = "", body = "", render = null }) => {
  await P.ev(`document.querySelector('.tile-add').click()`);
  await sleep(100);
  await P.ev(`(() => {
    document.querySelector('#add-kind [data-kind=request]').click();
    document.getElementById('add-url').value = ${JSON.stringify(url)};
    document.getElementById('add-name').value = ${JSON.stringify(name)};
    document.getElementById('add-method').value = ${JSON.stringify(method)};
    document.getElementById('add-headers').value = ${JSON.stringify(headers)};
    document.getElementById('add-body').value = ${JSON.stringify(body)};
    if (${JSON.stringify(render)} !== null) document.getElementById('add-render').value = ${JSON.stringify(render)};
  })()`);
  if (SHOTS && name === "Echo") await P.shot(`${SHOTS}/request-form.png`);
  await P.ev(`document.getElementById('add-form').requestSubmit()`);
  await sleep(400);
};
const run = async (name, wait = 1500) => {
  await P.ev(`[...document.querySelectorAll('#home-grid .tile')].find((t) => t.querySelector('.tile-name').textContent === ${JSON.stringify(name)}).click()`);
  // until the answer is in (the local test server is sometimes slow), then a moment for the render frame
  for (let t = 0; t < 10e3 && (await P.ev(`document.getElementById('req-status').textContent.endsWith('…')`)); t += 100) await sleep(100);
  await sleep(Math.min(wait, 500));
  return P.ev(`({ open: document.getElementById('req').open, status: document.getElementById('req-status').textContent,
    meta: document.getElementById('req-meta').textContent, body: document.getElementById('req-body').textContent,
    note: document.getElementById('req-note').textContent, allow: !document.getElementById('req-allow').hidden })`);
};
const close = () => P.ev(`document.getElementById('req').close()`);
/* the render frame is sandboxed (another origin): read it through its own execution context */
async function frameHtml() {
  // an out-of-process iframe: its own DevTools target
  const t = (await (await fetch(`${CDP}/json/list`)).json()).find((x) => x.type === "iframe" && x.parentId === P.id && x.url.endsWith("/shell/render.html"));
  const F = await connect(t.webSocketDebuggerUrl);
  const html = await F.ev("document.body.innerHTML");
  F.close();
  return html;
}

// the form: request fields only for requests, headers as "Name: value" lines
await P.ev(`document.querySelector('.tile-add').click()`);
await sleep(100);
ok("open kind: no method/headers/body", await P.ev(`document.getElementById('add-method').hidden && document.getElementById('add-headers').hidden && !document.getElementById('add-blank').closest('label').hidden`));
await P.ev(`document.querySelector('#add-kind [data-kind=request]').click()`);
ok("render starts as x => x", (await P.ev(`document.getElementById('add-render').value`)) === "x => x");
ok("request kind: method/headers/body, no new tab", await P.ev(`!document.getElementById('add-method').hidden && !document.getElementById('add-body').hidden && document.getElementById('add-blank').closest('label').hidden`));
await P.ev(`document.getElementById('add-url').value = 'https://x.test'; document.getElementById('add-headers').value = 'no colon here'; document.getElementById('add-form').requestSubmit()`);
await sleep(200);
ok("bad header line refused", /headers, line 1/.test(await P.ev(`document.getElementById('add-msg').textContent`)));
await P.ev(`document.getElementById('add').close()`);

await add({ name: "My IP", url: "https://api.ipify.org?format=json", headers: "Accept: application/json", render: "x => `<b>${JSON.parse(x).ip}</b>`" });
await add({ name: "Html", url: "http://localhost:8765/stub.js", render: "x => '<h1>' + x.split('\\n').length + ' lines</h1>'" });
await add({ name: "Broken", url: "http://localhost:8765/stub.js", render: "x => x.nope()" });
await add({ name: "Echo", url: "http://localhost:8765/", method: "POST", headers: "Content-Type: application/json\nX-Test: 1", body: '{"a":1}' });
await add({ name: "Text", url: "http://localhost:8765/stub.js" });
await add({ name: "Down", url: "http://localhost:1/" });
const recs = (await P.ev(dbAll("actions"))).sort((a, b) => a.rank - b.rank);
const echo = recs.find((a) => a.name === "Echo");
ok("request record", echo.kind === "request" && echo.options.method === "POST" && echo.options.headers["X-Test"] === "1" && echo.options.body === '{"a":1}' && echo.options.render === "x => x" && echo.rank === 4, JSON.stringify(echo));

// JSON from a public service
let r = await run("My IP", 4000);
ok("My IP: 200 with the address", r.open && r.status.startsWith("200") && /"ip": "[\d.:a-f]+"/.test(r.body) && /ms · application\/json/.test(r.meta), JSON.stringify(r));
ok("render tab first, raw hidden", await P.ev(`!document.getElementById('req-pane-render').hidden && document.getElementById('req-pane-raw').hidden`));
let html = await frameHtml();
ok("rendered: just the IP in bold", /^<b>[\d.:a-f]+<\/b>$/.test(html), html);
if (SHOTS) await P.shot(`${SHOTS}/request-ip.png`);
await P.ev(`document.querySelector('#req-tabs [data-tab=raw]').click()`);
ok("raw tab: the body", await P.ev(`!document.getElementById('req-pane-raw').hidden && document.getElementById('req-pane-render').hidden`));
if (SHOTS) await P.shot(`${SHOTS}/request-raw.png`);
await close();

// HTML from a render function; a broken function says why
r = await run("Html");
ok("opens on the render tab again", await P.ev(`!document.getElementById('req-pane-render').hidden`));
html = await frameHtml();
ok("render returns HTML", /^<h1>\d+ lines<\/h1>$/.test(html), html + " " + JSON.stringify(r));
await close();
r = await run("Broken");
ok("broken render: error shown", /^render failed: .*nope/.test(r.note) && /render: /.test(await frameHtml()), r.note);
await close();

// text as it is; an error status
r = await run("Text");
ok("text body", r.status.startsWith("200") && r.body.startsWith("// test stub"), r.status);
html = await frameHtml();
ok("x => x shows the text as text", html.startsWith("// test stub") && !html.includes("<"), html.slice(0, 80));
await close();
r = await run("Echo");
ok("POST: error status shown", r.status.startsWith("501") && (await P.ev(`document.getElementById('req-status').classList.contains('err')`)), r.status);
await close();

// unreachable: offers access to the site; once granted it doesn't offer it again
r = await run("Down");
ok("network error offers access", r.status === "request failed" && r.allow && /CORS/.test(r.note), JSON.stringify(r));
await P.ev(`document.getElementById('req-allow').click()`);
await sleep(1500);
r = await P.ev(`({ allow: !document.getElementById('req-allow').hidden, note: document.getElementById('req-note').textContent })`);
ok("granted, sent again: just unreachable", !r.allow && /could not be reached\.$/.test(r.note) && (await P.ev(`chrome.permissions.granted.has('http://localhost/*')`)), JSON.stringify(r));
await close();

// the sidebar flyout runs it too
await P.ev(`[...document.querySelectorAll('#links .link')].find((n) => n.getAttribute('aria-label') === 'Text').dispatchEvent(new MouseEvent('mouseenter'))`);
ok("flyout says method and URL", (await P.ev(`document.querySelector('.flyout .fly-url').textContent`)) === "GET http://localhost:8765/stub.js");
await P.ev(`document.querySelector('.flyout').click()`);
await sleep(1000);
ok("flyout click runs it", await P.ev(`document.getElementById('req').open && document.getElementById('req-status').textContent.startsWith('200')`));
await close();

// the editor: a request row has the method button; ⚙ edits it in the form
await P.ev(`document.getElementById('links-edit').click()`);
await sleep(200);
ok("editor row shows the method", (await P.ev(`[...document.querySelectorAll('.sc-method')].map((b) => b.textContent).join()`)) === "GET,GET,GET,POST,GET,GET");
if (SHOTS) await P.shot(`${SHOTS}/request-editor.png`);
await P.ev(`document.querySelectorAll('.sc-method')[3].click()`);
await sleep(100);
ok("⚙ opens the form with the request", await P.ev(`document.getElementById('add').open && document.getElementById('add-method').value === 'POST' && document.getElementById('add-headers').value === 'Content-Type: application/json\\nX-Test: 1'`));
await P.ev(`document.getElementById('add-method').value = 'PUT'; document.getElementById('add-form').requestSubmit()`);
await sleep(200);
await P.ev(`document.getElementById('sc-save').click()`);
await sleep(400);
ok("edited and saved", (await P.ev(dbAll("actions"))).find((a) => a.name === "Echo").options.method === "PUT");

console.log("errors:", P.errors);
P.close();
process.exit(0);
