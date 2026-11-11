import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../electron/store";
import { CalendarService } from "../electron/service";
import { FeishuClient } from "../electron/feishu";
import { eventDraft } from "../src/shared/capture";
import { expandLocalEvents } from "../src/shared/recurrence";

test("Undo survives saves, protects later edits, and restores deleted repeated occurrences", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "feicalendar-history-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  await store.load();
  const service = new CalendarService(store, new FeishuClient("unused"), {
    read: async () => undefined,
    write: async () => {},
    remove: async () => {},
  });
  const draft = {
    ...eventDraft(store.state, "2026-11-11T09:00:00+08:00"),
    title: "组会",
    recurrence: "FREQ=WEEKLY",
  };
  await service.saveEvent({ event: draft });
  const id = store.state.events[0].id;
  const range = { start: "2026-11-01", end: "2026-12-01" };
  const occurrence = expandLocalEvents(store.state.events, range)[1];
  await service.deleteEvent(occurrence.id, "single");
  assert.equal(expandLocalEvents(store.state.events, range).length, 2);
  assert.equal(store.state.trash?.length, 1);
  await service.restoreTrash(store.state.trash![0].id);
  assert.equal(expandLocalEvents(store.state.events, range).length, 3);
  await service.deleteEvent(id, "all");
  await service.undoChange();
  assert.equal(store.state.events[0].id, id);
  assert.equal(store.state.events[0].recurrence, "FREQ=WEEKLY");
  await service.saveEvent({
    event: { ...store.state.events[0], title: "改名" },
    scope: "all",
  });
  store.state.events[0].title = "后续远端修改";
  await assert.rejects(service.undoChange(), /新的修改/);
  assert.equal(store.state.events[0].title, "后续远端修改");
});
