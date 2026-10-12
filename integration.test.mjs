import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

const sessionControllerBundle = process.env.DSH_SESSION_CONTROLLER_BUNDLE;
const officialCheck = { skip: sessionControllerBundle ? false : "Set DSH_SESSION_CONTROLLER_BUNDLE to an absolute official bundle path" };

function store(initial) { let value = initial; const listeners = new Set(); return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, set(v) { value = v; for (const fn of [...listeners]) fn(); } }; }
function fixture() {
  assert.ok(isAbsolute(sessionControllerBundle), "DSH_SESSION_CONTROLLER_BUNDLE must be an absolute path");
  const source = readFileSync(sessionControllerBundle, "utf8");
  const start = source.indexOf("function freezeRetainedBy(counts)");
  const end = source.indexOf("//#endregion", start);
  assert.ok(start >= 0 && end > start, "Official session-controller bundle must contain the ClientSessions implementation");
  const inputs = new Map(); const attachments = new Map(); const drops = [];
  class SessionManager {
    constructor() { this.sessions = new Map(); }
    subscribe() { return () => {}; }
    resolveTarget(target) { return target; }
    get(id) { if (!this.sessions.has(id)) this.sessions.set(id, { sessionId: id, eventSource: {}, bindScope() {}, unbindScope() {}, open: () => Promise.resolve(), getSnapshot: () => ({ blank: false, running: false }) }); return this.sessions.get(id); }
    getListSnapshot() { return { items: ["a", "b", "unopened"].map(sessionId => ({ sessionId, title: sessionId, blank: false, running: false, updatedAt: 0 })), phase: "ready", projectionsBySession: {} }; }
    subagentAddress() { return undefined; }
    drop(id) { drops.push(id); this.sessions.delete(id); return Promise.resolve(); }
    dispose() { return Promise.resolve(); }
  }
  const rootDisposers = []; const rootCtx = { reflect: { provide() {} }, effect(fn) { const dispose = fn(); rootDisposers.push(dispose); return dispose; } };
  function createScope(root, id) {
    const disposers = []; const ctx = { id, effect(fn) { const dispose = fn(); disposers.push(dispose); return dispose; } };
    const input = { state: store({ draft: "", attachmentIds: [], phase: "plain" }), detachedDrafts: new Map(), attachmentFlights: new Map() }; inputs.set(ctx, input);
    return { ctx, fiber: { async dispose() { for (const fn of disposers.reverse()) await fn?.(); for (const aid of input.state.getSnapshot().attachmentIds) attachments.delete(aid); inputs.delete(ctx); } } };
  }
  const context = vm.createContext({ SessionManager, createScope, displayTitleOf: (title, cwd, id) => title ?? id, _deepseek_ai_dsh_client_store: { createSnapshotStore: store, notifySubscribers: listeners => { for (const fn of [...listeners]) fn(); } }, AbortController, AbortSignal, setTimeout, clearTimeout, Promise });
  vm.runInContext(source.slice(start, end) + "\nthis.ClientSessions = ClientSessions;", context);
  const sessions = new context.ClientSessions(rootCtx, {}); sessions.projectList();
  const conversation = { input: { for: ctx => inputs.get(ctx) }, sendSession: async () => ({ kind: "success" }) };
  let plugin; vm.runInNewContext(readFileSync(new URL("./client.js", import.meta.url), "utf8"), { setTimeout, clearTimeout, window: { __ModuleLoader__: { load: m => { plugin = m.factory(); } } } });
  plugin.apply({ sessions, conversation, effect: rootCtx.effect });
  let main; function open(id) { const next = sessions.retain(id, { source: "mainView" }); main?.release(); main = next; return next.binding; }
  function set(binding, patch) { const state = inputs.get(binding.ctx).state; state.set({ ...state.getSnapshot(), ...patch }); }
  return { sessions, inputs, attachments, drops, open, set };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
test("packaged ClientSessions preserves exact binding and attachment bytes through A/B/A", officialCheck, async () => {
  const h = fixture(); const a = h.open("a"); h.attachments.set("a-image", new Uint8Array([1, 4, 9])); h.set(a, { draft: "A text", attachmentIds: ["a-image"] });
  const b = h.open("b"); h.set(b, { draft: "B text" }); await tick();
  assert.equal(h.open("a"), a); assert.equal(h.sessions.binding("b"), b);
  assert.equal(h.inputs.get(a.ctx).state.getSnapshot().draft, "A text"); assert.deepEqual(h.attachments.get("a-image"), new Uint8Array([1, 4, 9]));
  assert.equal(h.sessions.retainInfo("a").getSnapshot().retainedBy.composerDraft, 1); assert.equal(h.sessions.binding("unopened"), undefined);
});
test("packaged ClientSessions retires scope only after draft is cleared", officialCheck, async () => {
  const h = fixture(); const a = h.open("a"); h.set(a, { draft: "retain" }); h.open("b"); await tick(); assert.equal(h.sessions.binding("a"), a);
  h.set(a, { draft: "" }); await tick(); assert.equal(h.sessions.binding("a"), undefined); assert.ok(h.drops.includes("a"));
});
