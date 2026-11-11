import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../electron/store";
import { eventDraft, parseCapture, templateDraft } from "../src/shared/capture";

const now = new Date("2026-11-11T10:00:00+08:00");
const base = eventDraft(emptyState(), now.toISOString());

test("Chinese quick capture parses relative weeks, afternoon, duration and all-day", () => {
  const event = parseCapture("下周三下午两点开组会，持续一小时", base, now);
  assert.equal(event.title, "开组会");
  assert.equal(event.start, "2026-11-18T14:00:00+08:00");
  assert.equal(event.end, "2026-11-18T07:00:00.000Z");
  assert.equal(
    parseCapture("明天上午十点半答辩，持续半小时", base, now).start,
    "2026-11-12T10:30:00+08:00",
  );
  const day = parseCapture("后天全天出差", base, now);
  assert.equal(day.start, "2026-11-13");
  assert.equal(day.end, "2026-11-14");
  assert.equal(day.title, "出差");
});

test("Quick capture validates invalid dates and clock input", () => {
  assert.throws(
    () => parseCapture("2026-02-30下午2点会议", base, now),
    /日期不存在/,
  );
  assert.throws(() => parseCapture("明天25:30会议", base, now), /有效的小时/);
  assert.equal(
    parseCapture("2026/12/3 09:15 评审", base, now).start,
    "2026-12-03T09:15:00+08:00",
  );
});

test("Templates keep the chosen date and do not reuse existing event identity", () => {
  const result = templateDraft(
    {
      id: "template",
      name: "组会",
      title: "小组例会",
      calendarId: "local",
      durationMinutes: 90,
      allDay: false,
      location: "301",
      description: "议程",
      reminder: 30,
      recurrence: "",
    },
    base,
  );
  assert.equal(result.id, "");
  assert.equal(result.title, "小组例会");
  assert.equal(result.end, "2026-11-11T03:30:00.000Z");
});
