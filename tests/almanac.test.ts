import test from "node:test";
import assert from "node:assert/strict";
import {
  almanac,
  isWorkday,
  holiday,
  nextSpecialDate,
  specialEvents,
  validateSpecialDate,
} from "../src/shared/almanac";
import { emptyState } from "../electron/store";
import type { SpecialDate } from "../src/shared/types";

test("Almanac converts lunar festivals and verified workday adjustments", () => {
  assert.ok(almanac("2026-02-17").festival.includes("春节"));
  assert.equal(almanac("2026-04-05").term, "清明");
  assert.equal(holiday("2027-02-05", {})?.name, "春节");
  assert.equal(isWorkday("2026-02-14", {}), true);
  assert.equal(isWorkday("2026-02-16", {}), false);
  assert.equal(
    isWorkday("2026-02-14", {
      holidayOverrides: { "2026-02-14": { name: "学校放假", work: false } },
    }),
    false,
  );
});

test("Lunar anniversary changes solar date annually and leap-day birthdays use the last valid day", () => {
  const item: SpecialDate = {
    id: "birthday",
    title: "生日",
    date: "2026-01-01",
    lunar: true,
    leapMonth: false,
    yearly: true,
    showDesktop: true,
    remindDays: 1,
  };
  assert.equal(nextSpecialDate(item, "2026-01-01"), "2026-02-17");
  assert.equal(nextSpecialDate(item, "2026-02-18"), "2027-02-06");
  assert.equal(
    nextSpecialDate(
      { ...item, lunar: false, date: "2024-02-29" },
      "2027-01-01",
    ),
    "2027-02-28",
  );
  assert.throws(
    () => validateSpecialDate({ ...item, lunar: false, date: "2026-02-30" }),
    /不存在/,
  );
  const state = emptyState();
  state.specialDates = [item];
  const events = specialEvents(state, {
    start: "2026-01-01",
    end: "2027-03-01",
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].reminder, 1440);
  assert.equal(events[1].start, "2027-02-06");
});
