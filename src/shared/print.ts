import type { AppSnapshot, PrintOptions } from "./types";
import { dateKey, inputTime, shiftDate, teachingWeek, overlaps } from "./dates";
import { expandCalendarEvents } from "./occurrences";
import { almanac } from "./almanac";

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

export function calendarPrintHtml(
  state: AppSnapshot,
  options: PrintOptions,
): string {
  const month = options.view === "month";
  const anchor = month ? `${options.date.slice(0, 7)}-01` : options.date;
  const offset =
    (new Date(`${anchor}T00:00:00Z`).getUTCDay() -
      state.settings.weekStartsOn +
      7) %
    7;
  const start = shiftDate(anchor, -offset);
  const end = shiftDate(start, month ? 42 : 7);
  const events = expandCalendarEvents(state, { start, end })
    .filter(
      (event) =>
        options.calendarIds.includes(event.calendarId) &&
        (options.view !== "course" || Boolean(event.courseId)),
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const label =
    options.view === "course" ? "课程周表" : month ? "月历" : "周历";
  const headings = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat("zh-CN", {
      weekday: "long",
      timeZone: "UTC",
    }).format(new Date(`${shiftDate(start, index)}T00:00:00Z`)),
  );
  const rows = Array.from(
    { length: month ? 6 : 1 },
    (_, week) =>
      `<tr>${Array.from({ length: 7 }, (_, index) => {
        const day = shiftDate(start, week * 7 + index);
        const teaching = teachingWeek(
          day,
          state.settings.teachingStartDate,
          state.settings.teachingWeeks,
          state.settings.weekStartsOn,
        );
        const lunar = state.settings.showLunar ? almanac(day).lunar : "";
        const items = events
          .filter((event) =>
            overlaps(event.start, event.end, {
              start: `${day}T00:00:00+08:00`,
              end: `${shiftDate(day, 1)}T00:00:00+08:00`,
            }),
          )
          .map(
            (event) =>
              `<article><b>${event.allDay ? "全天" : escapeHtml(inputTime(event.start).slice(11))} ${escapeHtml(event.title)}</b>${options.details && event.location ? `<p>${escapeHtml(event.location)}</p>` : ""}${options.details && event.description ? `<p>${escapeHtml(event.description)}</p>` : ""}</article>`,
          )
          .join("");
        return `<td><header>${day.slice(5)} <small>${escapeHtml(lunar)}${teaching && index === 0 ? ` · 第${teaching}周` : ""}</small></header>${items}</td>`;
      }).join("")}</tr>`,
  ).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>飞历${label}</title><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:"Microsoft YaHei",sans-serif;color:#1d2639;margin:0;font-size:11px}h1{font-size:22px;margin:0 0 8px}p{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere}.caption{color:#5c6678;margin-bottom:12px}table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#edf1fb;padding:7px}td,th{border:1px solid #bcc6d7}td{vertical-align:top;height:${month ? "24mm" : "135mm"};padding:5px;overflow-wrap:anywhere}td header{font-weight:bold;margin-bottom:5px}small{font-weight:normal;color:#677180}article{border-left:2px solid #5474ee;padding-left:5px;margin:5px 0;break-inside:avoid}tr{break-inside:avoid}</style></head><body><h1>${escapeHtml(options.date.slice(0, month ? 7 : 10))} ${label}</h1><p class="caption">${escapeHtml(
    state.calendars
      .filter((calendar) => options.calendarIds.includes(calendar.id))
      .map((calendar) => calendar.name)
      .join(" · "),
  )} · 生成于 ${dateKey(new Date())}</p><table><thead><tr>${headings.map((day) => `<th>${day}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}
