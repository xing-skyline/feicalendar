import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type {
  AppSnapshot,
  BulkEventAction,
  CalendarEvent,
  ImportPreview,
  PrintOptions,
} from "../shared/types";
import { dateKey, inputTime, shiftDate } from "../shared/dates";
import { expandCalendarEvents } from "../shared/occurrences";
import { calendarPrintHtml } from "../shared/print";
import Availability from "./Availability";

export default function CalendarTools({
  snapshot,
  update,
  onEdit,
  onClose,
  initialDate,
}: {
  snapshot: AppSnapshot;
  update: (state: AppSnapshot) => void;
  onEdit: (event: CalendarEvent) => void;
  onClose: () => void;
  initialDate: string;
}) {
  const [tab, setTab] = useState("search");
  const [from, setFrom] = useState(shiftDate(initialDate, -30));
  const [to, setTo] = useState(shiftDate(initialDate, 90));
  const [query, setQuery] = useState("");
  const [calendarFilter, setCalendarFilter] = useState("");
  const [status, setStatus] = useState("");
  const [location, setLocation] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<BulkEventAction["action"]>("copy");
  const [target, setTarget] = useState(snapshot.settings.defaultCalendarId);
  const [reminder, setReminder] = useState(15);
  const [preview, setPreview] = useState<ImportPreview>();
  const [importIds, setImportIds] = useState<string[]>([]);
  const [printOptions, setPrintOptions] = useState<PrintOptions>({
    date: initialDate,
    view: "week",
    calendarIds: snapshot.calendars
      .filter((calendar) => calendar.visible)
      .map((calendar) => calendar.id),
    details: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const validRange = Boolean(
    from &&
      to &&
      from <= to &&
      new Date(to).getTime() - new Date(from).getTime() < 400 * 86400_000,
  );
  const results = useMemo(
    () =>
      validRange
        ? expandCalendarEvents(snapshot, { start: from, end: shiftDate(to, 1) })
            .filter(
              (event) =>
                (!calendarFilter || event.calendarId === calendarFilter) &&
                `${event.title} ${event.description}`
                  .toLowerCase()
                  .includes(query.toLowerCase()) &&
                event.location.toLowerCase().includes(location.toLowerCase()) &&
                (!status ||
                  (status === "completed"
                    ? event.completed
                    : status === "open"
                      ? !event.completed
                      : event.syncState === status)),
            )
            .sort((a, b) => a.start.localeCompare(b.start))
        : [],
    [snapshot, from, to, query, location, calendarFilter, status, validRange],
  );
  const selectedIds = selected.filter((id) =>
    results.some(
      (event) => event.id === id && event.calendarId !== "special-dates",
    ),
  );
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (ids: string[], id: string, checked: boolean) =>
    checked ? [...new Set([...ids, id])] : ids.filter((item) => item !== id);
  const writableOptions = snapshot.calendars
    .filter((calendar) => calendar.writable)
    .map((calendar) => (
      <option key={calendar.id} value={calendar.id}>
        {calendar.name}
      </option>
    ));
  const rangeControls = (
    <div className="form-grid">
      <label>
        开始日期
        <input
          aria-label="工具开始日期"
          type="date"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            setPreview(undefined);
          }}
        />
      </label>
      <label>
        结束日期
        <input
          aria-label="工具结束日期"
          type="date"
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
            setPreview(undefined);
          }}
        />
      </label>
      {!validRange && (
        <p className="error-text">请选择 400 天以内的有效日期范围。</p>
      )}
    </div>
  );
  return (
    <div className="modal-backdrop">
      <section
        className="modal calendar-tools"
        role="dialog"
        aria-modal="true"
        aria-label="日历工具"
      >
        <header className="modal-heading">
          <h2>日历工具</h2>
          <button
            className="icon-button"
            aria-label="关闭日历工具"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <nav className="tool-tabs">
          {[
            ["search", "搜索与批量操作"],
            ["availability", "查找空闲"],
            ["import", "导入 ICS"],
            ["print", "打印与 PDF"],
          ].map(([key, title]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(key);
                setError("");
                setNotice("");
              }}
            >
              {title}
            </button>
          ))}
        </nav>
        <div className="tools-body">
          {tab === "availability" && (
            <Availability snapshot={snapshot} update={update} onEdit={onEdit} />
          )}
          {tab === "search" && (
            <>
              {rangeControls}
              <div className="form-grid">
                <label>
                  关键词
                  <input
                    aria-label="高级搜索关键词"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <label>
                  地点
                  <input
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                  />
                </label>
                <label>
                  日历
                  <select
                    value={calendarFilter}
                    onChange={(event) => setCalendarFilter(event.target.value)}
                  >
                    <option value="">全部日历</option>
                    {snapshot.calendars.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  状态
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    <option value="">全部状态</option>
                    <option value="open">未完成</option>
                    <option value="completed">已完成</option>
                    <option value="pending">待同步</option>
                    <option value="error">同步错误</option>
                    <option value="conflict">同步冲突</option>
                  </select>
                </label>
              </div>
              <div className="batch-controls">
                <label>
                  <input
                    type="checkbox"
                    checked={
                      results.some(
                        (event) => event.calendarId !== "special-dates",
                      ) &&
                      selectedIds.length ===
                        results.filter(
                          (event) => event.calendarId !== "special-dates",
                        ).length
                    }
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? results
                              .filter(
                                (item) => item.calendarId !== "special-dates",
                              )
                              .map((item) => item.id)
                          : [],
                      )
                    }
                  />
                  全选
                </label>
                <span>
                  {results.length} 项，已选 {selectedIds.length} 项
                </span>
                <select
                  aria-label="批量操作类型"
                  value={action}
                  onChange={(event) =>
                    setAction(event.target.value as typeof action)
                  }
                >
                  <option value="copy">复制到日历</option>
                  <option value="move">移动到日历</option>
                  <option value="reminder">设置本机提醒</option>
                  <option value="complete">标为完成</option>
                  <option value="delete">删除</option>
                </select>
                {["copy", "move"].includes(action) && (
                  <select
                    aria-label="批量目标日历"
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                  >
                    {writableOptions}
                  </select>
                )}
                {action === "reminder" && (
                  <select
                    value={reminder}
                    onChange={(event) =>
                      setReminder(Number(event.target.value))
                    }
                  >
                    {[-1, 0, 5, 15, 30, 60, 1440].map((value) => (
                      <option key={value} value={value}>
                        {value < 0 ? "关闭提醒" : `提前 ${value} 分钟`}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="primary"
                  disabled={
                    busy || !selectedIds.length || selectedIds.length > 2000
                  }
                  onClick={() =>
                    void perform(async () => {
                      update(
                        await window.calendar.bulkEvents({
                          operationId: crypto.randomUUID(),
                          ids: selectedIds,
                          action,
                          calendarId: target,
                          reminder,
                        }),
                      );
                      setSelected([]);
                      setNotice("批量操作已保存。");
                    })
                  }
                >
                  执行 {selectedIds.length} 项
                </button>
              </div>
              <p className="muted-text">
                重复日程按当前范围内选中的日期操作，复制和移动生成独立日程。本机提醒可用于只读来源。每次最多处理
                2000 项。
              </p>
              <div className="tools-results">
                {results.map((event) => (
                  <div className="tools-event" key={event.id}>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${event.title} ${dateKey(event.start)}`}
                      disabled={event.calendarId === "special-dates"}
                      checked={selectedIds.includes(event.id)}
                      onChange={(input) =>
                        setSelected(
                          toggle(selected, event.id, input.target.checked),
                        )
                      }
                    />
                    <button onClick={() => onEdit(event)}>
                      <b>{event.title}</b>
                      <small>
                        {inputTime(event.start).replace("T", " ")} ·{" "}
                        {
                          snapshot.calendars.find(
                            (calendar) => calendar.id === event.calendarId,
                          )?.name
                        }{" "}
                        {event.location}
                      </small>
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === "import" && (
            <>
              <p className="muted-text">
                选择日期范围和目标日历后预览文件。重复日程按所选范围展开为独立日程，保留时区、例外日期和单次修改。相同标题、时间和目标日历的已有记录自动跳过。
              </p>
              {rangeControls}
              <label>
                导入目标日历
                <select
                  value={target}
                  onChange={(event) => {
                    setTarget(event.target.value);
                    setPreview(undefined);
                  }}
                >
                  {writableOptions}
                </select>
              </label>
              <button
                className="secondary"
                disabled={busy || !validRange}
                onClick={() =>
                  void perform(async () => {
                    const result = await window.calendar.importPreview(target, {
                      start: `${from}T00:00:00+08:00`,
                      end: `${shiftDate(to, 1)}T00:00:00+08:00`,
                    });
                    if (result) {
                      setPreview(result);
                      setImportIds(
                        result.events
                          .filter((item) => !item.duplicate)
                          .map((item) => item.event.id),
                      );
                    }
                  })
                }
              >
                选择 ICS 并预览
              </button>
              {preview && (
                <>
                  <div className="batch-controls">
                    <label>
                      <input
                        type="checkbox"
                        checked={
                          importIds.length > 0 &&
                          importIds.length ===
                            preview.events.filter((item) => !item.duplicate)
                              .length
                        }
                        onChange={(event) =>
                          setImportIds(
                            event.target.checked
                              ? preview.events
                                  .filter((item) => !item.duplicate)
                                  .map((item) => item.event.id)
                              : [],
                          )
                        }
                      />
                      选择可导入项
                    </label>
                    <span>
                      {preview.events.length} 项，重复{" "}
                      {preview.events.filter((item) => item.duplicate).length}{" "}
                      项
                    </span>
                    <button
                      className="primary"
                      disabled={busy || !importIds.length}
                      onClick={() =>
                        void perform(async () => {
                          update(
                            await window.calendar.importApply(
                              preview.token,
                              importIds,
                            ),
                          );
                          setPreview(undefined);
                          setImportIds([]);
                          setNotice("导入完成，云端日历将在下次同步时写入。");
                        })
                      }
                    >
                      导入选中 {importIds.length} 项
                    </button>
                  </div>
                  <div className="tools-results">
                    {preview.events.map(({ event, duplicate }) => (
                      <label className="tools-event" key={event.id}>
                        <input
                          type="checkbox"
                          checked={importIds.includes(event.id)}
                          disabled={duplicate}
                          onChange={(input) =>
                            setImportIds(
                              toggle(importIds, event.id, input.target.checked),
                            )
                          }
                        />
                        <span>
                          {event.title}
                          <small>
                            {inputTime(event.start).replace("T", " ")}
                            {duplicate && " · 重复，跳过"}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {tab === "print" && (
            <>
              <div className="form-grid">
                <label>
                  日期
                  <input
                    type="date"
                    value={printOptions.date}
                    required
                    onChange={(event) =>
                      event.target.value &&
                      setPrintOptions({
                        ...printOptions,
                        date: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  版式
                  <select
                    value={printOptions.view}
                    onChange={(event) =>
                      setPrintOptions({
                        ...printOptions,
                        view: event.target.value as PrintOptions["view"],
                      })
                    }
                  >
                    <option value="week">周历</option>
                    <option value="month">月历</option>
                    <option value="course">课程周表</option>
                  </select>
                </label>
              </div>
              <div className="calendar-checks">
                {snapshot.calendars.map((calendar) => (
                  <label key={calendar.id}>
                    <input
                      type="checkbox"
                      checked={printOptions.calendarIds.includes(calendar.id)}
                      onChange={(event) =>
                        setPrintOptions({
                          ...printOptions,
                          calendarIds: toggle(
                            printOptions.calendarIds,
                            calendar.id,
                            event.target.checked,
                          ),
                        })
                      }
                    />
                    {calendar.name}
                  </label>
                ))}
              </div>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={printOptions.details}
                  onChange={(event) =>
                    setPrintOptions({
                      ...printOptions,
                      details: event.target.checked,
                    })
                  }
                />
                包含地点和描述
              </label>
              <div className="connection-actions">
                {[true, false].map((pdf) => (
                  <button
                    key={String(pdf)}
                    className="secondary"
                    disabled={busy || !printOptions.calendarIds.length}
                    onClick={() =>
                      void perform(async () => {
                        const file = await window.calendar.printCalendar(
                          printOptions,
                          pdf,
                        );
                        if (file) setNotice(file);
                      })
                    }
                  >
                    {pdf ? "保存 PDF" : "打印"}
                  </button>
                ))}
              </div>
              <iframe
                title="日历打印预览"
                className="print-preview"
                sandbox=""
                srcDoc={calendarPrintHtml(snapshot, printOptions)}
              />
            </>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="success-text" role="status">
              {notice}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
