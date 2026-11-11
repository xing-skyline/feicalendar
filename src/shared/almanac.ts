import { Solar, Lunar } from "lunar-javascript";
import bundled from "../../data/holidays.json";
import type {
  AppSnapshot,
  HolidayData,
  SpecialDate,
  CalendarEvent,
  DateRange,
} from "./types";
import { dateKey, shiftDate } from "./dates";

export const bundledHolidays = bundled as HolidayData;
const cache = new Map<
  string,
  { lunar: string; term: string; festival: string }
>();

export function almanac(day: string) {
  let value = cache.get(day);
  if (!value) {
    const [year, month, date] = day.split("-").map(Number);
    const solar = Solar.fromYmd(year, month, date);
    const lunar = solar.getLunar();
    value = {
      lunar:
        lunar.getDay() === 1
          ? `${lunar.getMonthInChinese()}月`
          : lunar.getDayInChinese(),
      term: lunar.getJieQi(),
      festival: [...lunar.getFestivals(), ...solar.getFestivals()].join(" · "),
    };
    if (cache.size > 3000) cache.clear();
    cache.set(day, value);
  }
  return value;
}

export function holiday(
  day: string,
  state: Pick<AppSnapshot, "holidayData" | "holidayOverrides">,
) {
  const custom = state.holidayOverrides?.[day];
  if (custom) return { ...custom, custom: true };
  const year = (state.holidayData || bundledHolidays).years[day.slice(0, 4)];
  if (!year) return undefined;
  if (year.workdays.includes(day))
    return { name: "调休上班", work: true, custom: false };
  const item = year.holidays.find(
    (item) => item.start <= day && item.end >= day,
  );
  return item ? { name: item.name, work: false, custom: false } : undefined;
}

export function isWorkday(
  day: string,
  state: Pick<AppSnapshot, "holidayData" | "holidayOverrides">,
) {
  const specified = holiday(day, state);
  if (specified) return specified.work;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export function nextSpecialDate(
  item: SpecialDate,
  from = dateKey(new Date()),
): string | undefined {
  const [originalYear, month, day] = item.date.split("-").map(Number);
  const firstYear = item.yearly
    ? item.lunar
      ? Solar.fromYmd(
          ...(from.split("-").map(Number) as [number, number, number]),
        )
          .getLunar()
          .getYear()
      : Number(from.slice(0, 4))
    : originalYear;
  for (
    let year = firstYear;
    year < firstYear + (item.yearly ? 30 : 1);
    year++
  ) {
    let result: string;
    if (item.lunar) {
      try {
        result = Lunar.fromYmd(year, item.leapMonth ? -month : month, day)
          .getSolar()
          .toYmd();
      } catch {
        // A lunar month may have 29 days. Use its last day for a day-30 anniversary.
        try {
          if (day !== 30) continue;
          result = Lunar.fromYmd(year, item.leapMonth ? -month : month, 29)
            .getSolar()
            .toYmd();
        } catch {
          continue;
        }
      }
    } else {
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      result = `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
    }
    if (!item.yearly || result >= from) return result;
  }
  return undefined;
}

export function validateSpecialDate(item: SpecialDate) {
  const [year, month, day] = item.date.split("-").map(Number);
  if (item.lunar) {
    try {
      Lunar.fromYmd(year, item.leapMonth ? -month : month, day);
    } catch {
      throw new Error("填写的农历日期或闰月不存在，请检查年月日");
    }
  } else if (dateKey(`${item.date}T12:00:00+08:00`) !== item.date)
    throw new Error("填写的公历日期不存在");
}

export function daysUntil(day: string, from = dateKey(new Date())) {
  return Math.round(
    (new Date(`${day}T00:00:00Z`).getTime() -
      new Date(`${from}T00:00:00Z`).getTime()) /
      86400_000,
  );
}

export function specialEvents(
  state: AppSnapshot,
  range: DateRange,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const item of state.specialDates || []) {
    let day = nextSpecialDate(item, dateKey(range.start));
    for (let count = 0; day && day < dateKey(range.end) && count < 4; count++) {
      if (day >= dateKey(range.start))
        events.push({
          id: `special:${item.id}:${day}`,
          calendarId: "special-dates",
          title: item.title,
          start: day,
          end: shiftDate(day, 1),
          allDay: true,
          description: item.lunar ? "农历纪念日" : "纪念日与倒数日",
          location: "",
          reminder: item.remindDays < 0 ? -1 : item.remindDays * 1440,
          recurrence: "",
          completed: false,
          syncState: "local",
        });
      if (!item.yearly) break;
      day = nextSpecialDate(item, shiftDate(day, 1));
    }
  }
  return events;
}
