import { createHash, randomUUID } from "node:crypto";
import { parseSubscription } from "./subscriptions";
import type {
  AppSnapshot,
  CalendarEvent,
  DateRange,
  ImportPreview,
} from "../src/shared/types";

function identity(event: CalendarEvent) {
  return JSON.stringify([
    event.calendarId,
    event.title.trim(),
    new Date(event.start).getTime(),
    new Date(event.end).getTime(),
    event.allDay,
  ]);
}

export class CalendarImports {
  private pending?: { preview: ImportPreview; at: number };
  async preview(
    text: string,
    calendarId: string,
    range: DateRange,
    state: AppSnapshot,
  ): Promise<ImportPreview> {
    if (text.length > 20_000_000) throw new Error("ICS 文件超过 20 MB");
    const parsed = await parseSubscription(text, calendarId, range);
    if (parsed.length > 10000)
      throw new Error("导入超过 10000 项，请缩小日期范围");
    const existing = new Set(
      state.events.filter((event) => !event.deleted).map(identity),
    );
    const events = parsed.map((event) => {
      const key = identity(event);
      const id = `import:${createHash("sha256").update(event.id).digest("hex")}`;
      const duplicate =
        existing.has(key) ||
        state.events.some((item) => item.id === id && !item.deleted);
      existing.add(key);
      return {
        event: { ...event, id, recurring: false, syncState: "local" as const },
        duplicate,
      };
    });
    const preview = { token: randomUUID(), events };
    this.pending = { preview, at: Date.now() };
    return preview;
  }
  selected(token: string, ids: string[], state: AppSnapshot): CalendarEvent[] {
    if (
      !this.pending ||
      this.pending.preview.token !== token ||
      Date.now() - this.pending.at > 30 * 60_000
    )
      throw new Error("导入预览已过期，请重新选择文件");
    const selected = new Set(ids);
    const known = new Set(
      state.events.filter((event) => !event.deleted).map(identity),
    );
    return this.pending.preview.events
      .filter(
        ({ event, duplicate }) =>
          selected.has(event.id) &&
          !duplicate &&
          !known.has(identity(event)) &&
          !state.events.some(
            (current) => current.id === event.id && !current.deleted,
          ),
      )
      .map(({ event }) => structuredClone(event));
  }
}
