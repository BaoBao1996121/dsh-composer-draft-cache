window.__ModuleLoader__.load({
  id: "dsh-composer-draft-cache",
  factory: () => {
    const SOURCE = "composerDraft";
    function apply(ctx) {
      const sessions = ctx.sessions;
      const conversation = ctx.conversation;
      ctx.effect(() => {
        let active = true;
        let reconciling = false;
        let reconcileAgain = false;
        let releaseTimer;
        const records = new Map();
        const pending = new Map();
        const originalSend = conversation.sendSession;

        function hasDraft(record) {
          const state = record.input.state.getSnapshot();
          return state.draft !== "" || state.attachmentIds.length > 0 ||
            state.phase === "adjudicating" || state.phase === "submitting" ||
            // rc.2 shells detach drafts before asynchronous reference serialization.
            (record.input.detachedDrafts?.size ?? 0) > 0 ||
            (record.input.attachmentFlights?.size ?? 0) > 0 ||
            (pending.get(record.id) ?? 0) > 0;
        }
        function pin(record) {
          if (!active || record.reference || record.pinning || !hasDraft(record)) return;
          // retain publishes synchronously. Protect against re-entry and teardown during it.
          record.pinning = true;
          try {
            const reference = sessions.retain(record.id, { source: SOURCE });
            reference.ready.catch(() => {});
            if (!active || records.get(record.id) !== record || sessions.binding(record.id) !== record.binding) reference.release();
            else record.reference = reference;
          } finally {
            record.pinning = false;
          }
        }
        function queueRelease() {
          if (!active || releaseTimer !== undefined) return;
          // Let shell restoration and other plugins' promise wrappers settle first.
          releaseTimer = setTimeout(() => {
            releaseTimer = undefined;
            if (!active) return;
            for (const record of records.values()) {
              if (!record.reference || hasDraft(record)) continue;
              const reference = record.reference;
              record.reference = undefined;
              reference.release();
            }
          }, 0);
        }
        function changed(record) {
          if (!active || sessions.binding(record.id) !== record.binding) return;
          pin(record);
          queueRelease();
        }
        function watch(binding) {
          const id = binding.sessionId;
          const existing = records.get(id);
          if (existing?.binding === binding) return existing;
          if (existing) forget(existing);
          const input = conversation.input.for(binding.ctx);
          const record = { id, binding, input, reference: undefined, off: () => {} };
          records.set(id, record);
          const flights = input.attachmentFlights;
          const deleteFlight = flights?.delete;
          const hadOwnDelete = flights && Object.hasOwn(flights, "delete");
          const flightSettled = function (key) {
            const removed = deleteFlight.call(this, key);
            if (removed) queueRelease();
            return removed;
          };
          if (flights && typeof deleteFlight === "function") flights.delete = flightSettled;
          let offState = () => {};
          record.off = () => {
            offState();
            if (flights?.delete === flightSettled) {
              if (hadOwnDelete) flights.delete = deleteFlight;
              else delete flights.delete;
            }
          };
          try {
            offState = input.state.subscribe(() => changed(record));
            changed(record);
            return record;
          } catch (error) {
            forget(record);
            throw error;
          }
        }
        function forget(record) {
          records.delete(record.id);
          record.off();
          const reference = record.reference;
          record.reference = undefined;
          reference?.release();
        }
        function reconcile() {
          if (!active) return;
          if (reconciling) { reconcileAgain = true; return; }
          reconciling = true;
          try {
            do {
              reconcileAgain = false;
            for (const record of records.values()) {
              if (sessions.binding(record.id) !== record.binding) forget(record);
            }
            for (const row of Object.values(sessions.list.getSnapshot().byId)) {
              // Borrow only UI-owned scopes, never open every catalogued session.
              if (!(row.retainedBy.mainView > 0)) continue;
              const binding = sessions.binding(row.id);
              if (binding) watch(binding);
            }
            } while (active && reconcileAgain);
          } finally {
            reconciling = false;
          }
        }
        async function sendSession(session, ...args) {
          // An outer plugin may still hold this wrapper after this plugin is disabled.
          if (!active) return originalSend.call(this, session, ...args);
          const id = session.sessionId;
          pending.set(id, (pending.get(id) ?? 0) + 1);
          try {
            try {
              const binding = sessions.binding(id);
              const record = binding ? watch(binding) : undefined;
              if (record) changed(record);
            } catch {
              ctx.logger?.warn?.("composer-draft-cache: could not retain this submission scope");
            }
            return await originalSend.call(this, session, ...args);
          } finally {
            if (active) {
              const count = (pending.get(id) ?? 1) - 1;
              if (count === 0) pending.delete(id);
              else pending.set(id, count);
              queueRelease();
            }
          }
        }
        let offList = () => {};
        const dispose = () => {
          active = false;
          clearTimeout(releaseTimer);
          offList();
          if (conversation.sendSession === sendSession) conversation.sendSession = originalSend;
          for (const record of [...records.values()]) forget(record);
          pending.clear();
        };
        try {
          conversation.sendSession = sendSession;
          offList = sessions.list.subscribe(reconcile);
          reconcile();
          return dispose;
        } catch (error) {
          dispose();
          throw error;
        }
      }, "session-drafts: retain unsent composer scopes");
    }
    return { name: "dsh-composer-draft-cache", inject: ["sessions", "conversation"], apply };
  }
});
