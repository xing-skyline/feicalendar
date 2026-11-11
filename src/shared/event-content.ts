import type { CalendarEvent } from "./types";

export function eventContent(event?: CalendarEvent): string {
  if (!event || event.deleted) return "";
  return JSON.stringify({
    calendarId: event.calendarId,
    title: event.title,
    start: event.allDay ? event.start : new Date(event.start).toISOString(),
    end: event.allDay ? event.end : new Date(event.end).toISOString(),
    allDay: event.allDay,
    location: event.location,
    description: event.description,
    recurrence: event.recurrence,
    exceptions: event.exceptions || [],
    reminder: event.reminder,
    completed: event.completed,
    taskId: event.taskId,
    courseId: event.courseId,
    courseWeek: event.courseWeek,
  });
}
