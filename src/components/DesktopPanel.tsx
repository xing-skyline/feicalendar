import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Grip,
  List,
  Plus,
  Settings,
  X,
} from "lucide-react";
import type { AppSnapshot, CalendarEvent } from "../shared/types";
import {
  dateKey,
  inputTime,
  shiftDate,
  teachingWeek,
  TIME_ZONE,
} from "../shared/dates";
import { expandCalendarEvents } from "../shared/occurrences";
import DayLabel from "./DayLabel";
import { nextSpecialDate, daysUntil } from "../shared/almanac";
import EventEditor from "./EventEditor";
import { eventDraft } from "../shared/capture";
import { meetingLink } from "../shared/meetings";

function eventsOn(events: CalendarEvent[], day: string) {
  return events.filter((event) =>
    event.allDay
      ? event.start <= day && event.end > day
      : new Date(event.start).getTime() <
          new Date(`${shiftDate(day, 1)}T00:00:00+08:00`).getTime() &&
        new Date(event.end).getTime() >
          new Date(`${day}T00:00:00+08:00`).getTime(),
  );
}

export default function DesktopPanel() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [today, setToday] = useState(dateKey(new Date()));
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(`${today.slice(0, 7)}-01`);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<CalendarEvent>();
  const [clock, setClock] = useState(Date.now());
  const [systemDark, setSystemDark] = useState(
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    document.documentElement.dataset.surface = "desktop";
    void window.calendar
      .snapshot()
      .then(setSnapshot)
      .catch((err: Error) => setError(err.message));
    const unsubscribe = window.calendar.onChanged(setSnapshot);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    const timer = setInterval(() => {
      setClock(Date.now());
      const next = dateKey(new Date());
      setToday((previous) => {
        if (previous !== next) {
          setSelected((value) => (value === previous ? next : value));
          setMonth((value) =>
            value.slice(0, 7) === previous.slice(0, 7)
              ? `${next.slice(0, 7)}-01`
              : value,
          );
        }
        return next;
      });
    }, 30_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
      media.removeEventListener("change", update);
    };
  }, []);
  const settings = snapshot?.settings;
  const dark =
    settings?.desktopTheme === "dark" ||
    (settings?.desktopTheme === "system" && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  const start = shiftDate(
    month,
    -(
      (new Date(`${month}T00:00:00Z`).getUTCDay() -
        (settings?.weekStartsOn ?? 1) +
        7) %
      7
    ),
  );
  const enabledConnections = snapshot?.connections
    .filter((item) => item.enabled !== false)
    .map((item) => item.id)
    .join(",");
  useEffect(() => {
    if (!snapshot) return;
    const rangeStart = settings?.desktopView === "agenda" ? selected : start;
    const rangeEnd = shiftDate(
      rangeStart,
      settings?.desktopView === "agenda" ? 15 : 43,
    );
    const timer = setTimeout(() => {
      void window.calendar
        .desktopRange({
          start: `${rangeStart}T00:00:00+08:00`,
          end: `${rangeEnd}T00:00:00+08:00`,
        })
        .catch((err: Error) => setError(err.message));
    }, 600);
    return () => clearTimeout(timer);
  }, [
    start,
    selected,
    settings?.desktopView,
    settings?.autoSync,
    settings?.feishuEnabled,
    enabledConnections,
  ]);
  const dates = Array.from({ length: 42 }, (_, index) =>
    shiftDate(start, index),
  );
  const events = useMemo(() => {
    if (!snapshot) return [];
    const visible = new Set(
      snapshot.settings.desktopCalendarIds ??
        snapshot.calendars
          .filter((item) => item.visible)
          .map((item) => item.id),
    );
    const end = shiftDate(start, 43);
    return expandCalendarEvents(snapshot, { start: shiftDate(start, -1), end })
      .filter((item) => visible.has(item.calendarId))
      .sort(
        (left, right) =>
          Number(right.allDay) - Number(left.allDay) ||
          left.start.localeCompare(right.start),
      );
  }, [snapshot, start]);
  const selectedEvents = eventsOn(events, selected);
  const listDays = Array.from({ length: 14 }, (_, index) =>
    shiftDate(selected, index),
  );
  const agendaEvents = useMemo(() => {
    if (!snapshot) return [];
    const visible = new Set(
      snapshot.settings.desktopCalendarIds ??
        snapshot.calendars
          .filter((item) => item.visible)
          .map((item) => item.id),
    );
    return expandCalendarEvents(snapshot, {
      start: shiftDate(selected, -1),
      end: shiftDate(selected, 15),
    })
      .filter((item) => visible.has(item.calendarId))
      .sort(
        (left, right) =>
          Number(right.allDay) - Number(left.allDay) ||
          left.start.localeCompare(right.start),
      );
  }, [snapshot, selected]);
  const act = (promise: Promise<unknown>) => {
    void promise.catch((err: Error) => setError(err.message));
  };
  const add = (day: string) => {
    if (snapshot) setEditor(eventDraft(snapshot, `${day}T09:00:00+08:00`));
  };
  const upcoming = agendaEvents
    .filter(
      (event) =>
        !event.allDay &&
        !event.completed &&
        new Date(event.start).getTime() > clock,
    )
    .sort((left, right) => left.start.localeCompare(right.start))[0];
  const dropOn = (id: string, day: string) => {
    const event = events.find((item) => item.id === id);
    if (
      !event ||
      !snapshot?.calendars.find((calendar) => calendar.id === event.calendarId)
        ?.writable
    )
      return;
    const start = event.allDay
      ? day
      : `${day}T${inputTime(event.start).slice(11)}:00+08:00`;
    const end = new Date(
      new Date(start).getTime() +
        new Date(event.end).getTime() -
        new Date(event.start).getTime(),
    );
    const changed = {
      ...event,
      start,
      end: event.allDay ? end.toISOString().slice(0, 10) : end.toISOString(),
    };
    if (event.recurring || event.recurrence) setEditor(changed);
    else act(window.calendar.saveEvent({ event: changed }));
  };
  const move = (event: PointerEvent<HTMLElement>, resize = false) => {
    if (
      event.button !== 0 ||
      settings?.desktopLocked ||
      (event.target as HTMLElement).closest("button")
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    act(window.calendar.desktop(resize ? "resize" : "move"));
  };
  const stop = () => act(window.calendar.desktop("stop"));
  const changeMonth = (offset: number) => {
    const next = new Date(`${month}T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + offset);
    const day = next.toISOString().slice(0, 10);
    setMonth(day);
    setSelected(day);
  };
  const week = (day: string) =>
    settings
      ? teachingWeek(
          day,
          settings.teachingStartDate,
          settings.teachingWeeks,
          settings.weekStartsOn,
        )
      : null;
  const dayHeading = (day: string) =>
    new Intl.DateTimeFormat("zh-CN", {
      month: "long",
      day: "numeric",
      weekday: "short",
      timeZone: TIME_ZONE,
    }).format(new Date(day));
  const renderEvent = (event: CalendarEvent) => {
    const calendar = snapshot?.calendars.find(
      (item) => item.id === event.calendarId,
    );
    return (
      <div className="desktop-event-row" key={event.id}>
        <input
          type="checkbox"
          aria-label={`完成 ${event.title}`}
          checked={event.completed}
          disabled={!calendar?.writable}
          onChange={(change) =>
            act(
              window.calendar.saveEvent({
                event: { ...event, completed: change.target.checked },
                scope:
                  event.recurring || event.recurrence ? "single" : undefined,
              }),
            )
          }
        />
        <button
          className={`desktop-event ${event.completed ? "completed" : ""}`}
          onClick={() => setEditor(event)}
          draggable={calendar?.writable}
          onDragStart={(drag) =>
            drag.dataTransfer.setData(
              "application/x-feicalendar-event",
              event.id,
            )
          }
          style={{ "--event-color": calendar?.color } as CSSProperties}
        >
          <span className="desktop-event-line" />
          <span>
            <b>{event.title}</b>
            <small>
              {event.allDay
                ? "全天"
                : `${inputTime(event.start).slice(11)}–${inputTime(event.end).slice(11)}`}
              {event.location ? ` · ${event.location}` : ""}
            </small>
          </span>
          <i title={calendar?.name}>{calendar?.name}</i>
        </button>
      </div>
    );
  };
  const color = settings?.desktopColor || "#5474ee";
  const rgb = [1, 3, 5].map((index) =>
    parseInt(color.slice(index, index + 2), 16),
  );
  return (
    <main
      className={`desktop-panel ${dark ? "dark" : "light"} ${settings?.desktopView === "grid" ? "desktop-large" : ""}`}
      style={
        {
          "--panel-accent": color,
          "--panel-rgb": rgb.join(","),
          "--panel-base": (dark ? [25, 30, 43] : [250, 251, 255])
            .map((base, index) => Math.round(base * 0.94 + rgb[index] * 0.06))
            .join(","),
          "--panel-opacity": (settings?.desktopOpacity ?? 88) / 100,
          "--desktop-font": `${settings?.desktopFontSize || 13}px`,
          "--desktop-gap": `${settings?.desktopRowGap || 8}px`,
        } as CSSProperties
      }
    >
      <header
        className="desktop-heading"
        onPointerDown={(event) => move(event)}
        onPointerUp={stop}
        onLostPointerCapture={stop}
      >
        <span className="desktop-brand">
          <CalendarDays size={17} /> 飞历
        </span>
        <div className="desktop-tools">
          <button
            title="打开主窗口"
            aria-label="打开主窗口"
            onClick={() => act(window.calendar.navigate({}))}
          >
            <ExternalLink size={14} />
          </button>
          <button
            title="桌面外观设置"
            aria-label="桌面外观设置"
            onClick={() =>
              act(window.calendar.navigate({ settings: "desktop" }))
            }
          >
            <Settings size={14} />
          </button>
          <button
            title="关闭桌面日历"
            aria-label="关闭桌面日历"
            onClick={() => act(window.calendar.desktop("close"))}
          >
            <X size={15} />
          </button>
        </div>
      </header>
      {error && (
        <button className="desktop-error" onClick={() => setError("")}>
          {error}
        </button>
      )}
      <div className="desktop-toolbar">
        <h1>
          {Number(month.slice(0, 4))}年{" "}
          <strong>{Number(month.slice(5, 7))}月</strong>
        </h1>
        <div className="desktop-tools">
          <button
            title="上个月"
            aria-label="上个月"
            onClick={() => changeMonth(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="desktop-today"
            onClick={() => {
              setSelected(today);
              setMonth(`${today.slice(0, 7)}-01`);
            }}
          >
            今天
          </button>
          <button
            title="下个月"
            aria-label="下个月"
            onClick={() => changeMonth(1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="desktop-tabs">
        <button
          className={settings?.desktopView === "month" ? "active" : ""}
          onClick={() =>
            act(window.calendar.settings({ desktopView: "month" }))
          }
        >
          <CalendarDays size={14} /> 月历
        </button>
        <button
          className={settings?.desktopView === "agenda" ? "active" : ""}
          onClick={() =>
            act(window.calendar.settings({ desktopView: "agenda" }))
          }
        >
          <List size={15} /> 日程清单
        </button>
        <button
          className={settings?.desktopView === "grid" ? "active" : ""}
          onClick={() => act(window.calendar.settings({ desktopView: "grid" }))}
        >
          <CalendarDays size={14} />
          大月历
        </button>
        {week(selected) && <span>教学第 {week(selected)} 周</span>}
      </div>
      {settings?.desktopView === "grid" && (
        <section className="desktop-large-month" aria-label="桌面大月历">
          <div className="desktop-grid-weekdays">
            {Array.from({ length: 7 }, (_, index) => (
              <span key={index}>
                {"日一二三四五六"[(index + (settings?.weekStartsOn ?? 1)) % 7]}
              </span>
            ))}
          </div>
          <div className="desktop-grid-days">
            {dates.map((day) => {
              const items = eventsOn(events, day);
              return (
                <div
                  className={`desktop-grid-day ${day === today ? "today" : ""} ${day.slice(0, 7) !== month.slice(0, 7) ? "outside" : ""}`}
                  key={day}
                  aria-label={`日期格 ${day}`}
                  onDoubleClick={(event) => {
                    if (!(event.target as HTMLElement).closest("button,input"))
                      add(day);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropOn(
                      event.dataTransfer.getData(
                        "application/x-feicalendar-event",
                      ),
                      day,
                    );
                  }}
                >
                  <header>
                    <button
                      onClick={() => {
                        setSelected(day);
                        add(day);
                      }}
                    >
                      {Number(day.slice(-2))}
                    </button>
                    {snapshot && <DayLabel day={day} snapshot={snapshot} />}
                    {week(day) && <small>第 {week(day)} 周</small>}
                  </header>
                  {items.slice(0, settings.desktopMaxEvents).map(renderEvent)}
                  {items.length > settings.desktopMaxEvents && (
                    <button
                      className="desktop-more"
                      onClick={() => {
                        setSelected(day);
                        act(window.calendar.settings({ desktopView: "month" }));
                      }}
                    >
                      还有 {items.length - settings.desktopMaxEvents} 项
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      {settings?.desktopView === "month" && (
        <div className="desktop-month">
          <div className="desktop-weekdays">
            {settings?.teachingStartDate && <small>周</small>}
            {Array.from({ length: 7 }, (_, index) => (
              <span key={index}>
                {"日一二三四五六"[(index + (settings?.weekStartsOn ?? 1)) % 7]}
              </span>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, row) => (
            <div className="desktop-week" key={row}>
              {settings?.teachingStartDate && (
                <small className="desktop-week-number">
                  {week(dates[row * 7]) ?? ""}
                </small>
              )}
              {dates.slice(row * 7, row * 7 + 7).map((day) => (
                <button
                  key={day}
                  aria-label={day}
                  className={`${day === selected ? "selected" : ""} ${day === today ? "today" : ""} ${day.slice(0, 7) !== month.slice(0, 7) ? "outside" : ""}`}
                  onClick={() => setSelected(day)}
                  onDoubleClick={() => add(day)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropOn(
                      event.dataTransfer.getData(
                        "application/x-feicalendar-event",
                      ),
                      day,
                    );
                  }}
                >
                  <span>{Number(day.slice(-2))}</span>
                  {snapshot && <DayLabel day={day} snapshot={snapshot} />}
                  <div className="desktop-dots">
                    {eventsOn(events, day)
                      .slice(0, 3)
                      .map((event) => (
                        <i
                          key={event.id}
                          style={{
                            background: snapshot?.calendars.find(
                              (item) => item.id === event.calendarId,
                            )?.color,
                          }}
                        />
                      ))}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="desktop-agenda-heading">
        <b>
          {settings?.desktopView === "agenda"
            ? "未来两周"
            : dayHeading(selected)}
        </b>
        <button
          title="新建日程"
          aria-label="新建日程"
          onClick={() => add(selected)}
        >
          <Plus size={16} />
        </button>
      </div>
      <section className="desktop-agenda" aria-label="桌面日程">
        {settings?.desktopView === "agenda"
          ? listDays.map((day) => {
              const dayEvents = eventsOn(agendaEvents, day);
              if (!dayEvents.length) return null;
              return (
                <div key={day}>
                  <h2>
                    {dayHeading(day)}{" "}
                    {week(day) && <small>第 {week(day)} 周</small>}
                  </h2>
                  {dayEvents.map(renderEvent)}
                </div>
              );
            })
          : selectedEvents.map(renderEvent)}
        {(settings?.desktopView === "agenda"
          ? !listDays.some((day) => eventsOn(agendaEvents, day).length)
          : !selectedEvents.length) && (
          <div className="desktop-empty">
            <CalendarDays size={26} />
            <p>这段时间没有日程</p>
            <button onClick={() => add(selected)}>添加日程</button>
          </div>
        )}
      </section>
      {upcoming && (
        <div className="desktop-next">
          <span>
            下一项 · {upcoming.title} ·{" "}
            {Math.ceil((new Date(upcoming.start).getTime() - clock) / 60_000)}{" "}
            分钟后
          </span>
          {meetingLink(upcoming) && (
            <button
              onClick={() =>
                act(window.calendar.openExternal(meetingLink(upcoming)!))
              }
            >
              加入会议
            </button>
          )}
        </div>
      )}
      <div className="desktop-countdowns">
        {snapshot?.specialDates
          ?.filter((item) => item.showDesktop)
          .map((item) => {
            const day = nextSpecialDate(item, today);
            if (!day) return null;
            const remaining = daysUntil(day, today);
            return (
              <span key={item.id} title={day}>
                {item.title}{" "}
                <b>
                  {remaining === 0
                    ? "今天"
                    : remaining > 0
                      ? `${remaining} 天后`
                      : `已过 ${-remaining} 天`}
                </b>
              </span>
            );
          })}
      </div>
      <footer className="desktop-footer">
        <span>
          {snapshot?.lastSync
            ? `上次同步 ${inputTime(snapshot.lastSync).slice(11)}`
            : "与主窗口同步显示"}
        </span>
        <span>{settings?.desktopLocked ? "位置已锁定" : "拖动标题栏移动"}</span>
      </footer>
      {!settings?.desktopLocked && (
        <div
          className="desktop-resize"
          title="拖动调整大小"
          onPointerDown={(event) => move(event, true)}
          onPointerUp={stop}
          onLostPointerCapture={stop}
        >
          <Grip size={13} />
        </div>
      )}
      {editor && snapshot && (
        <EventEditor
          context={snapshot}
          key={editor.id || "new"}
          initial={editor}
          calendars={snapshot.calendars}
          templates={snapshot.templates}
          localReminderMinutes={
            snapshot.reminderRules?.[editor.id] ??
            snapshot.reminderRules?.[editor.seriesId || ""]
          }
          defaultDurationMinutes={settings?.defaultDurationMinutes || 60}
          onSave={async (input) => {
            setSnapshot(await window.calendar.saveEvent(input));
          }}
          onDelete={async (id, scope) => {
            setSnapshot(await window.calendar.deleteEvent(id, scope));
          }}
          onClose={() => setEditor(undefined)}
          onDuplicate={(event) => {
            const draft = eventDraft(
              snapshot,
              event.start,
              event.end,
              event.allDay,
            );
            setEditor({
              ...draft,
              title: event.title,
              description: event.description,
              location: event.location,
            });
          }}
        />
      )}
    </main>
  );
}
