import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import multiMonthPlugin from "@fullcalendar/multimonth";
import luxonPlugin from "@fullcalendar/luxon3";
import zhLocale from "@fullcalendar/core/locales/zh-cn";
import type {
  DatesSetArg,
  DayCellContentArg,
  EventApi,
} from "@fullcalendar/core";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Settings,
  RefreshCw,
  Cloud,
  PanelRightClose,
  PanelRightOpen,
  CalendarCheck2,
  ChevronsUpDown,
  Minus,
  Square,
  X,
  Check,
  Link2,
  MoreHorizontal,
  Repeat2,
  MapPin,
  AlertCircle,
  Undo2,
  ListTodo,
} from "lucide-react";
import type {
  AppSnapshot,
  CalendarEvent,
  CalendarSource,
  CalendarView,
  DateRange,
  EventSave,
} from "./shared/types";
import {
  clearDateCaches,
  dateKey,
  shiftDate,
  overlaps,
  TIME_ZONE,
  hourTime,
  teachingWeek,
} from "./shared/dates";
import { clearRecurrenceCache } from "./shared/recurrence";
import { expandCalendarEvents, reconcileSnapshot } from "./shared/occurrences";
import DayLabel from "./components/DayLabel";
import TaskSidebar from "./components/TaskSidebar";
import CalendarSets from "./components/CalendarSets";
import CalendarTools from "./components/CalendarTools";
import MiniCalendar from "./components/MiniCalendar";
import EventEditor from "./components/EventEditor";
import SettingsDialog from "./components/SettingsDialog";
import appIcon from "../build/icon.png";
import { eventDraft } from "./shared/capture";

const views = [
  { id: "timeGridDay", name: "日视图" },
  { id: "timeGridThreeDay", name: "三日视图" },
  { id: "timeGridWeek", name: "周视图" },
  { id: "dayGridMonth", name: "月视图" },
  { id: "multiMonthYear", name: "年视图" },
  { id: "listMonth", name: "日程列表" },
] satisfies { id: CalendarView; name: string }[];
const weekdayFormat = new Intl.DateTimeFormat("zh-CN", {
  weekday: "short",
  timeZone: TIME_ZONE,
});
const colors = [
  "#5474ee",
  "#19a58b",
  "#e9a03f",
  "#ad74df",
  "#e77389",
  "#6296ac",
];
const plugins = [
  dayGridPlugin,
  timeGridPlugin,
  interactionPlugin,
  listPlugin,
  multiMonthPlugin,
  luxonPlugin,
];
const dayNumberContent = (info: DayCellContentArg) =>
  Number(dateKey(info.date).slice(-2));
const customViews = {
  dayGridMonth: { dayCellContent: dayNumberContent },
  multiMonthYear: { dayCellContent: dayNumberContent },
  timeGridThreeDay: {
    type: "timeGrid",
    duration: { days: 3 },
    buttonText: "三日",
  },
};
const providerLabel = {
  local: "本地",
  feishu: "飞书",
  caldav: "CalDAV",
  webdav: "WebDAV",
  ics: "订阅",
  google: "Google",
  microsoft: "Outlook",
};

export default function App() {
  const [snapshot, setSnapshotState] = useState<AppSnapshot>();
  const setSnapshot = useCallback(
    (next: AppSnapshot) =>
      setSnapshotState((prev) => reconcileSnapshot(prev, next)),
    [],
  );
  const [loadingError, setLoadingError] = useState("");
  const [view, setView] = useState<CalendarView>("timeGridWeek");
  const [title, setTitle] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [miniMonth, setMiniMonth] = useState(new Date());
  const [range, setRange] = useState<DateRange>({
    start: new Date(Date.now() - 7 * 86400_000).toISOString(),
    end: new Date(Date.now() + 7 * 86400_000).toISOString(),
  });
  const [editor, setEditor] = useState<CalendarEvent>();
  const [settingsTab, setSettingsTab] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [showAgenda, setShowAgenda] = useState(true);
  const [showTasks, setShowTasks] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [calendarForm, setCalendarForm] = useState<Partial<CalendarSource>>();
  const [publishTarget, setPublishTarget] = useState("");
  const [calendarError, setCalendarError] = useState("");
  const calendarRef = useRef<FullCalendar>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const latestRange = useRef(range);
  latestRange.current = range;
  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      setSnapshot(await window.calendar.sync(latestRange.current));
    } finally {
      setSyncing(false);
    }
  }, []);
  const showError = useCallback(
    (error: unknown) =>
      setToast(
        (error as Error).message.replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      ),
    [],
  );

  useEffect(() => {
    if (!window.calendar) {
      setLoadingError("请通过桌面应用启动飞历。");
      return;
    }
    void window.calendar
      .snapshot()
      .then(setSnapshot)
      .catch((error) => setLoadingError(error.message));
    const changed = window.calendar.onChanged(setSnapshot);
    const status = window.calendar.onSync(setSyncing);
    return () => {
      changed();
      status();
    };
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.dataset.theme =
        snapshot.settings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : snapshot.settings.theme;
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [snapshot?.settings.theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (
      !snapshot?.settings.autoSync ||
      (!snapshot.settings.feishuEnabled && !snapshot.connections.length)
    )
      return;
    const timer = setTimeout(() => void sync().catch(showError), 900);
    return () => clearTimeout(timer);
  }, [
    range.start,
    range.end,
    snapshot?.settings.feishuEnabled,
    snapshot?.connections.length,
    snapshot?.settings.autoSync,
    sync,
    showError,
  ]);

  const newEvent = useCallback(
    (start?: string, end?: string, allDay = false) => {
      if (!snapshot) return;
      setEditor(eventDraft(snapshot, start, end, allDay));
    },
    [snapshot],
  );
  useEffect(
    () =>
      window.calendar.onNavigate((target) => {
        if (target.settings) {
          setEditor(undefined);
          setSettingsTab(target.settings);
        } else if (target.event) {
          setSettingsTab("");
          setEditor(target.event);
        } else if (target.date) {
          setSettingsTab("");
          newEvent(`${target.date}T09:00:00+08:00`);
        }
      }),
    [newEvent],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditor(undefined);
        setSettingsTab("");
        setCalendarForm(undefined);
        setQuery("");
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) ||
          event.target.isContentEditable)
      )
        return;
      if (editor || settingsTab || calendarForm) return;
      if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void window.calendar.undoChange().then(setSnapshot).catch(showError);
        return;
      }
      if (event.key.toLowerCase() === "n") newEvent();
      if (event.key.toLowerCase() === "t") {
        calendarRef.current?.getApi().today();
        setSelectedDate(new Date());
        setMiniMonth(new Date());
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [newEvent, editor, settingsTab, calendarForm]);

  const visibleIds = useMemo(
    () =>
      new Set(
        snapshot?.calendars
          .filter((item) => item.visible)
          .map((item) => item.id),
      ),
    [snapshot?.calendars],
  );
  const calendarMap = useMemo(
    () => new Map(snapshot?.calendars.map((item) => [item.id, item]) || []),
    [snapshot?.calendars],
  );
  const calculateTeachingWeek = useCallback(
    (date: Date) =>
      teachingWeek(
        dateKey(date),
        snapshot?.settings.teachingStartDate || "",
        snapshot?.settings.teachingWeeks ?? 20,
        snapshot?.settings.weekStartsOn ?? 1,
      ) ?? 0,
    [
      snapshot?.settings.teachingStartDate,
      snapshot?.settings.teachingWeeks,
      snapshot?.settings.weekStartsOn,
    ],
  );
  const occurrenceCacheRef = useRef<{
    events?: CalendarEvent[];
    specialDates?: AppSnapshot["specialDates"];
    ranges: Map<string, CalendarEvent[]>;
  }>({ ranges: new Map() });
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        occurrenceCacheRef.current.ranges.clear();
        clearRecurrenceCache();
        clearDateCaches();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const occurrences = useMemo(() => {
    if (!snapshot) return [];
    const cache = occurrenceCacheRef.current;
    if (
      cache.events !== snapshot.events ||
      cache.specialDates !== snapshot.specialDates
    ) {
      cache.events = snapshot.events;
      cache.specialDates = snapshot.specialDates;
      cache.ranges.clear();
    }
    const key = `${range.start}|${range.end}`;
    const hit = cache.ranges.get(key);
    if (hit) return hit;
    const expanded = expandCalendarEvents(snapshot, range);
    if (Date.parse(range.end) - Date.parse(range.start) <= 65 * 86400_000) {
      if (cache.ranges.size >= 3) cache.ranges.clear();
      cache.ranges.set(key, expanded);
    }
    return expanded;
  }, [snapshot?.events, snapshot?.specialDates, range]);
  const visibleEvents = useMemo(
    () => occurrences.filter((item) => visibleIds.has(item.calendarId)),
    [occurrences, visibleIds],
  );
  const fcEvents = useMemo(
    () =>
      visibleEvents.map((event) => {
        const calendar = calendarMap.get(event.calendarId)!;
        return {
          ...event,
          backgroundColor: `${calendar.color}20`,
          borderColor: calendar.color,
          textColor: calendar.color,
          editable: calendar.writable,
          durationEditable: calendar.writable,
          classNames: [
            event.completed ? "event-completed" : "",
            `event-${event.syncState}`,
          ],
          extendedProps: { model: event },
        };
      }),
    [visibleEvents, calendarMap],
  );
  const selectedDay = dateKey(selectedDate);
  const dayEvents = useMemo(
    () =>
      visibleEvents
        .filter((event) =>
          event.allDay
            ? event.start <= selectedDay && event.end > selectedDay
            : overlaps(event.start, event.end, {
                start: `${selectedDay}T00:00:00+08:00`,
                end: `${shiftDate(selectedDay, 1)}T00:00:00+08:00`,
              }),
        )
        .sort(
          (a, b) =>
            Number(b.allDay) - Number(a.allDay) ||
            a.start.localeCompare(b.start),
        ),
    [visibleEvents, selectedDay],
  );
  const almanacState = useMemo(
    () =>
      snapshot
        ? ({
            settings: {
              showHolidays: snapshot.settings.showHolidays,
              showSolarTerms: snapshot.settings.showSolarTerms,
              showLunar: snapshot.settings.showLunar,
            },
            holidayData: snapshot.holidayData,
            holidayOverrides: snapshot.holidayOverrides,
          } as AppSnapshot)
        : undefined,
    [
      snapshot?.settings.showHolidays,
      snapshot?.settings.showSolarTerms,
      snapshot?.settings.showLunar,
      snapshot?.holidayData,
      snapshot?.holidayOverrides,
    ],
  );
  const calendarViews = useMemo(
    () => ({
      ...customViews,
      dayGridMonth: {
        dayCellContent: (info: DayCellContentArg) => (
          <>
            <span className="fc-day-num">{dayNumberContent(info)}</span>
            {almanacState && (
              <DayLabel day={dateKey(info.date)} snapshot={almanacState} />
            )}
          </>
        ),
      },
      multiMonthYear: {
        dayMaxEvents: 1,
        dayCellContent: (info: DayCellContentArg) => (
          <>
            <span className="fc-day-num">{dayNumberContent(info)}</span>
            {almanacState && (
              <DayLabel day={dateKey(info.date)} snapshot={almanacState} />
            )}
          </>
        ),
      },
    }),
    [almanacState],
  );
  const renderDayHeader = useCallback(
    (info: { date: Date; view: { type: string } }) => (
      <div className="calendar-day-heading">
        <span>{weekdayFormat.format(info.date)}</span>
        {info.view.type.startsWith("timeGrid") && (
          <b>{Number(dateKey(info.date).slice(-2))}</b>
        )}
        {info.view.type.startsWith("timeGrid") && almanacState && (
          <DayLabel day={dateKey(info.date)} snapshot={almanacState} />
        )}
      </div>
    ),
    [almanacState],
  );
  const timeFormat = useMemo(
    () => ({
      hour: "2-digit" as const,
      minute: "2-digit" as const,
      hour12: Boolean(snapshot?.settings.hour12),
    }),
    [snapshot?.settings.hour12],
  );
  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    const needle = query.toLowerCase().trim();
    return (snapshot?.events || [])
      .filter(
        (item) =>
          !item.deleted &&
          [item.title, item.description, item.location].some((value) =>
            value.toLowerCase().includes(needle),
          ),
      )
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 100);
  }, [query, snapshot?.events]);
  const changeView = (next: CalendarView) => {
    setQuery("");
    calendarRef.current?.getApi().changeView(next);
    void window.calendar
      .settings({ calendarView: next })
      .then(setSnapshot)
      .catch(showError);
  };
  const navigate = (date: Date) => {
    setSelectedDate(date);
    setMiniMonth(date);
    calendarRef.current?.getApi().gotoDate(date);
  };
  const datesSet = useCallback((info: DatesSetArg) => {
    setView(info.view.type as CalendarView);
    setTitle(info.view.title);
    setRange((previous) =>
      previous.start === info.startStr && previous.end === info.endStr
        ? previous
        : { start: info.startStr, end: info.endStr },
    );
    const date = info.view.calendar.getDate();
    setMiniMonth((previous) =>
      previous.getTime() === date.getTime() ? previous : date,
    );
    setSelectedDate((previous) =>
      previous.getTime() === date.getTime() ? previous : date,
    );
  }, []);
  const saveEvent = async (input: EventSave) => {
    setSnapshot(await window.calendar.saveEvent(input));
    setToast("日程已保存");
    if (snapshot?.settings.autoSync) void sync().catch(showError);
  };
  const dragEvent = (event: EventApi, revert: () => void) => {
    const model = event.extendedProps.model as CalendarEvent;
    const changed = {
      ...model,
      start: event.startStr,
      end:
        event.endStr ||
        new Date(event.start!.getTime() + 3600_000).toISOString(),
      allDay: event.allDay,
    };
    if (model.recurring || model.recurrence) {
      revert();
      setEditor(changed);
    } else
      void saveEvent({ event: changed }).catch((error) => {
        revert();
        showError(error);
      });
  };

  if (!snapshot)
    return (
      <main className="loading">
        <div className="app-mark">
          <img src={appIcon} alt="" />
        </div>
        <h2>飞历</h2>
        <p>{loadingError || "正在打开你的日历…"}</p>
        {loadingError && (
          <button onClick={() => location.reload()}>重新载入</button>
        )}
      </main>
    );
  const connected =
    snapshot.settings.feishuEnabled || snapshot.connections.length > 0;
  const pending = snapshot.queue.length;
  const teachingWeekNumber = teachingWeek(
    dateKey(selectedDate),
    snapshot.settings.teachingStartDate,
    snapshot.settings.teachingWeeks,
    snapshot.settings.weekStartsOn,
  );
  return (
    <div className="app-shell">
      <header className="titlebar">
        <span>
          <img className="titlebar-icon" src={appIcon} alt="" />
          飞历 <i>FeiCalendar</i>
        </span>
        <div className="window-actions">
          <button
            title="最小化"
            onClick={() => window.calendar.window("minimize")}
          >
            <Minus size={15} />
          </button>
          <button
            title="最大化"
            onClick={() => window.calendar.window("maximize")}
          >
            <Square size={11} />
          </button>
          <button
            title={snapshot.settings.closeToTray ? "最小化到托盘" : "关闭应用"}
            className="window-close"
            onClick={() => window.calendar.window("close")}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="workspace">
        <nav className="rail" aria-label="主导航">
          <button
            title="待办清单"
            className={showTasks ? "active" : ""}
            onClick={() => {
              setShowTasks(!showTasks);
              setTimeout(() => calendarRef.current?.getApi().updateSize(), 0);
            }}
          >
            <ListTodo size={21} />
          </button>
          <button
            className="app-mark"
            title="飞历"
            onClick={() => navigate(new Date())}
          >
            <img src={appIcon} alt="飞历" />
          </button>
          <button
            title="快捷录入"
            onClick={() =>
              void window.calendar.quickCapture("open").catch(showError)
            }
          >
            <Plus size={20} />
          </button>
          <button
            title="撤销上次日程操作"
            disabled={!snapshot.history?.some((entry) => !entry.undone)}
            onClick={() =>
              void window.calendar
                .undoChange()
                .then(setSnapshot)
                .catch(showError)
            }
          >
            <Undo2 size={20} />
          </button>
          <button
            className={`rail-button ${view !== "listMonth" ? "active" : ""}`}
            title="日历"
            onClick={() => {
              setQuery("");
              changeView("timeGridWeek");
            }}
          >
            <CalendarDays size={23} />
          </button>
          <button
            className={`rail-button ${view === "listMonth" ? "active" : ""}`}
            title="日程列表"
            onClick={() => changeView("listMonth")}
          >
            <CalendarCheck2 size={22} />
          </button>
          <div className="rail-spacer" />
          <button
            className="rail-button"
            title="日历连接"
            onClick={() => setSettingsTab("connections")}
          >
            <Link2 size={21} />
          </button>
          <button
            className="rail-button"
            title="设置"
            onClick={() => setSettingsTab("general")}
          >
            <Settings size={21} />
          </button>
          <span className="avatar">历</span>
        </nav>
        <aside className="sidebar">
          <div className="brand">
            <h1>我的日历</h1>
            <button
              className="icon-button"
              title="日历设置"
              onClick={() => setSettingsTab("general")}
            >
              <ChevronsUpDown size={17} />
            </button>
          </div>
          <button className="new-event-button" onClick={() => newEvent()}>
            <Plus size={18} />
            新建日程<kbd>N</kbd>
          </button>
          <MiniCalendar
            month={miniMonth}
            selected={selectedDate}
            weekStartsOn={snapshot.settings.weekStartsOn}
            onMonth={setMiniMonth}
            onSelect={navigate}
          />
          <div className="calendar-list">
            <div className="section-heading">
              <span>日历</span>
              <button
                className="icon-button"
                title="添加日历"
                onClick={() => {
                  setCalendarError("");
                  setCalendarForm({ name: "", color: colors[0] });
                }}
              >
                <Plus size={17} />
              </button>
            </div>
            {snapshot.calendars.map((calendar) => (
              <div className="calendar-row" key={calendar.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={calendar.visible}
                    style={{ accentColor: calendar.color }}
                    onChange={(e) =>
                      void window.calendar
                        .updateCalendar(calendar.id, {
                          visible: e.target.checked,
                        })
                        .then(setSnapshot)
                        .catch(showError)
                    }
                  />
                  <span>{calendar.name}</span>
                </label>
                <small>{providerLabel[calendar.provider]}</small>
                <button
                  className="calendar-menu icon-button"
                  title={`设置${calendar.name}`}
                  onClick={() => {
                    setCalendarError("");
                    setPublishTarget("");
                    setCalendarForm(calendar);
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            ))}
            <button
              className="add-connection"
              onClick={() => setSettingsTab("connections")}
            >
              <Plus size={15} />
              添加日历连接
            </button>
          </div>
          <div className="sidebar-bottom">
            <button
              className="sync-status"
              onClick={() => setSettingsTab(connected ? "sync" : "connections")}
            >
              {snapshot.syncError ? (
                <AlertCircle size={17} className="warning" />
              ) : (
                <Cloud size={18} />
              )}
              <div>
                <span>
                  {syncing
                    ? "正在同步…"
                    : snapshot.syncError
                      ? "同步需要处理"
                      : pending
                        ? `${pending} 项修改待同步`
                        : connected
                          ? "日历已连接"
                          : "连接日历账号"}
                </span>
                <small>
                  {snapshot.lastSync
                    ? `更新于 ${format(new Date(snapshot.lastSync), "HH:mm")}`
                    : connected
                      ? "查看同步记录"
                      : "让日程在设备间同步"}
                </small>
              </div>
            </button>
            <div className="timezone-label">
              GMT+08:00 <span>北京时间</span>
            </div>
          </div>
        </aside>
        <main className="main-panel">
          <header className="toolbar">
            <div className="date-navigation">
              <h2>{title}</h2>
              <button
                className="today-button"
                onClick={() => navigate(new Date())}
              >
                今天
              </button>
              <button
                className="icon-button"
                title="上一时段"
                onClick={() => calendarRef.current?.getApi().prev()}
              >
                <ChevronLeft size={19} />
              </button>
              <button
                className="icon-button"
                title="下一时段"
                onClick={() => calendarRef.current?.getApi().next()}
              >
                <ChevronRight size={19} />
              </button>
            </div>
            <div className="toolbar-right">
              <button
                className="icon-button"
                title="搜索、批量操作、导入与打印"
                onClick={() => setShowTools(true)}
              >
                <MoreHorizontal size={18} />
              </button>
              <div className="search-field">
                <Search size={16} />
                <input
                  ref={searchRef}
                  aria-label="搜索日程"
                  placeholder="搜索日程"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <kbd>⌃ K</kbd>
              </div>
              <button
                className={`icon-button ${syncing ? "spinning" : ""}`}
                title="立即同步"
                disabled={syncing}
                onClick={() =>
                  connected
                    ? void sync().catch(showError)
                    : setSettingsTab("connections")
                }
              >
                <RefreshCw size={17} />
              </button>
              <button
                className="icon-button"
                title="切换日程侧栏"
                onClick={() => {
                  setShowAgenda(!showAgenda);
                  setTimeout(
                    () => calendarRef.current?.getApi().updateSize(),
                    0,
                  );
                }}
              >
                {showAgenda ? (
                  <PanelRightClose size={18} />
                ) : (
                  <PanelRightOpen size={18} />
                )}
              </button>
            </div>
          </header>
          <div className="view-toolbar">
            <CalendarSets snapshot={snapshot} update={setSnapshot} />
            <div className="view-tabs" role="tablist" aria-label="日历视图">
              {views.map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  id={`view-${item.id}`}
                  aria-controls="calendar-view"
                  aria-selected={view === item.id}
                  tabIndex={view === item.id ? 0 : -1}
                  className={view === item.id ? "active" : ""}
                  onClick={() => changeView(item.id)}
                  onKeyDown={(event) => {
                    if (
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      return;
                    event.preventDefault();
                    const index = views.findIndex(
                      (entry) => entry.id === item.id,
                    );
                    const nextIndex = {
                      ArrowLeft: (index + views.length - 1) % views.length,
                      ArrowRight: (index + 1) % views.length,
                      Home: 0,
                      End: views.length - 1,
                    }[event.key]!;
                    changeView(views[nextIndex].id);
                    document
                      .getElementById(`view-${views[nextIndex].id}`)
                      ?.focus();
                  }}
                >
                  {item.name}
                </button>
              ))}
            </div>
            {teachingWeekNumber !== null && (
              <span className="teaching-week-summary" aria-label="当前教学周">
                教学第 {teachingWeekNumber} 周
                <small>共 {snapshot.settings.teachingWeeks} 周</small>
              </span>
            )}
          </div>
          <div className="calendar-and-agenda">
            <section
              className={`calendar-canvas ${query ? "searching" : ""}`}
              id="calendar-view"
              role="tabpanel"
              aria-labelledby={`view-${view}`}
            >
              <FullCalendar
                droppable
                drop={(info) => {
                  const taskId = info.draggedEl.dataset.taskId;
                  if (taskId)
                    void window.calendar
                      .scheduleTask(
                        taskId,
                        info.allDay
                          ? `${info.dateStr.slice(0, 10)}T09:00:00+08:00`
                          : info.dateStr,
                        snapshot.settings.defaultCalendarId,
                        crypto.randomUUID(),
                      )
                      .then(setSnapshot)
                      .catch(showError);
                }}
                ref={calendarRef}
                plugins={plugins}
                locale={zhLocale}
                timeZone={TIME_ZONE}
                initialView={snapshot.settings.calendarView}
                views={calendarViews}
                headerToolbar={false}
                height="100%"
                firstDay={snapshot.settings.weekStartsOn}
                weekNumbers={Boolean(snapshot.settings.teachingStartDate)}
                weekText="教学周"
                weekNumberCalculation={calculateTeachingWeek}
                weekNumberContent={(info) =>
                  info.num > 0 ? `第 ${info.num} 周` : ""
                }
                nowIndicator
                weekends={snapshot.settings.weekends}
                allDaySlot
                allDayText="全天"
                slotMinTime={hourTime(snapshot.settings.dayStartHour)}
                slotMaxTime={hourTime(snapshot.settings.dayEndHour)}
                scrollTime={hourTime(
                  Math.min(
                    Math.max(7, snapshot.settings.dayStartHour),
                    snapshot.settings.dayEndHour - 1,
                  ),
                )}
                slotDuration="00:30:00"
                snapDuration="00:15:00"
                slotLabelFormat={timeFormat}
                eventTimeFormat={timeFormat}
                dayHeaderContent={renderDayHeader}
                navLinks
                navLinkDayClick={(date) => {
                  navigate(date);
                  changeView("timeGridDay");
                }}
                navLinkWeekClick={(date) => {
                  navigate(date);
                  changeView("timeGridWeek");
                }}
                selectable
                selectMinDistance={4}
                selectMirror
                editable
                eventResizableFromStart
                eventDisplay="block"
                dayMaxEvents={4}
                events={fcEvents}
                datesSet={datesSet}
                noEventsContent="这一时段还没有日程"
                moreLinkContent={(args) => `+${args.num} 项日程`}
                dateClick={(info) =>
                  newEvent(
                    info.dateStr,
                    info.allDay ? shiftDate(info.dateStr, 1) : undefined,
                    info.allDay,
                  )
                }
                select={(info) => {
                  newEvent(info.startStr, info.endStr, info.allDay);
                  info.view.calendar.unselect();
                }}
                eventClick={(info) =>
                  setEditor(info.event.extendedProps.model as CalendarEvent)
                }
                eventDrop={(info) => dragEvent(info.event, info.revert)}
                eventResize={(info) => dragEvent(info.event, info.revert)}
                eventContent={(info) => (
                  <div className="event-content">
                    <div>
                      {info.event.extendedProps.model?.completed && (
                        <Check size={12} />
                      )}
                      {info.timeText && (
                        <span className="event-time">{info.timeText}</span>
                      )}
                      {info.event.extendedProps.model?.recurring && (
                        <Repeat2 size={11} />
                      )}
                    </div>
                    <strong>{info.event.title}</strong>
                    {info.event.extendedProps.model?.location && (
                      <small>{info.event.extendedProps.model.location}</small>
                    )}
                  </div>
                )}
              />
              {query && (
                <div className="search-results">
                  <div className="section-heading">
                    <h3>
                      搜索结果 <small>{searchResults.length} 项</small>
                    </h3>
                    <button
                      className="icon-button"
                      aria-label="关闭搜索"
                      onClick={() => setQuery("")}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <p className="muted-text">搜索本地日程和已同步到本机的日程</p>
                  {!searchResults.length && (
                    <div className="empty-search">
                      <Search size={32} />
                      <p>没有找到“{query}”</p>
                    </div>
                  )}
                  {searchResults.map((event) => (
                    <button
                      className="search-result"
                      key={event.id}
                      onClick={() => setEditor(event)}
                    >
                      <span
                        className="color-dot"
                        style={{
                          background: snapshot.calendars.find(
                            (item) => item.id === event.calendarId,
                          )?.color,
                        }}
                      />
                      <div>
                        <b>{event.title}</b>
                        <small>
                          {event.allDay
                            ? event.start
                            : new Date(event.start).toLocaleString("zh-CN", {
                                timeZone: TIME_ZONE,
                                hour12: snapshot.settings.hour12,
                              })}
                          {event.location && ` · ${event.location}`}
                        </small>
                      </div>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </div>
              )}
            </section>
            {showTasks && (
              <TaskSidebar
                snapshot={snapshot}
                update={setSnapshot}
                onClose={() => {
                  setShowTasks(false);
                  setTimeout(
                    () => calendarRef.current?.getApi().updateSize(),
                    0,
                  );
                }}
              />
            )}
            {showAgenda && !showTasks && (
              <aside className="agenda-sidebar">
                <div className="agenda-date">
                  <span>{format(selectedDate, "EEEE", { locale: zhCN })}</span>
                  <div>
                    <b>{format(selectedDate, "dd")}</b>
                    <span>{format(selectedDate, "M 月 yyyy")}</span>
                  </div>
                </div>
                <div className="section-heading">
                  <h3>当日安排</h3>
                  <span>{dayEvents.length} 项</span>
                </div>
                {dayEvents.length ? (
                  <div className="agenda-events">
                    {dayEvents.map((event) => (
                      <button
                        className={`agenda-event ${event.completed ? "completed" : ""}`}
                        key={event.id}
                        onClick={() => setEditor(event)}
                      >
                        <span
                          className="agenda-event-bar"
                          style={{
                            background: snapshot.calendars.find(
                              (item) => item.id === event.calendarId,
                            )?.color,
                          }}
                        />
                        <small>
                          {event.allDay
                            ? "全天"
                            : new Date(event.start).toLocaleTimeString(
                                "zh-CN",
                                {
                                  timeZone: TIME_ZONE,
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  hour12: snapshot.settings.hour12,
                                },
                              )}
                        </small>
                        <b>{event.title}</b>
                        {event.location && (
                          <span>
                            <MapPin size={12} />
                            {event.location}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="agenda-empty">
                    <div>
                      <CalendarCheck2 size={32} strokeWidth={1.3} />
                    </div>
                    <h4>当天暂无日程</h4>
                    <p>点击时间格或下方按钮添加</p>
                    <button
                      className="text-button"
                      onClick={() =>
                        newEvent(`${dateKey(selectedDate)}T09:00:00+08:00`)
                      }
                    >
                      <Plus size={15} />
                      添加日程
                    </button>
                  </div>
                )}
                {!connected && (
                  <div className="connect-prompt">
                    <span className="connection-logo">
                      <Cloud size={22} />
                    </span>
                    <h4>连接你的日历</h4>
                    <p>连接账号或添加日历订阅，在一个窗口里安排工作与生活。</p>
                    <button
                      className="secondary"
                      onClick={() => setSettingsTab("connections")}
                    >
                      连接日历
                      <ChevronRight size={15} />
                    </button>
                  </div>
                )}
                <div className="agenda-footer">
                  <span className="color-dot" />
                  本地修改即时保存
                </div>
              </aside>
            )}
          </div>
        </main>
      </div>
      {showTools && (
        <CalendarTools
          snapshot={snapshot}
          update={setSnapshot}
          initialDate={dateKey(selectedDate)}
          onClose={() => setShowTools(false)}
          onEdit={(event) => {
            setShowTools(false);
            setEditor(event);
          }}
        />
      )}
      {editor && (
        <EventEditor
          context={snapshot}
          templates={snapshot.templates}
          localReminderMinutes={
            snapshot.reminderRules?.[editor.id] ??
            snapshot.reminderRules?.[editor.seriesId || ""]
          }
          key={`${editor.id}/${editor.start}`}
          initial={editor}
          calendars={snapshot.calendars}
          defaultDurationMinutes={snapshot.settings.defaultDurationMinutes}
          onSave={saveEvent}
          onDelete={async (id, scope) => {
            setSnapshot(await window.calendar.deleteEvent(id, scope));
            setToast("日程已删除");
            if (snapshot.settings.autoSync) void sync().catch(showError);
          }}
          onClose={() => setEditor(undefined)}
          onDuplicate={(event) =>
            setEditor({
              ...event,
              id: "",
              remoteId: undefined,
              taskId: undefined,
              courseId: undefined,
              courseWeek: undefined,
              remoteFingerprint: undefined,
              remoteEtag: undefined,
              seriesId: undefined,
              occurrenceStart: undefined,
              recurrence: "",
              recurring: false,
              calendarId: snapshot.settings.defaultCalendarId,
              syncState: "local",
              title: `${event.title}（副本）`,
              completed: false,
            })
          }
        />
      )}
      {settingsTab && (
        <SettingsDialog
          snapshot={snapshot}
          initialTab={settingsTab}
          update={setSnapshot}
          onSync={sync}
          onClose={() => setSettingsTab("")}
        />
      )}
      {calendarForm && (
        <div className="modal-backdrop">
          <form
            className="calendar-form modal"
            aria-label="日历设置"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                try {
                  setSnapshot(
                    calendarForm.id
                      ? await window.calendar.updateCalendar(calendarForm.id, {
                          name: calendarForm.name,
                          color: calendarForm.color,
                        })
                      : await window.calendar.saveCalendar({
                          name: calendarForm.name!,
                          color: calendarForm.color,
                        }),
                  );
                  setCalendarForm(undefined);
                } catch (error) {
                  setCalendarError((error as Error).message);
                }
              })();
            }}
          >
            <header className="modal-heading">
              <h2>{calendarForm.id ? "日历设置" : "新建日历"}</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭日历设置"
                onClick={() => setCalendarForm(undefined)}
              >
                <X size={18} />
              </button>
            </header>
            <label>
              日历名称
              <input
                autoFocus
                aria-label="日历名称"
                required
                maxLength={100}
                value={calendarForm.name}
                onChange={(e) =>
                  setCalendarForm({ ...calendarForm, name: e.target.value })
                }
              />
            </label>
            <label>日历颜色</label>
            <div className="color-picker">
              {colors.map((color) => (
                <button
                  type="button"
                  aria-label={`颜色 ${color}`}
                  key={color}
                  style={{ background: color }}
                  onClick={() => setCalendarForm({ ...calendarForm, color })}
                >
                  {calendarForm.color === color && <Check size={18} />}
                </button>
              ))}
            </div>
            {calendarForm.id &&
              calendarForm.provider === "local" &&
              snapshot.calendars.some(
                (item) => item.provider !== "local" && item.writable,
              ) && (
                <div className="publish-calendar">
                  <h4>将已有日程迁移到云端</h4>
                  <p>
                    日程将移入选中的云端日历并加入同步队列，该日历也将成为默认日历。
                  </p>
                  <select
                    aria-label="迁移目标日历"
                    value={publishTarget}
                    onChange={(e) => setPublishTarget(e.target.value)}
                  >
                    <option value="">选择云端目标日历</option>
                    {snapshot.calendars
                      .filter(
                        (item) => item.provider !== "local" && item.writable,
                      )
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {providerLabel[item.provider]}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    disabled={!publishTarget}
                    className="secondary"
                    onClick={() =>
                      void (async () => {
                        try {
                          setSnapshot(
                            await window.calendar.publishCalendar(
                              calendarForm.id!,
                              publishTarget,
                            ),
                          );
                          setCalendarForm(undefined);
                          await sync();
                        } catch (error) {
                          setCalendarError((error as Error).message);
                        }
                      })()
                    }
                  >
                    迁移并同步日程
                  </button>
                </div>
              )}
            {calendarError && <p className="error-text">{calendarError}</p>}
            <footer className="form-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setCalendarForm(undefined)}
              >
                取消
              </button>
              <button className="primary" type="submit">
                保存日历
              </button>
            </footer>
          </form>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
