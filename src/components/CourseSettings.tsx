import { useState } from "react";
import type { AppSnapshot, Course, Semester } from "../shared/types";
import { dateKey, inputTime } from "../shared/dates";
import { courseEvents } from "../shared/courses";

export default function CourseSettings({
  snapshot,
  update,
}: {
  snapshot: AppSnapshot;
  update: (state: AppSnapshot) => void;
}) {
  const [semesterId, setSemesterId] = useState(
    snapshot.semesters?.[0]?.id || "",
  );
  const semester = snapshot.semesters?.find((item) => item.id === semesterId);
  const [term, setTerm] = useState<Semester>();
  const [activate, setActivate] = useState(true);
  const [draft, setDraft] = useState<Course>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adjustWeek, setAdjustWeek] = useState(1);
  const [adjustDate, setAdjustDate] = useState(dateKey(new Date()));
  const [adjustStart, setAdjustStart] = useState("09:00");
  const [adjustEnd, setAdjustEnd] = useState("10:00");
  const [cancelled, setCancelled] = useState(false);
  const perform = async (operation: () => Promise<AppSnapshot>) => {
    setBusy(true);
    setError("");
    try {
      update(await operation());
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const newTerm = () =>
    setTerm({
      id: "",
      name: "",
      startDate: dateKey(new Date()),
      weeks: 20,
      weekStartsOn: 1,
      periods: [
        {
          id: crypto.randomUUID(),
          name: "第 1 节",
          start: "08:00",
          end: "08:45",
        },
        {
          id: crypto.randomUUID(),
          name: "第 2 节",
          start: "08:55",
          end: "09:40",
        },
      ],
    });
  const newCourse = () =>
    semester &&
    setDraft({
      id: "",
      semesterId: semester.id,
      title: "",
      calendarId: snapshot.settings.defaultCalendarId,
      weekday: 1,
      weeks: Array.from({ length: semester.weeks }, (_, index) => index + 1),
      firstPeriod: semester.periods[0].id,
      lastPeriod: semester.periods[0].id,
      location: "",
      description: "",
      exceptions: {},
    });
  let preview: ReturnType<typeof courseEvents> = [];
  let previewError = "";
  if (draft) {
    try {
      preview = courseEvents(snapshot, draft);
    } catch (error) {
      previewError = (error as Error).message;
    }
  }
  return (
    <section className="course-settings">
      <h3>学期与课程</h3>
      <p className="muted-text">
        每个学期独立保存起始周、总周数与节次。设为当前学期后，日历按该学期显示教学周。课程会生成可同步的日程。
      </p>
      <div className="template-controls">
        <select
          aria-label="选择学期"
          value={semesterId}
          onChange={(event) => {
            setSemesterId(event.target.value);
            setDraft(undefined);
            setTerm(undefined);
          }}
        >
          <option value="">选择学期</option>
          {snapshot.semesters?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button className="secondary" onClick={newTerm}>
          新建学期
        </button>
        {semester && (
          <button onClick={() => setTerm(structuredClone(semester))}>
            编辑学期
          </button>
        )}
      </div>
      {term && (
        <form
          className="stacked-form course-form"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              const state = await window.calendar.saveSemester(term, activate);
              setSemesterId(
                state.semesters!.find((item) => item.id === term.id)?.id ||
                  state.semesters!.at(-1)!.id,
              );
              setTerm(undefined);
              return state;
            });
          }}
        >
          <div className="form-grid">
            <label>
              学期名称
              <input
                required
                aria-label="学期名称"
                value={term.name}
                onChange={(event) =>
                  setTerm({ ...term, name: event.target.value })
                }
              />
            </label>
            <label>
              第一教学周内任一天
              <input
                type="date"
                required
                value={term.startDate}
                onChange={(event) =>
                  setTerm({ ...term, startDate: event.target.value })
                }
              />
            </label>
            <label>
              教学周数
              <input
                type="number"
                min={1}
                max={60}
                required
                value={term.weeks}
                onChange={(event) =>
                  setTerm({ ...term, weeks: Number(event.target.value) })
                }
              />
            </label>
            <label>
              每周开始
              <select
                value={term.weekStartsOn}
                onChange={(event) =>
                  setTerm({
                    ...term,
                    weekStartsOn: Number(
                      event.target.value,
                    ) as Semester["weekStartsOn"],
                  })
                }
              >
                <option value={1}>星期一</option>
                <option value={0}>星期日</option>
                <option value={6}>星期六</option>
              </select>
            </label>
          </div>
          <h4>节次时间</h4>
          {term.periods.map((period) => (
            <div className="period-row" key={period.id}>
              <input
                aria-label="节次名称"
                value={period.name}
                required
                onChange={(event) =>
                  setTerm({
                    ...term,
                    periods: term.periods.map((item) =>
                      item.id === period.id
                        ? { ...item, name: event.target.value }
                        : item,
                    ),
                  })
                }
              />
              <input
                type="time"
                aria-label={`${period.name}开始`}
                value={period.start}
                required
                onChange={(event) =>
                  setTerm({
                    ...term,
                    periods: term.periods.map((item) =>
                      item.id === period.id
                        ? { ...item, start: event.target.value }
                        : item,
                    ),
                  })
                }
              />
              <input
                type="time"
                aria-label={`${period.name}结束`}
                value={period.end}
                required
                onChange={(event) =>
                  setTerm({
                    ...term,
                    periods: term.periods.map((item) =>
                      item.id === period.id
                        ? { ...item, end: event.target.value }
                        : item,
                    ),
                  })
                }
              />
              <button
                type="button"
                onClick={() =>
                  setTerm({
                    ...term,
                    periods: term.periods.filter(
                      (item) => item.id !== period.id,
                    ),
                  })
                }
              >
                移除
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setTerm({
                ...term,
                periods: [
                  ...term.periods,
                  {
                    id: crypto.randomUUID(),
                    name: `第 ${term.periods.length + 1} 节`,
                    start: "10:00",
                    end: "10:45",
                  },
                ],
              })
            }
          >
            添加节次
          </button>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={activate}
              onChange={(event) => setActivate(event.target.checked)}
            />
            设为当前学期
          </label>
          <p className="muted-text">
            保存后，该学期已有课程将按新的起始周和节次更新。单次调课与停课记录继续生效。
          </p>
          <div className="connection-actions">
            <button className="primary" type="submit" disabled={busy}>
              保存学期
            </button>
            <button type="button" onClick={() => setTerm(undefined)}>
              取消
            </button>
            {term.id && (
              <button
                type="button"
                className="text-button danger"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const state = await window.calendar.deleteSemester(term.id);
                    setTerm(undefined);
                    setSemesterId("");
                    return state;
                  })
                }
              >
                删除学期
              </button>
            )}
          </div>
        </form>
      )}
      {semester && !term && (
        <>
          <div className="connection-actions">
            <button className="secondary" onClick={newCourse}>
              新建课程安排
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void perform(() => window.calendar.saveSemester(semester, true))
              }
            >
              设为当前学期
            </button>
          </div>
          <p className="muted-text">
            {semester.startDate} 所在周起，共 {semester.weeks} 周
          </p>
        </>
      )}
      {draft && semester && (
        <form
          className="stacked-form course-form"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              const state = await window.calendar.saveCourse(draft);
              setDraft(undefined);
              return state;
            });
          }}
        >
          <label>
            课程名称
            <input
              aria-label="课程名称"
              required
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
          </label>
          <div className="form-grid">
            <label>
              所属日历
              <select
                disabled={Boolean(draft.id)}
                value={draft.calendarId}
                onChange={(event) =>
                  setDraft({ ...draft, calendarId: event.target.value })
                }
              >
                {snapshot.calendars
                  .filter((calendar) => calendar.writable)
                  .map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              上课日
              <select
                value={draft.weekday}
                onChange={(event) =>
                  setDraft({ ...draft, weekday: Number(event.target.value) })
                }
              >
                {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                  <option key={day} value={day}>
                    星期{"日一二三四五六"[day]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              开始节次
              <select
                value={draft.firstPeriod}
                onChange={(event) =>
                  setDraft({ ...draft, firstPeriod: event.target.value })
                }
              >
                {semester.periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.name} {period.start}
                  </option>
                ))}
              </select>
            </label>
            <label>
              结束节次
              <select
                value={draft.lastPeriod}
                onChange={(event) =>
                  setDraft({ ...draft, lastPeriod: event.target.value })
                }
              >
                {semester.periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.name} {period.end}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="connection-actions">
            {["全部周", "单周", "双周", "清空"].map((name, index) => (
              <button
                type="button"
                key={name}
                onClick={() =>
                  setDraft({
                    ...draft,
                    weeks: Array.from(
                      { length: semester.weeks },
                      (_, number) => number + 1,
                    ).filter(
                      (week) =>
                        index === 0 ||
                        (index === 1 && week % 2 === 1) ||
                        (index === 2 && week % 2 === 0),
                    ),
                  })
                }
              >
                {name}
              </button>
            ))}
          </div>
          <div className="week-choices">
            {Array.from(
              { length: semester.weeks },
              (_, index) => index + 1,
            ).map((week) => (
              <label key={week}>
                <input
                  type="checkbox"
                  checked={draft.weeks.includes(week)}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      weeks: event.target.checked
                        ? [...draft.weeks, week].sort((a, b) => a - b)
                        : draft.weeks.filter((item) => item !== week),
                    })
                  }
                />
                {week}
              </label>
            ))}
          </div>
          <label>
            地点
            <input
              value={draft.location}
              onChange={(event) =>
                setDraft({ ...draft, location: event.target.value })
              }
            />
          </label>
          <label>
            说明
            <textarea
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </label>
          <details>
            <summary>停课与单次调课</summary>
            <div className="form-grid">
              <label>
                教学周
                <select
                  value={adjustWeek}
                  onChange={(event) =>
                    setAdjustWeek(Number(event.target.value))
                  }
                >
                  {draft.weeks.map((week) => (
                    <option key={week} value={week}>
                      第 {week} 周
                    </option>
                  ))}
                </select>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={cancelled}
                  onChange={(event) => setCancelled(event.target.checked)}
                />
                该周停课
              </label>
              {!cancelled && (
                <>
                  <label>
                    调整日期
                    <input
                      type="date"
                      value={adjustDate}
                      onChange={(event) => setAdjustDate(event.target.value)}
                    />
                  </label>
                  <label>
                    开始
                    <input
                      type="time"
                      value={adjustStart}
                      onChange={(event) => setAdjustStart(event.target.value)}
                    />
                  </label>
                  <label>
                    结束
                    <input
                      type="time"
                      value={adjustEnd}
                      onChange={(event) => setAdjustEnd(event.target.value)}
                    />
                  </label>
                </>
              )}
            </div>
            <button
              type="button"
              disabled={!draft.weeks.includes(adjustWeek)}
              onClick={() =>
                setDraft({
                  ...draft,
                  exceptions: {
                    ...draft.exceptions,
                    [adjustWeek]: cancelled
                      ? { cancelled: true }
                      : {
                          start: `${adjustDate}T${adjustStart}:00+08:00`,
                          end: `${adjustDate}T${adjustEnd}:00+08:00`,
                        },
                  },
                })
              }
            >
              加入本次调整
            </button>
            {Object.entries(draft.exceptions).map(([week, value]) => (
              <div className="connection-actions" key={week}>
                <span>
                  第 {week} 周 ·{" "}
                  {value.cancelled
                    ? "停课"
                    : `${inputTime(value.start!).replace("T", " ")} 至 ${inputTime(value.end!).slice(11)}`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const exceptions = { ...draft.exceptions };
                    delete exceptions[week];
                    setDraft({ ...draft, exceptions });
                  }}
                >
                  恢复原安排
                </button>
              </div>
            ))}
          </details>
          {previewError && <p className="error-text">{previewError}</p>}
          <p className="muted-text">
            将保存 {preview.length}{" "}
            次课程。日历中直接修改或删除单次课程，也会记入调课或停课记录。
          </p>
          <details>
            <summary>预览上课日期</summary>
            {preview.map((event) => (
              <p key={event.id}>
                第 {event.courseWeek} 周 ·{" "}
                {inputTime(event.start).replace("T", " ")}–
                {inputTime(event.end).slice(11)}
              </p>
            ))}
          </details>
          <div className="connection-actions">
            <button
              type="submit"
              className="primary"
              disabled={busy || !draft.weeks.length || Boolean(previewError)}
            >
              保存课程并更新日历
            </button>
            <button type="button" onClick={() => setDraft(undefined)}>
              取消
            </button>
            {draft.id && (
              <button
                type="button"
                className="text-button danger"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const state = await window.calendar.deleteCourse(draft.id);
                    setDraft(undefined);
                    return state;
                  })
                }
              >
                删除课程及日程
              </button>
            )}
          </div>
        </form>
      )}
      {!draft &&
        (snapshot.courses || [])
          .filter((course) => course.semesterId === semesterId)
          .map((course) => (
            <article className="reminder-card" key={course.id}>
              <strong>{course.title}</strong>
              <small>
                星期{"日一二三四五六"[course.weekday]} · {course.weeks.length}{" "}
                个教学周 · {course.location}
              </small>
              <button
                className="secondary"
                onClick={() => {
                  setDraft(structuredClone(course));
                  setAdjustWeek(course.weeks[0]);
                }}
              >
                编辑课程与调课
              </button>
            </article>
          ))}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
