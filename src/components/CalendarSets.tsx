import { useState } from "react";
import type { AppSnapshot } from "../shared/types";

export default function CalendarSets({
  snapshot,
  update,
}: {
  snapshot: AppSnapshot;
  update: (state: AppSnapshot) => void;
}) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const apply = (promise: Promise<AppSnapshot>) =>
    void promise.then(update).catch((error: Error) => setError(error.message));
  return (
    <div className="calendar-sets">
      <select
        aria-label="日历显示组合"
        value=""
        onChange={(event) =>
          apply(window.calendar.applyCalendarSet(event.target.value, false))
        }
      >
        <option value="">日历显示组合</option>
        {snapshot.calendarSets?.map((set) => (
          <option key={set.id} value={set.id}>
            {set.name}
          </option>
        ))}
      </select>
      <button className="text-button" onClick={() => setOpen(!open)}>
        管理
      </button>
      {open && (
        <div className="calendar-set-manager">
          <label>
            将当前勾选保存为组合
            <input
              aria-label="日历组合名称"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
            />
          </label>
          <button
            className="secondary"
            disabled={!name.trim()}
            onClick={() => {
              apply(
                window.calendar.saveCalendarSet({
                  id: "",
                  name,
                  calendarIds: snapshot.calendars
                    .filter((calendar) => calendar.visible)
                    .map((calendar) => calendar.id),
                }),
              );
              setName("");
            }}
          >
            保存组合
          </button>
          {snapshot.calendarSets?.map((set) => (
            <div className="setting-row" key={set.id}>
              <span>{set.name}</span>
              <button
                onClick={() =>
                  apply(window.calendar.applyCalendarSet(set.id, true))
                }
              >
                用于桌面
              </button>
              <button
                onClick={() => apply(window.calendar.deleteCalendarSet(set.id))}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
