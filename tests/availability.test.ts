import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../electron/store";
import { eventDraft } from "../src/shared/capture";
import { eventConflicts, freeSlots } from "../src/shared/availability";

test("Availability merges overlapping events and buffers, excludes completed entries, and catches adjacent conflicts", () => {
  const state = emptyState();
  state.settings.bufferAfterMinutes = 15;
  state.events = [
    {
      ...eventDraft(
        state,
        "2026-11-11T09:00:00+08:00",
        "2026-11-11T10:00:00+08:00",
      ),
      id: "one",
      title: "one",
    },
    {
      ...eventDraft(
        state,
        "2026-11-11T09:30:00+08:00",
        "2026-11-11T11:00:00+08:00",
      ),
      id: "two",
      title: "two",
    },
    {
      ...eventDraft(
        state,
        "2026-11-11T12:00:00+08:00",
        "2026-11-11T13:00:00+08:00",
      ),
      id: "done",
      title: "done",
      completed: true,
    },
  ];
  const slots = freeSlots(state, {
    from: "2026-11-11",
    to: "2026-11-11",
    startTime: "09:00",
    endTime: "18:00",
    minutes: 30,
    calendarIds: ["local"],
    workdaysOnly: true,
  });
  assert.deepEqual(slots, [
    { start: "2026-11-11T03:15:00.000Z", end: "2026-11-11T10:00:00.000Z" },
  ]);
  const draft = eventDraft(
    state,
    "2026-11-11T08:00:00+08:00",
    "2026-11-11T09:00:00+08:00",
  );
  assert.equal(eventConflicts(state, draft).length, 1);
  assert.equal(
    freeSlots(state, {
      from: "",
      to: "2026-11-11",
      startTime: "09:00",
      endTime: "18:00",
      minutes: 30,
      calendarIds: ["local"],
      workdaysOnly: true,
    }).length,
    0,
  );
});
