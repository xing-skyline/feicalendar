import { useMemo, useState } from "react";
import type { AppSnapshot, CalendarEvent } from "../shared/types";
import { dateKey, inputTime, shiftDate } from "../shared/dates";
import { freeSlots } from "../shared/availability";
import { eventDraft } from "../shared/capture";

export default function Availability({
  snapshot,
  update,
  onEdit,
}: {
  snapshot: AppSnapshot;
  update: (value: AppSnapshot) => void;
  onEdit: (event: CalendarEvent) => void;
}) {
  const [options, setOptions] = useState({
    from: dateKey(new Date()),
    to: shiftDate(dateKey(new Date()), 6),
    startTime: "09:00",
    endTime: "18:00",
    minutes: 30,
    calendarIds: snapshot.calendars
      .filter((calendar) => calendar.visible)
      .map((calendar) => calendar.id),
    workdaysOnly: true,
  });
  const [before, setBefore] = useState(snapshot.settings.bufferBeforeMinutes);
  const [after, setAfter] = useState(snapshot.settings.bufferAfterMinutes);
  const [error, setError] = useState("");
  const slots = useMemo(
    () => freeSlots(snapshot, options),
    [snapshot, options],
  );
  const valid =
    options.from &&
    options.to &&
    options.from <= options.to &&
    new Date(options.to).getTime() - new Date(options.from).getTime() <=
      60 * 86400_000 &&
    options.startTime < options.endTime;
  return (
    <section>
      <h3>查找空闲时间</h3>
      <p className="muted-text">
        根据所选日历已同步到本机的日程计算。全天日程占用整天，已完成日程和纪念日不占用时间。
      </p>
      <div className="form-grid">
        <label>
          从
          <input
            type="date"
            value={options.from}
            onChange={(event) =>
              setOptions({ ...options, from: event.target.value })
            }
          />
        </label>
        <label>
          到
          <input
            type="date"
            value={options.to}
            onChange={(event) =>
              setOptions({ ...options, to: event.target.value })
            }
          />
        </label>
        <label>
          每日开始
          <input
            type="time"
            value={options.startTime}
            onChange={(event) =>
              setOptions({ ...options, startTime: event.target.value })
            }
          />
        </label>
        <label>
          每日结束
          <input
            type="time"
            value={options.endTime}
            onChange={(event) =>
              setOptions({ ...options, endTime: event.target.value })
            }
          />
        </label>
        <label>
          至少空闲分钟
          <input
            type="number"
            min={5}
            max={1440}
            value={options.minutes}
            onChange={(event) =>
              setOptions({ ...options, minutes: Number(event.target.value) })
            }
          />
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={options.workdaysOnly}
            onChange={(event) =>
              setOptions({ ...options, workdaysOnly: event.target.checked })
            }
          />
          仅工作日（含调休）
        </label>
      </div>
      <div className="calendar-checks">
        {snapshot.calendars
          .filter((calendar) => calendar.id !== "special-dates")
          .map((calendar) => (
            <label key={calendar.id}>
              <input
                type="checkbox"
                checked={options.calendarIds.includes(calendar.id)}
                onChange={(event) =>
                  setOptions({
                    ...options,
                    calendarIds: event.target.checked
                      ? [...options.calendarIds, calendar.id]
                      : options.calendarIds.filter((id) => id !== calendar.id),
                  })
                }
              />
              {calendar.name}
            </label>
          ))}
      </div>
      <details>
        <summary>会议前后缓冲</summary>
        <div className="form-grid">
          <label>
            提前预留分钟
            <input
              type="number"
              min={0}
              max={180}
              value={before}
              onChange={(event) => setBefore(Number(event.target.value))}
            />
          </label>
          <label>
            结束后预留分钟
            <input
              type="number"
              min={0}
              max={180}
              value={after}
              onChange={(event) => setAfter(Number(event.target.value))}
            />
          </label>
        </div>
        <button
          className="secondary"
          onClick={() =>
            void window.calendar
              .settings({
                bufferBeforeMinutes: before,
                bufferAfterMinutes: after,
              })
              .then(update)
              .catch((error: Error) => setError(error.message))
          }
        >
          保存缓冲设置
        </button>
        <p className="muted-text">
          缓冲时间参与冲突提示和空闲计算，日程保留原定起止时间。
        </p>
      </details>
      {!valid && (
        <p className="error-text">
          请选择 60 天以内的日期范围和有效的每日时间段。
        </p>
      )}
      {valid && (
        <div className="tools-results">
          {slots.length ? (
            slots.map((slot) => (
              <div className="tools-event" key={slot.start}>
                <span>
                  {inputTime(slot.start).replace("T", " ")}–
                  {inputTime(slot.end).slice(11)}
                </span>
                <button
                  className="secondary"
                  onClick={() =>
                    onEdit(
                      eventDraft(
                        snapshot,
                        slot.start,
                        new Date(
                          new Date(slot.start).getTime() +
                            options.minutes * 60_000,
                        ).toISOString(),
                      ),
                    )
                  }
                >
                  安排 {options.minutes} 分钟
                </button>
              </div>
            ))
          ) : (
            <p className="muted-text">当前条件下没有满足时长的空闲时间。</p>
          )}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
