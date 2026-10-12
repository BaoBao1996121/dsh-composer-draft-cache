import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const code = readFileSync(new URL("./client.js", import.meta.url), "utf8");
function store(initial) {
  let value = initial; const listeners = new Set();
  return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, set(next) { value = next; for (const fn of [...listeners]) fn(); }, listeners };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
function setup(enabled = true) {
  let plugin; vm.runInNewContext(code, { window: { __ModuleLoader__: { load: m => { plugin = m.factory(); } } }, setTimeout, clearTimeout });
  const catalog = { a: { id: "a", retainedBy: {} }, b: { id: "b", retainedBy: {} }, unopened: { id: "unopened", retainedBy: {} } };
  const list = store({ byId: catalog }); const scopes = new Map(); const attachments = new Map(); const calls = []; const pendingSends = []; let cleanup;
  function publish() { list.set({ byId: { ...catalog } }); }
  function materialize(id) {
    const state = store({ draft: "", attachmentIds: [], phase: "plain" });
    const binding = { sessionId: id, ctx: { id }, session: { sessionId: id } };
    const input = { state, detachedDrafts: new Map(), attachmentFlights: new Map() };
    const record = { binding, state, input, refs: {}, disposed: false }; scopes.set(id, record); return record;
  }
  const sessions = { list, binding: id => scopes.get(id)?.binding, retain(id, { source }) {
    calls.push([id, source]); const record = scopes.get(id) ?? materialize(id);
    record.refs[source] = (record.refs[source] ?? 0) + 1; catalog[id].retainedBy = { ...record.refs }; publish(); let released = false;
    return { ready: Promise.resolve(record.binding), release() {
      if (released) return; released = true; if (record.disposed) return;
      if (--record.refs[source] === 0) delete record.refs[source]; catalog[id].retainedBy = { ...record.refs };
      if (Object.keys(record.refs).length === 0) { record.disposed = true; scopes.delete(id); for (const aid of record.state.getSnapshot().attachmentIds) attachments.delete(aid); } publish();
    } };
  } };
  const conversation = { input: { for(ctx) { const record = scopes.get(ctx.id); if (!record) throw Error("Missing binding"); return record.input; } }, sendSession(session, text, ids, mode, signal) {
    assert.equal(this, conversation); assert.ok(ids.every(id => attachments.has(id)));
    const deferred = Promise.withResolvers(); pendingSends.push({ id: session.sessionId, text, ids, mode, signal, ...deferred }); return deferred.promise;
  } };
  const originalSend = conversation.sendSession;
  let main; function open(id) { const next = sessions.retain(id, { source: "mainView" }); main?.release(); main = next; return scopes.get(id); }
  function set(id, patch) { const s = scopes.get(id).state; s.set({ ...s.getSnapshot(), ...patch }); }
  function add(id, name, bytes = name, kind = "image") { const aid = id + ":" + name; attachments.set(aid, { bytes, kind }); set(id, { attachmentIds: [...scopes.get(id).state.getSnapshot().attachmentIds, aid] }); return aid; }
  function remove(id, aid) { set(id, { attachmentIds: scopes.get(id).state.getSnapshot().attachmentIds.filter(a => a !== aid) }); attachments.delete(aid); }
  function submit(id, textOverride) {
    const record = scopes.get(id); const before = record.state.getSnapshot();
    set(id, { draft: "", attachmentIds: [] });
    const promise = conversation.sendSession(record.binding.session, textOverride ?? before.draft, before.attachmentIds, "queue", undefined);
    promise.then(result => {
      if (record.disposed) return;
      if (result.kind === "success") { before.attachmentIds.forEach(aid => attachments.delete(aid)); }
      else restore();
    }, restore);
    function restore() { if (!record.disposed) set(id, { draft: before.draft, attachmentIds: before.attachmentIds }); }
    return promise;
  }
  open("a"); if (enabled) plugin.apply({ sessions, conversation, effect(fn) { cleanup = fn(); } });
  return { sessions, conversation, originalSend, scopes, attachments, calls, pendingSends, open, set, add, remove, submit, stop: () => cleanup?.() };
}
test("original lifecycle reproduces lost unsent attachment", async () => { const h = setup(false); const aid = h.add("a", "image1"); h.open("b"); assert.equal(h.attachments.has(aid), false); assert.equal(h.scopes.has("a"), false); });
test("A and B keep independent text, ordered image bytes and append after return", async () => {
  const h = setup(); const original = h.scopes.get("a"); h.set("a", { draft: "A text\nsecond line" });
  const a1 = h.add("a", "image1", new Uint8Array([1, 2, 3])); h.open("b");
  h.set("b", { draft: "B text" }); const b1 = h.add("b", "image2"); h.open("a"); const a2 = h.add("a", "image3"); await tick();
  assert.equal(h.scopes.get("a"), original); assert.equal(original.state.getSnapshot().draft, "A text\nsecond line");
  assert.deepEqual(original.state.getSnapshot().attachmentIds, [a1, a2]); assert.deepEqual(h.scopes.get("b").state.getSnapshot().attachmentIds, [b1]);
  assert.deepEqual(h.attachments.get(a1).bytes, new Uint8Array([1, 2, 3]));
  assert.equal(h.scopes.has("unopened"), false); assert.equal(h.calls.filter(([id, src]) => id === "a" && src === "composerDraft").length, 1); h.stop();
});
test("text-only drafts survive navigation", async () => { const h = setup(); h.set("a", { draft: "text only" }); h.open("b"); await tick(); assert.equal(h.scopes.get("a").state.getSnapshot().draft, "text only"); h.stop(); });
test("empty scopes are not pinned; manual attachment removal and clear release pin", async () => {
  const h = setup(); const aid = h.add("a", "image"); h.set("a", { draft: "keep" }); h.remove("a", aid); await tick(); assert.equal(h.sessions.list.getSnapshot().byId.a.retainedBy.composerDraft, 1);
  h.set("a", { draft: "" }); await tick(); assert.equal(h.sessions.list.getSnapshot().byId.a.retainedBy.composerDraft, undefined); h.open("b"); assert.equal(h.scopes.has("a"), false); h.stop();
});
test("file attachment remains alive on navigation", async () => { const h = setup(); const aid = h.add("a", "file", new Uint8Array([5]), "file"); h.open("b"); await tick(); assert.equal(h.attachments.get(aid).kind, "file"); h.stop(); });
for (const text of ["message", ""]) {
  test("successful send then immediate navigation releases draft (text=" + JSON.stringify(text) + ")", async () => {
    const h = setup(); h.set("a", { draft: text }); const aid = h.add("a", "image"); const p = h.submit("a"); h.open("b"); await tick(); assert.equal(h.scopes.has("a"), true);
    h.pendingSends[0].resolve({ kind: "success" }); await p; await tick(); assert.equal(h.scopes.has("a"), false); assert.equal(h.attachments.has(aid), false); h.stop();
  });
  for (const rejected of [false, true]) test("failed send restores after leaving session (text=" + JSON.stringify(text) + ", rejected=" + rejected + ")", async () => {
    const h = setup(); h.set("a", { draft: text }); const aid = h.add("a", "image"); const p = h.submit("a"); h.open("b"); await tick();
    if (rejected) h.pendingSends[0].reject(Error("network")); else h.pendingSends[0].resolve({ kind: "error" });
    await p.catch(() => {}); await tick(); assert.equal(h.scopes.has("a"), true); assert.equal(h.scopes.get("a").state.getSnapshot().draft, text);
    assert.deepEqual(h.scopes.get("a").state.getSnapshot().attachmentIds, [aid]); assert.equal(h.attachments.has(aid), true); h.stop();
  });
}
test("two pending sends retain until both settle without losing a newer draft", async () => {
  const h = setup(); h.set("a", { draft: "first" }); const p1 = h.submit("a"); h.set("a", { draft: "second" }); const p2 = h.submit("a"); h.open("b");
  h.pendingSends[0].resolve({ kind: "success" }); await p1; await tick(); assert.equal(h.scopes.has("a"), true);
  h.set("a", { draft: "newer" }); h.pendingSends[1].resolve({ kind: "success" }); await p2; await tick(); assert.equal(h.scopes.get("a").state.getSnapshot().draft, "newer"); h.stop();
});
test("command admission phases keep the scope then clear releases it", async () => {
  const h = setup(); h.set("a", { phase: "submitting" }); h.open("b"); await tick(); assert.equal(h.scopes.has("a"), true); h.set("a", { phase: "plain" }); await tick(); assert.equal(h.scopes.has("a"), false); h.stop();
});
test("detached reference serialization keeps scope before sendSession starts", async () => {
  const h = setup(); h.set("a", { draft: "reference" }); const aid = h.add("a", "image"); const record = h.scopes.get("a");
  record.input.detachedDrafts.set(1, { draft: "reference", attachmentIds: [aid] });
  h.set("a", { draft: "", attachmentIds: [] }); h.open("b"); await tick();
  assert.equal(h.scopes.has("a"), true);
  record.input.detachedDrafts.delete(1); h.set("a", { draft: "reference", attachmentIds: [aid] }); await tick();
  assert.equal(h.scopes.has("a"), true); assert.equal(h.attachments.has(aid), true); h.stop();
});
test("transparent outer promise wrappers cannot beat failure restoration", async () => {
  const h = setup(); const saved = h.conversation.sendSession;
  h.conversation.sendSession = function (...args) { return saved.apply(this, args).then(x => x).then(x => x); };
  h.set("a", { draft: "restore" }); const aid = h.add("a", "image"); const p = h.submit("a"); h.open("b");
  h.pendingSends[0].resolve({ kind: "error" }); await p; await tick();
  assert.equal(h.scopes.get("a").state.getSnapshot().draft, "restore"); assert.equal(h.attachments.has(aid), true); h.stop();
});
test("disabled wrapper held by an outer plugin only forwards sends", async () => {
  const h = setup(); const saved = h.conversation.sendSession;
  h.conversation.sendSession = function (...args) { return saved.apply(this, args).then(x => x); };
  h.stop(); h.set("a", { draft: "after disable" }); const p = h.submit("a");
  h.pendingSends[0].resolve({ kind: "success" }); await p; await tick();
  assert.equal(h.scopes.get("a").state.listeners.size, 0); assert.equal(h.sessions.list.getSnapshot().byId.a.retainedBy.composerDraft, undefined);
});
test("synchronous retention notifications cannot double-pin", async () => {
  const h = setup(); let once = true;
  const off = h.sessions.list.subscribe(() => { if (once && h.sessions.list.getSnapshot().byId.a.retainedBy.composerDraft > 0) { once = false; h.set("a", { draft: "nested update" }); } });
  h.set("a", { draft: "first update" }); await tick();
  assert.equal(h.sessions.list.getSnapshot().byId.a.retainedBy.composerDraft, 1); h.set("a", { draft: "" }); await tick();
  assert.equal(h.sessions.list.getSnapshot().byId.a.retainedBy.composerDraft, undefined); off(); h.stop();
});
test("plugin teardown during retain does not leak the newly returned reference", async () => {
  const h = setup(); let once = true;
  const off = h.sessions.list.subscribe(() => { if (once && h.sessions.list.getSnapshot().byId.a.retainedBy.composerDraft > 0) { once = false; h.stop(); } });
  h.set("a", { draft: "stop during retain" }); await tick();
  assert.equal(h.sessions.list.getSnapshot().byId.a.retainedBy.composerDraft, undefined); assert.equal(h.scopes.get("a").state.listeners.size, 0); off();
});
test("image-only flight completion releases a pin even after a later task", async () => {
  const h = setup(); const aid = h.add("a", "image"); const record = h.scopes.get("a");
  record.input.attachmentFlights.set(1, { attachmentIds: [aid] }); h.set("a", { attachmentIds: [] }); h.open("b");
  await tick(); assert.equal(h.scopes.has("a"), true);
  h.attachments.delete(aid); record.input.attachmentFlights.delete(1); await tick();
  assert.equal(h.scopes.has("a"), false); h.stop();
});
test("plugin disposal restores method and removes subscriptions and pins", async () => {
  const h = setup(); h.add("a", "image"); const s = h.scopes.get("a").state; h.stop(); await tick();
  assert.equal(h.conversation.sendSession, h.originalSend); assert.equal(h.sessions.list.listeners.size, 0); assert.equal(s.listeners.size, 0); assert.equal(h.sessions.list.getSnapshot().byId.a.retainedBy.composerDraft, undefined);
});
