import { useState } from "react";
import type { AppSnapshot, Settings } from "../shared/types";
import { inputTime } from "../shared/dates";
import { expandCalendarEvents } from "../shared/occurrences";

export default function ReminderCenter({
  snapshot,
  update,
  configure,
}: {
  snapshot: AppSnapshot;
  update: (state: AppSnapshot) => void;
  configure: (patch: Partial<Settings>) => Promise<void>;
}) {
  const [history, setHistory] = useState(false);
  const [error, setError] = useState("");
  const entries = (snapshot.reminderEntries || [])
    .filter((entry) => history || entry.state !== "dismissed")
    .slice()
    .reverse();
  const act = (promise: Promise<AppSnapshot>) =>
    void promise.then(update).catch((error: Error) => setError(error.message));
  return (
    <section className="reminder-center">
      <h3>提醒中心</h3>
      <label className="setting-row">
        <span>全天日程提醒时间</span>
        <input
          aria-label="全天提醒时间"
          type="time"
          value={snapshot.settings.allDayReminderTime}
          onChange={(event) =>
            void configure({ allDayReminderTime: event.target.value })
          }
        />
      </label>
      <details>
        <summary>各日历提醒开关</summary>
        {snapshot.calendars.map((calendar) => (
          <label className="setting-row" key={calendar.id}>
            <span>{calendar.name}</span>
            <input
              type="checkbox"
              aria-label={`${calendar.name}提醒`}
              checked={
                !snapshot.settings.mutedReminderCalendars.includes(calendar.id)
              }
              onChange={(event) =>
                void configure({
                  mutedReminderCalendars: event.target.checked
                    ? snapshot.settings.mutedReminderCalendars.filter(
                        (id) => id !== calendar.id,
                      )
                    : [
                        ...snapshot.settings.mutedReminderCalendars,
                        calendar.id,
                      ],
                })
              }
            />
          </label>
        ))}
      </details>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={history}
          onChange={(event) => setHistory(event.target.checked)}
        />
        显示已处理提醒
      </label>
      {!entries.length && (
        <p className="muted-text">
          暂无需要处理的提醒。最近 24 小时错过的提醒会在应用恢复运行后汇总。
        </p>
      )}
      {entries.map((entry) => (
        <article className="reminder-card" key={entry.id}>
          <strong>{entry.title}</strong>
          <small>
            {inputTime(entry.eventStart).replace("T", " ")}
            {entry.location && ` · ${entry.location}`}
          </small>
          {entry.state === "snoozed" && (
            <p>
              将于 {inputTime(entry.snoozedUntil!).replace("T", " ")} 再次提醒
            </p>
          )}
          <div className="connection-actions">
            <button
              className="secondary"
              onClick={() => {
                const event = expandCalendarEvents(snapshot, {
                  start: new Date(
                    new Date(entry.eventStart).getTime() - 86400_000,
                  ).toISOString(),
                  end: new Date(
                    new Date(entry.eventStart).getTime() + 86400_000,
                  ).toISOString(),
                }).find((event) => event.id === entry.eventId);
                if (event) void window.calendar.navigate({ event });
                else setError("日程已删除或已超出缓存范围");
              }}
            >
              查看日程
            </button>
            {entry.state !== "dismissed" && (
              <>
                <button
                  onClick={() =>
                    act(window.calendar.reminderAction(entry.id, "snooze5"))
                  }
                >
                  稍后 5 分钟
                </button>
                <button
                  onClick={() =>
                    act(window.calendar.reminderAction(entry.id, "snooze15"))
                  }
                >
                  稍后 15 分钟
                </button>
                <button
                  onClick={() =>
                    act(window.calendar.reminderAction(entry.id, "dismiss"))
                  }
                >
                  已处理
                </button>
              </>
            )}
          </div>
        </article>
      ))}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
