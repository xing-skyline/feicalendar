import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../electron/store";
import { eventDraft } from "../src/shared/capture";
import { scanReminders } from "../electron/reminders";

test("Reminder scan catches missed times, deduplicates across restarts, and snoozes persist", () => {
  const state = emptyState();
  const now = new Date("2026-11-11T10:00:00+08:00").getTime();
  state.events = [
    {
      ...eventDraft(state, "2026-11-11T10:00:00+08:00"),
      id: "a",
      title: "会议",
      reminder: 10,
    },
  ];
  state.reminderCheckedAt = new Date(now - 30 * 60_000).toISOString();
  state.reminderRules = { a: [15, 5] };
  const entries = scanReminders(state, now);
  assert.equal(entries.length, 2);
  assert.equal(
    scanReminders(JSON.parse(JSON.stringify(state)), now + 60_000).length,
    0,
  );
  entries[0].state = "snoozed";
  entries[0].snoozedUntil = new Date(now + 5 * 60_000).toISOString();
  assert.equal(scanReminders(state, now + 4 * 60_000).length, 0);
  assert.equal(scanReminders(state, now + 5 * 60_000).length, 1);
  assert.equal(scanReminders(state, now + 6 * 60_000).length, 0);
});

test("All-day reminders respect local clock, calendar mute, readonly override and canceled events", () => {
  const state = emptyState();
  const now = new Date("2026-11-11T09:00:00+08:00").getTime();
  state.events = [
    {
      ...eventDraft(state, "2026-11-11", "2026-11-12", true),
      id: "a",
      reminder: -1,
    },
  ];
  state.reminderRules = { a: [0] };
  state.settings.mutedReminderCalendars = ["local"];
  assert.equal(scanReminders(state, now - 1000).length, 0);
  state.settings.mutedReminderCalendars = [];
  assert.equal(scanReminders(state, now).length, 1);
  state.events[0].deleted = true;
  scanReminders(state, now + 1000);
  assert.equal(state.reminderEntries?.[0].state, "dismissed");
});
