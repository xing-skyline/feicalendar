import { useState } from "react";
import type {
  AppSnapshot,
  Settings,
  SpecialDate,
  CalendarEvent,
} from "../shared/types";
import {
  bundledHolidays,
  nextSpecialDate,
  daysUntil,
  isWorkday,
} from "../shared/almanac";
import { dateKey, shiftDate } from "../shared/dates";
import { eventDraft } from "../shared/capture";

export default function HolidaySettings({
  snapshot,
  update,
  configure,
}: {
  snapshot: AppSnapshot;
  update: (state: AppSnapshot) => void;
  configure: (patch: Partial<Settings>) => Promise<void>;
}) {
  const today = dateKey(new Date());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [overrideDay, setOverrideDay] = useState(today);
  const [overrideName, setOverrideName] = useState("自定义休息日");
  const [work, setWork] = useState(false);
  const [special, setSpecial] = useState<SpecialDate>({
    id: "",
    title: "",
    date: today,
    lunar: false,
    leapMonth: false,
    yearly: true,
    showDesktop: true,
    remindDays: 0,
  });
  const [workTitle, setWorkTitle] = useState("");
  const [workStart, setWorkStart] = useState(today);
  const [workEnd, setWorkEnd] = useState(shiftDate(today, 30));
  const [workTime, setWorkTime] = useState("09:00");
  const [workMinutes, setWorkMinutes] = useState(60);
  const [workCalendar, setWorkCalendar] = useState(
    snapshot.settings.defaultCalendarId,
  );
  const [workPreview, setWorkPreview] = useState<CalendarEvent[]>([]);
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
  const years = (snapshot.holidayData || bundledHolidays).years;
  return (
    <section>
      <h3>农历与节假日</h3>
      <label className="setting-row">
        <span>显示农历</span>
        <input
          type="checkbox"
          checked={snapshot.settings.showLunar}
          onChange={(event) =>
            void configure({ showLunar: event.target.checked })
          }
        />
      </label>
      <label className="setting-row">
        <span>显示二十四节气</span>
        <input
          type="checkbox"
          checked={snapshot.settings.showSolarTerms}
          onChange={(event) =>
            void configure({ showSolarTerms: event.target.checked })
          }
        />
      </label>
      <label className="setting-row">
        <span>显示节日与放假调休</span>
        <input
          type="checkbox"
          checked={snapshot.settings.showHolidays}
          onChange={(event) =>
            void configure({ showHolidays: event.target.checked })
          }
        />
      </label>
      <p className="muted-text">
        已收录 {Object.keys(years).sort().join("、")}{" "}
        年放假安排。其他年份按周末计算工作日，年度安排公布后可更新数据。
      </p>
      <div className="connection-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              update(await window.calendar.updateHolidays());
              setNotice("节假日数据已更新");
            })
          }
        >
          更新节假日数据
        </button>
        {Object.entries(years).map(([year, data]) => (
          <button
            key={year}
            className="text-button"
            onClick={() => void window.calendar.openExternal(data.source)}
          >
            {year} 年数据来源
          </button>
        ))}
      </div>
      <details>
        <summary>手动调整某天的工作安排</summary>
        <div className="time-inputs">
          <label>
            日期
            <input
              aria-label="自定义工作日期"
              type="date"
              value={overrideDay}
              onChange={(event) => setOverrideDay(event.target.value)}
            />
          </label>
          <label>
            名称
            <input
              value={overrideName}
              onChange={(event) => setOverrideName(event.target.value)}
            />
          </label>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={work}
            onChange={(event) => setWork(event.target.checked)}
          />
          这天上班
        </label>
        <button
          className="secondary"
          disabled={busy || !overrideName.trim()}
          onClick={() =>
            void perform(async () =>
              update(
                await window.calendar.holidayOverride(overrideDay, {
                  name: overrideName,
                  work,
                }),
              ),
            )
          }
        >
          保存日期调整
        </button>
        {Object.entries(snapshot.holidayOverrides || {})
          .sort()
          .map(([day, value]) => (
            <div className="setting-row" key={day}>
              <span>
                {day} · {value.name} · {value.work ? "上班" : "休息"}
              </span>
              <button
                onClick={() =>
                  void perform(async () =>
                    update(await window.calendar.holidayOverride(day, null)),
                  )
                }
              >
                恢复默认
              </button>
            </div>
          ))}
      </details>
      <h3>纪念日与倒数日</h3>
      <div className="special-date-list">
        {(snapshot.specialDates || []).map((item) => {
          const day = nextSpecialDate(item);
          return (
            <article className="reminder-card" key={item.id}>
              <strong>{item.title}</strong>
              <span>
                {day} · {day ? `${daysUntil(day)} 天` : "无对应日期"}
                {item.lunar ? " · 农历" : ""}
              </span>
              <div className="connection-actions">
                <button onClick={() => setSpecial(item)}>编辑</button>
                <button
                  onClick={() =>
                    void perform(async () =>
                      update(await window.calendar.deleteSpecialDate(item.id)),
                    )
                  }
                >
                  删除
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <form
        className="stacked-form"
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            update(await window.calendar.saveSpecialDate(special));
            setSpecial({ ...special, id: "", title: "" });
          });
        }}
      >
        <label>
          名称
          <input
            aria-label="纪念日名称"
            required
            value={special.title}
            onChange={(event) =>
              setSpecial({ ...special, title: event.target.value })
            }
          />
        </label>
        <label>
          日期
          <input
            aria-label="纪念日日期"
            type={special.lunar ? "text" : "date"}
            placeholder="YYYY-MM-DD"
            required
            value={special.date}
            onChange={(event) =>
              setSpecial({ ...special, date: event.target.value })
            }
          />
        </label>
        <div className="reminder-options">
          <label>
            <input
              type="checkbox"
              checked={special.lunar}
              onChange={(event) =>
                setSpecial({ ...special, lunar: event.target.checked })
              }
            />
            按农历填写
          </label>
          {special.lunar && (
            <label>
              <input
                type="checkbox"
                checked={special.leapMonth}
                onChange={(event) =>
                  setSpecial({ ...special, leapMonth: event.target.checked })
                }
              />
              闰月
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={special.yearly}
              onChange={(event) =>
                setSpecial({ ...special, yearly: event.target.checked })
              }
            />
            每年重复
          </label>
          <label>
            <input
              type="checkbox"
              checked={special.showDesktop}
              onChange={(event) =>
                setSpecial({ ...special, showDesktop: event.target.checked })
              }
            />
            桌面显示倒数日
          </label>
        </div>
        <small>
          农历三十遇小月按廿九计算，公历 2 月 29 日遇平年按 2 月 28
          日计算。闰月纪念日只在对应闰月出现的年份显示。
        </small>
        <label>
          提前提醒天数
          <input
            aria-label="纪念日提前天数"
            type="number"
            min={-1}
            max={14}
            value={special.remindDays}
            onChange={(event) =>
              setSpecial({ ...special, remindDays: Number(event.target.value) })
            }
          />
        </label>
        <small>0 为当天提醒，-1 为关闭提醒。</small>
        <button className="primary" disabled={busy} type="submit">
          保存纪念日
        </button>
      </form>
      <details>
        <summary>按调休工作日批量安排</summary>
        <p className="muted-text">
          按照当前节假日数据生成选定日期范围内的独立日程，可同步到任意可写日历。日期调整后可编辑对应日程。
        </p>
        <label>
          日程标题
          <input
            value={workTitle}
            onChange={(event) => {
              setWorkTitle(event.target.value);
              setWorkPreview([]);
            }}
          />
        </label>
        <div className="time-inputs">
          <label>
            起始日期
            <input
              type="date"
              value={workStart}
              onChange={(event) => {
                setWorkStart(event.target.value);
                setWorkPreview([]);
              }}
            />
          </label>
          <label>
            结束日期
            <input
              type="date"
              value={workEnd}
              onChange={(event) => {
                setWorkEnd(event.target.value);
                setWorkPreview([]);
              }}
            />
          </label>
        </div>
        <div className="time-inputs">
          <label>
            开始时间
            <input
              type="time"
              value={workTime}
              onChange={(event) => {
                setWorkTime(event.target.value);
                setWorkPreview([]);
              }}
            />
          </label>
          <label>
            时长（分钟）
            <input
              type="number"
              min={1}
              max={1440}
              value={workMinutes}
              onChange={(event) => {
                setWorkMinutes(Number(event.target.value));
                setWorkPreview([]);
              }}
            />
          </label>
        </div>
        <label>
          所属日历
          <select
            value={workCalendar}
            onChange={(event) => {
              setWorkCalendar(event.target.value);
              setWorkPreview([]);
            }}
          >
            {snapshot.calendars
              .filter((item) => item.writable)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <button
          className="secondary"
          disabled={busy || !workTitle.trim()}
          onClick={() => {
            try {
              const days = daysUntil(workEnd, workStart);
              if (!(days >= 0 && days < 366))
                throw new Error("请选择一年以内的日期范围");
              const events: CalendarEvent[] = [];
              for (let index = 0; index <= days; index++) {
                const day = shiftDate(workStart, index);
                if (!isWorkday(day, snapshot)) continue;
                const start = `${day}T${workTime}:00+08:00`;
                events.push({
                  ...eventDraft(
                    snapshot,
                    start,
                    new Date(
                      new Date(start).getTime() + workMinutes * 60_000,
                    ).toISOString(),
                  ),
                  id: crypto.randomUUID(),
                  title: workTitle,
                  calendarId: workCalendar,
                });
              }
              setWorkPreview(events);
              setError("");
            } catch (error) {
              setError((error as Error).message);
            }
          }}
        >
          预览工作日安排
        </button>
        {!!workPreview.length && (
          <>
            <p>将创建 {workPreview.length} 条日程。</p>
            <div className="restore-change-list">
              {workPreview.map((event) => (
                <span className="workday-preview-date" key={event.id}>
                  {dateKey(event.start)}
                </span>
              ))}
            </div>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  update(
                    await window.calendar.saveEvents(
                      workPreview.map((event) => ({ event })),
                    ),
                  );
                  setWorkPreview([]);
                  setNotice("工作日日程已保存");
                })
              }
            >
              确认创建工作日日程
            </button>
          </>
        )}
      </details>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
