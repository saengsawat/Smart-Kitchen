#!/usr/bin/env node
/**
 * Manual web smoke check for the demo onboarding flow (BUG-001 guard).
 *
 * Drives a headless Chrome over the DevTools protocol through S1 (create a
 * household), S2 (pick an allergen chip and a preference chip, Continue),
 * Home, the Inventory tab, Add, Profile and Sign out (back to S1), and
 * fails on any console error
 * or uncaught exception (the BUG-001 red screen was "Maximum update depth
 * exceeded" right after S2's Continue).
 *
 * Not part of `pnpm test` and adds no dependency: it uses Node's own
 * WebSocket (global on Node 22+, behind `--experimental-websocket` on
 * Node 20) and the Chrome already installed on the machine.
 *
 * Usage (demo mode, no EXPO_PUBLIC_API_URL):
 *   1. pnpm --filter mobile start            (note the web URL, default :8081)
 *   2. node --experimental-websocket apps/mobile/scripts/web-demo-smoke.mjs [url]
 *
 * Env: CHROME_PATH overrides the Chrome binary; SMOKE_HEADED=1 shows the
 * window; SMOKE_VERBOSE=1 echoes the page's own console.log lines.
 * Exit code 0 on a clean run, 1 on any console error, exception or timeout.
 */
/* global console, process, URL, WebSocket, fetch, setTimeout -- standalone Node script, no eslint.config.js block covers apps/mobile/scripts */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://localhost:8081/";
const chromePath =
  process.env.CHROME_PATH ||
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "google-chrome");
const port = 9300 + Math.floor(Math.random() * 500);
const STEP_TIMEOUT_MS = 30000;

if (typeof WebSocket === "undefined") {
  console.error("No global WebSocket: run with `node --experimental-websocket` on Node 20.");
  process.exit(1);
}

const profileDir = mkdtempSync(join(tmpdir(), "sk-smoke-"));
const chrome = spawn(
  chromePath,
  [
    ...(process.env.SMOKE_HEADED === "1" ? [] : ["--headless=new"]),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=430,932",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const errors = [];
let ws;
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One console argument as text (a CDP RemoteObject). */
function argText(a) {
  if (a.value !== undefined) return String(a.value);
  return a.description || "";
}

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (res.exceptionDetails) {
    throw new Error(`evaluate failed: ${res.exceptionDetails.text}`);
  }
  return res.result.value;
}

function selectorFor(label) {
  return label.endsWith("*")
    ? `[aria-label^=${JSON.stringify(label.slice(0, -1))}]`
    : `[aria-label=${JSON.stringify(label)}]`;
}

async function waitFor(check, what) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (errors.length > 0) {
      throw new Error(`console error while waiting for ${what}`);
    }
    if (await evaluate(check)) {
      return;
    }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * A visible element with this aria-label: the last one by default (the
 * focused screen renders last), or the first with `which = "first"`.
 */
function findExpr(label, which = "last") {
  const sel = JSON.stringify(selectorFor(label));
  const pick = which === "first" ? "[0]" : ".pop()";
  return `[...document.querySelectorAll(${sel})].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })${pick}`;
}

async function centerOf(label, which = "last") {
  await waitFor(`Boolean(${findExpr(label, which)})`, `"${label}"`);
  return evaluate(
    `(() => { const e = ${findExpr(label, which)}; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
}

async function tap(label, which = "last") {
  const { x, y } = await centerOf(label, which);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
  console.log(`  tap "${label}"`);
  await sleep(300);
}

async function typeInto(label, text) {
  await tap(label);
  await send("Input.insertText", { text });
  console.log(`  type "${text}"`);
}

async function waitForPath(path) {
  await waitFor(`location.pathname === ${JSON.stringify(path)}`, `pathname ${path}`);
  console.log(`  at ${path}`);
}

async function connect() {
  let target;
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (!target && Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === "page");
    } catch (error) {
      void error; // ES2018 parser here: no optional catch binding
      await sleep(200);
    }
  }
  if (!target) {
    throw new Error("Chrome did not expose a page target");
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (
      process.env.SMOKE_VERBOSE === "1" &&
      msg.method === "Runtime.consoleAPICalled" &&
      msg.params.type !== "error"
    ) {
      console.log(`  [page ${msg.params.type}] ${msg.params.args.map(argText).join(" ")}`);
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      const text = msg.params.args.map(argText).join(" ");
      errors.push(`console.error: ${text}`);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      errors.push(`exception: ${(d.exception && d.exception.description) || d.text}`);
    } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      errors.push(`log: ${msg.params.entry.text} ${msg.params.entry.url || ""}`);
    }
  });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
}

async function main() {
  await connect();

  // Cold-start deep links with no household yet (a reload resets the demo
  // fixture): the gate must land each on S1, never on the destination.
  for (const path of ["/inventory", "/add"]) {
    console.log(`Deep link ${path} with no household`);
    await send("Page.navigate", { url: new URL(path, url).href });
    await waitForPath("/onboarding/account");
    await centerOf("Household name");
  }

  await send("Page.navigate", { url });

  console.log("S1: create a household");
  await typeInto("Household name", "Smoke Test Kitchen");
  await tap("Create household");
  // Over HTTP S1 shows the one-time join code and a Continue; older demo
  // builds go straight to S2. Handle both.
  await waitFor(
    `location.pathname === "/onboarding/allergies" || Boolean(${findExpr("Continue")})`,
    "S2 or the post-create Continue",
  );
  if ((await evaluate(`location.pathname`)) !== "/onboarding/allergies") {
    await tap("Continue");
  }
  await waitForPath("/onboarding/allergies");

  // The demo household seeds more than one member: one allergen chip on the
  // first member, an explicit "none" on the last, then a preference chip.
  console.log("S2: pick chips, Continue");
  await tap("peanut", "first");
  await tap("No known allergies for *");
  await tap("Vegetarian");
  await tap("Continue");
  await waitForPath("/");
  await centerOf("Account");
  console.log("  Home rendered");

  console.log("Tabs: Inventory, Add, Profile");
  await tap("Inventory");
  await waitForPath("/inventory");
  await tap("Add, scan");
  await waitForPath("/add");
  await tap("Back");
  await waitForPath("/inventory");
  await tap("Home");
  await waitForPath("/");
  await tap("Account");
  await waitForPath("/profile");
  await centerOf("Sign out");
  console.log("  Profile rendered");

  console.log("Sign out: back to S1");
  await tap("Sign out");
  await waitForPath("/onboarding/account");
  await centerOf("Household name");
  console.log("  S1 rendered");

  // Give any late render loop a moment to surface.
  await sleep(1500);
  if (errors.length > 0) {
    throw new Error("console errors during the flow");
  }
}

async function run() {
  let exitCode = 0;
  try {
    await main();
    console.log("PASS: demo flow clean, no console errors");
  } catch (err) {
    exitCode = 1;
    console.error(`FAIL: ${err.message}`);
    for (const e of errors) console.error(`  ${e.slice(0, 3000)}`);
    try {
      const where = await evaluate(
        `location.pathname + "\\n" + document.body.innerText.slice(0, 1500)`,
      );
      console.error(`  page at failure: ${where}`);
    } catch (error) {
      void error; // ES2018 parser here: no optional catch binding
      // the page may be gone
    }
  } finally {
    try {
      if (ws) ws.close();
    } catch (error) {
      void error; // ES2018 parser here: no optional catch binding
      // ignore
    }
    chrome.kill();
    await sleep(500);
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch (error) {
      void error; // ES2018 parser here: no optional catch binding
      // Chrome may still hold a lock on Windows; the OS temp cleaner gets it.
    }
  }
  return exitCode;
}

run().then((code) => process.exit(code));
