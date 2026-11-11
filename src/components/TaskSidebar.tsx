import { useEffect, useRef, useState } from "react";
import { Draggable } from "@fullcalendar/interaction";
import { Plus, X } from "lucide-react";
import type { AppSnapshot, CalendarTask } from "../shared/types";
import { inputTime } from "../shared/dates";

const blankTask = (): CalendarTask => ({
  id: "",
  title: "",
  description: "",
  deadline: "",
  estimateMinutes: 30,
  priority: 0,
  completed: false,
  subtasks: [],
});

export default function TaskSidebar({
  snapshot,
  update,
  onClose,
}: {
  snapshot: AppSnapshot;
  update: (state: AppSnapshot) => void;
  onClose: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<CalendarTask>();
  const [showCompleted, setShowCompleted] = useState(false);
  const [subtask, setSubtask] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scheduling, setScheduling] = useState("");
  const [start, setStart] = useState(inputTime(new Date().toISOString()));
  const [calendarId, setCalendarId] = useState(
    snapshot.settings.defaultCalendarId,
  );
  const [removeScheduled, setRemoveScheduled] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const draggable = new Draggable(container.current, {
      itemSelector: ".task-drag-handle",
      eventData: (element) => ({
        title: element.dataset.title,
        duration: { minutes: Number(element.dataset.minutes) },
        create: false,
      }),
    });
    return () => draggable.destroy();
  }, []);
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
  const tasks = (snapshot.tasks || [])
    .filter((task) => showCompleted || !task.completed)
    .slice()
    .sort(
      (left, right) =>
        Number(left.completed) - Number(right.completed) ||
        right.priority - left.priority ||
        (left.deadline || "9999").localeCompare(right.deadline || "9999"),
    );
  return (
    <aside className="agenda-sidebar task-sidebar">
      <div className="section-heading">
        <h3>待办清单</h3>
        <button className="icon-button" title="关闭待办侧栏" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <button
        className="primary"
        onClick={() => {
          setDraft(blankTask());
          setSubtask("");
        }}
      >
        <Plus size={15} />
        新建待办
      </button>
      <p className="muted-text">拖动待办标题到日历时间格，安排实际执行时间。</p>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={showCompleted}
          onChange={(event) => setShowCompleted(event.target.checked)}
        />
        显示已完成
      </label>
      {draft && (
        <form
          className="stacked-form task-form"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              const state = await window.calendar.saveTask(draft);
              setDraft(undefined);
              return state;
            });
          }}
        >
          <label>
            待办标题
            <input
              aria-label="待办标题"
              value={draft.title}
              autoFocus
              required
              maxLength={1000}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
          </label>
          <label>
            截止时间
            <input
              aria-label="待办截止时间"
              type="datetime-local"
              value={draft.deadline ? inputTime(draft.deadline) : ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  deadline: event.target.value
                    ? `${event.target.value}:00+08:00`
                    : "",
                })
              }
            />
          </label>
          <div className="time-inputs">
            <label>
              预计分钟
              <input
                aria-label="待办预计时长"
                type="number"
                min={1}
                max={10080}
                value={draft.estimateMinutes}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    estimateMinutes: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              优先级
              <select
                value={draft.priority}
                onChange={(event) =>
                  setDraft({ ...draft, priority: Number(event.target.value) })
                }
              >
                {[0, 1, 2, 3].map((value) => (
                  <option key={value} value={value}>
                    {["普通", "低", "中", "高"][value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            说明
            <textarea
              value={draft.description}
              rows={3}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </label>
          {draft.subtasks.map((item) => (
            <label className="task-subtask" key={item.id}>
              <input
                type="checkbox"
                checked={item.completed}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    subtasks: draft.subtasks.map((sub) =>
                      sub.id === item.id
                        ? { ...sub, completed: event.target.checked }
                        : sub,
                    ),
                  })
                }
              />
              <span>{item.title}</span>
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    subtasks: draft.subtasks.filter(
                      (sub) => sub.id !== item.id,
                    ),
                  })
                }
              >
                移除
              </button>
            </label>
          ))}
          <div className="template-controls">
            <input
              aria-label="子任务标题"
              placeholder="添加子任务"
              value={subtask}
              onChange={(event) => setSubtask(event.target.value)}
            />
            <button
              type="button"
              disabled={!subtask.trim()}
              onClick={() => {
                setDraft({
                  ...draft,
                  subtasks: [
                    ...draft.subtasks,
                    {
                      id: crypto.randomUUID(),
                      title: subtask.trim(),
                      completed: false,
                    },
                  ],
                });
                setSubtask("");
              }}
            >
              添加
            </button>
          </div>
          <div className="connection-actions">
            <button className="primary" type="submit" disabled={busy}>
              保存待办
            </button>
            <button type="button" onClick={() => setDraft(undefined)}>
              取消
            </button>
          </div>
          {draft.id && (
            <>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={removeScheduled}
                  onChange={(event) => setRemoveScheduled(event.target.checked)}
                />
                删除待办时同时删除已安排日程
              </label>
              <button
                className="text-button danger"
                type="button"
                onClick={() =>
                  void perform(async () => {
                    const state = await window.calendar.deleteTask(
                      draft.id,
                      removeScheduled,
                    );
                    setDraft(undefined);
                    return state;
                  })
                }
              >
                删除待办
              </button>
            </>
          )}
        </form>
      )}
      <div className="task-list" ref={container}>
        {tasks.map((task) => {
          const blocks = snapshot.events.filter(
            (event) => !event.deleted && event.taskId === task.id,
          );
          return (
            <article
              className={`task-card ${task.completed ? "completed" : ""}`}
              key={task.id}
            >
              <div className="task-title">
                <input
                  type="checkbox"
                  aria-label={`完成待办 ${task.title}`}
                  checked={task.completed}
                  onChange={(event) =>
                    void perform(() =>
                      window.calendar.saveTask({
                        ...task,
                        completed: event.target.checked,
                      }),
                    )
                  }
                />
                <span
                  className={task.completed ? "" : "task-drag-handle"}
                  data-task-id={task.id}
                  data-title={task.title}
                  data-minutes={task.estimateMinutes}
                >
                  {task.title}
                </span>
              </div>
              <small>
                {task.estimateMinutes} 分钟
                {task.priority > 0 &&
                  ` · ${["", "低", "中", "高"][task.priority]}优先级`}
                {blocks.length > 0 && ` · 已安排 ${blocks.length} 段`}
              </small>
              {task.deadline && (
                <small
                  className={
                    !task.completed &&
                    new Date(task.deadline).getTime() < Date.now()
                      ? "overdue"
                      : ""
                  }
                >
                  截止 {inputTime(task.deadline).replace("T", " ")}
                </small>
              )}
              {task.subtasks.length > 0 && (
                <small>
                  子任务 {task.subtasks.filter((item) => item.completed).length}
                  /{task.subtasks.length}
                </small>
              )}
              <div className="connection-actions">
                <button onClick={() => setDraft(structuredClone(task))}>
                  编辑
                </button>
                {!task.completed && (
                  <button
                    onClick={() =>
                      setScheduling(scheduling === task.id ? "" : task.id)
                    }
                  >
                    安排时间
                  </button>
                )}
              </div>
              {scheduling === task.id && (
                <form
                  className="stacked-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(async () => {
                      const state = await window.calendar.scheduleTask(
                        task.id,
                        `${start}:00+08:00`,
                        calendarId,
                        crypto.randomUUID(),
                      );
                      setScheduling("");
                      return state;
                    });
                  }}
                >
                  <input
                    aria-label="待办执行时间"
                    type="datetime-local"
                    required
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                  />
                  <select
                    aria-label="待办所属日历"
                    value={calendarId}
                    onChange={(event) => setCalendarId(event.target.value)}
                  >
                    {snapshot.calendars
                      .filter((calendar) => calendar.writable)
                      .map((calendar) => (
                        <option key={calendar.id} value={calendar.id}>
                          {calendar.name}
                        </option>
                      ))}
                  </select>
                  <button type="submit" className="secondary" disabled={busy}>
                    确认安排
                  </button>
                </form>
              )}
            </article>
          );
        })}
      </div>
      {!tasks.length && !draft && <p className="muted-text">暂无待办。</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
