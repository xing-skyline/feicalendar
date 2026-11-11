import type { AppSnapshot, Course, Semester } from "./types";
import { shiftDate } from "./dates";
import { eventDraft } from "./capture";

export function validateSemester(value: Semester) {
  const names = new Set(value.periods.map((period) => period.id));
  if (!value.periods.length || names.size !== value.periods.length)
    throw new Error("节次不能为空，且每个节次需要唯一标识");
  for (const [index, period] of value.periods.entries()) {
    if (
      period.start >= period.end ||
      (index > 0 && value.periods[index - 1].end > period.start)
    )
      throw new Error("节次需要按时间先后排列，各节次不能重叠");
  }
}

export function courseEvents(state: AppSnapshot, course: Course) {
  const semester = state.semesters?.find(
    (semester) => semester.id === course.semesterId,
  );
  if (!semester) throw new Error("请先选择学期");
  const first = semester.periods.findIndex(
    (period) => period.id === course.firstPeriod,
  );
  const last = semester.periods.findIndex(
    (period) => period.id === course.lastPeriod,
  );
  if (first < 0 || last < first) throw new Error("请检查课程起止节次");
  const offset =
    (new Date(`${semester.startDate}T00:00:00Z`).getUTCDay() -
      semester.weekStartsOn +
      7) %
    7;
  const firstDay = shiftDate(semester.startDate, -offset);
  return [...new Set(course.weeks)]
    .sort((a, b) => a - b)
    .map((week) => {
      if (week < 1 || week > semester.weeks)
        throw new Error("课程教学周超出了学期范围");
      const override = course.exceptions[String(week)];
      if (override?.cancelled) return undefined;
      const day = shiftDate(
        firstDay,
        (week - 1) * 7 + ((course.weekday - semester.weekStartsOn + 7) % 7),
      );
      const start =
        override?.start || `${day}T${semester.periods[first].start}:00+08:00`;
      const end =
        override?.end || `${day}T${semester.periods[last].end}:00+08:00`;
      if (new Date(end) <= new Date(start))
        throw new Error("调课结束时间必须晚于开始时间");
      return {
        ...eventDraft(state, start, end),
        id: `course:${course.id}:${week}`,
        calendarId: course.calendarId,
        title: override?.title ?? course.title,
        location: override?.location ?? course.location,
        description: override?.description ?? course.description,
        courseId: course.id,
        courseWeek: week,
      };
    })
    .filter((event) => event !== undefined);
}
