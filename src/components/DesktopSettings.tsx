import { useEffect, useState } from "react";
import type { Settings, CalendarSource } from "../shared/types";

export default function DesktopSettings({
  settings,
  configure,
  calendars,
}: {
  settings: Settings;
  configure: (patch: Partial<Settings>) => Promise<void>;
  calendars: CalendarSource[];
}) {
  const [status, setStatus] =
    useState<Awaited<ReturnType<typeof window.calendar.desktopStatus>>>();
  const [opacity, setOpacity] = useState(settings.desktopOpacity);
  const [color, setColor] = useState(settings.desktopColor);
  const [displays, setDisplays] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    void window.calendar.displays().then(setDisplays);
  }, []);
  useEffect(
    () => setOpacity(settings.desktopOpacity),
    [settings.desktopOpacity],
  );
  useEffect(() => setColor(settings.desktopColor), [settings.desktopColor]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void window.calendar.desktopStatus().then((next) =>
        setStatus((prev) =>
          prev?.mode === next.mode && prev?.visible === next.visible
            ? prev
            : next,
        ),
      );
    };
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <h3>桌面日历</h3>
      <p className="muted-text">
        把月历和日程清单留在桌面。主窗口收起后，面板仍可查看和打开日程。
      </p>
      <label className="setting-row">
        <div>
          <b>开启桌面日历</b>
          <p>启动飞历时恢复，也可从托盘右键菜单开关</p>
        </div>
        <input
          type="checkbox"
          aria-label="开启桌面日历"
          checked={settings.desktopEnabled}
          onChange={(event) =>
            void configure({ desktopEnabled: event.target.checked })
          }
        />
      </label>
      {settings.desktopEnabled && (
        <p className="muted-text">
          {status?.mode === "embedded"
            ? "已嵌入 Windows 桌面"
            : status?.mode === "floating"
              ? settings.desktopMode === "embedded"
                ? "当前桌面环境使用独立面板，系统桌面恢复后会重新尝试嵌入"
                : "当前使用浮动面板"
              : "正在打开桌面日历…"}
          {status?.mode !== "off" && !status?.visible ? " · 已暂时隐藏" : ""}
        </p>
      )}
      <label className="setting-row">
        <div>
          <b>显示内容</b>
        </div>
        <select
          aria-label="桌面显示内容"
          value={settings.desktopView}
          onChange={(event) =>
            void configure({
              desktopView: event.target.value as Settings["desktopView"],
            })
          }
        >
          <option value="month">月历与当日日程</option>
          <option value="agenda">未来两周日程清单</option>
          <option value="grid">大月历，日期格内显示日程</option>
        </select>
      </label>
      <label className="setting-row">
        <b>窗口模式</b>
        <select
          aria-label="桌面窗口模式"
          value={settings.desktopMode}
          onChange={(event) =>
            void configure({
              desktopMode: event.target.value as Settings["desktopMode"],
            })
          }
        >
          <option value="embedded">嵌入桌面</option>
          <option value="floating">普通浮窗</option>
          <option value="topmost">始终置顶浮窗</option>
        </select>
      </label>
      <label className="setting-row">
        <b>显示器</b>
        <select
          aria-label="桌面显示器"
          value={settings.desktopDisplay}
          onChange={(event) =>
            void configure({ desktopDisplay: event.target.value })
          }
        >
          <option value="">主显示器</option>
          {displays.map((display) => (
            <option key={display.id} value={display.id}>
              {display.label}
            </option>
          ))}
        </select>
      </label>
      <label className="setting-row">
        <b>桌面字号</b>
        <input
          aria-label="桌面字号"
          type="number"
          min={11}
          max={22}
          value={settings.desktopFontSize}
          onChange={(event) =>
            void configure({ desktopFontSize: Number(event.target.value) })
          }
        />
      </label>
      <label className="setting-row">
        <b>日程行间距</b>
        <input
          aria-label="日程行间距"
          type="number"
          min={2}
          max={18}
          value={settings.desktopRowGap}
          onChange={(event) =>
            void configure({ desktopRowGap: Number(event.target.value) })
          }
        />
      </label>
      <label className="setting-row">
        <b>大月历每格日程数</b>
        <input
          aria-label="每格日程数"
          type="number"
          min={1}
          max={12}
          value={settings.desktopMaxEvents}
          onChange={(event) =>
            void configure({ desktopMaxEvents: Number(event.target.value) })
          }
        />
      </label>
      <details>
        <summary>桌面显示的日历</summary>
        <label className="setting-row">
          <span>跟随主窗口</span>
          <input
            type="checkbox"
            checked={settings.desktopCalendarIds === null}
            onChange={(event) =>
              void configure({
                desktopCalendarIds: event.target.checked
                  ? null
                  : calendars
                      .filter((item) => item.visible)
                      .map((item) => item.id),
              })
            }
          />
        </label>
        {settings.desktopCalendarIds !== null &&
          calendars.map((calendar) => (
            <label className="setting-row" key={calendar.id}>
              <span>{calendar.name}</span>
              <input
                type="checkbox"
                checked={settings.desktopCalendarIds!.includes(calendar.id)}
                onChange={(event) =>
                  void configure({
                    desktopCalendarIds: event.target.checked
                      ? [...settings.desktopCalendarIds!, calendar.id]
                      : settings.desktopCalendarIds!.filter(
                          (id) => id !== calendar.id,
                        ),
                  })
                }
              />
            </label>
          ))}
      </details>
      <label className="setting-row">
        <div>
          <b>深浅主题</b>
        </div>
        <select
          aria-label="桌面深浅主题"
          value={settings.desktopTheme}
          onChange={(event) =>
            void configure({
              desktopTheme: event.target.value as Settings["desktopTheme"],
            })
          }
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </label>
      <div className="setting-row">
        <div>
          <b>界面颜色</b>
          <p>用于强调色和面板底色</p>
        </div>
        <div className="desktop-colors">
          {[
            "#5474ee",
            "#218c78",
            "#b67a37",
            "#9870c7",
            "#c96d88",
            "#64748b",
          ].map((value) => (
            <button
              key={value}
              aria-label={`颜色 ${value}`}
              aria-pressed={settings.desktopColor === value}
              style={{ background: value }}
              onClick={() => void configure({ desktopColor: value })}
            />
          ))}
          <input
            type="color"
            aria-label="自定义桌面颜色"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            onBlur={() => void configure({ desktopColor: color })}
          />
        </div>
      </div>
      <label className="setting-row">
        <div>
          <b>背景不透明度</b>
          <p>数值越小越透明，文字保持清晰</p>
        </div>
        <div className="desktop-opacity">
          <input
            type="range"
            min="0"
            max="100"
            aria-label="桌面背景不透明度"
            value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
            onPointerUp={(event) =>
              void configure({
                desktopOpacity: Number(event.currentTarget.value),
              })
            }
            onKeyUp={(event) =>
              void configure({
                desktopOpacity: Number(event.currentTarget.value),
              })
            }
          />
          <output>{opacity}%</output>
        </div>
      </label>
      <label className="setting-row">
        <div>
          <b>锁定位置和大小</b>
          <p>解锁后拖动标题栏移动，拖动右下角调整大小</p>
        </div>
        <input
          type="checkbox"
          aria-label="锁定桌面日历位置"
          checked={settings.desktopLocked}
          onChange={(event) =>
            void configure({ desktopLocked: event.target.checked })
          }
        />
      </label>
      <div className="form-actions">
        <button
          className="secondary"
          disabled={!settings.desktopEnabled}
          onClick={() => void window.calendar.desktop("reset")}
        >
          重置位置和大小
        </button>
        <button
          className="primary"
          onClick={() => void window.calendar.desktop("show")}
        >
          显示桌面日历
        </button>
      </div>
    </>
  );
}
