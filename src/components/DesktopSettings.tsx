import { useEffect, useState } from "react";
import type { Settings } from "../shared/types";

export default function DesktopSettings({
  settings,
  configure,
}: {
  settings: Settings;
  configure: (patch: Partial<Settings>) => Promise<void>;
}) {
  const [status, setStatus] =
    useState<Awaited<ReturnType<typeof window.calendar.desktopStatus>>>();
  const [opacity, setOpacity] = useState(settings.desktopOpacity);
  const [color, setColor] = useState(settings.desktopColor);
  useEffect(
    () => setOpacity(settings.desktopOpacity),
    [settings.desktopOpacity],
  );
  useEffect(() => setColor(settings.desktopColor), [settings.desktopColor]);
  useEffect(() => {
    const refresh = () => {
      void window.calendar.desktopStatus().then(setStatus);
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
              ? "当前桌面环境使用独立面板，系统桌面恢复后会重新尝试嵌入"
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
        </select>
      </label>
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
