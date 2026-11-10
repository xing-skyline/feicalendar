import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function MiniCalendar({
  month,
  selected,
  onMonth,
  onSelect,
}: {
  month: Date;
  selected: Date;
  onMonth: (date: Date) => void;
  onSelect: (date: Date) => void;
}) {
  const first = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const count =
    Math.ceil(
      (endOfMonth(month).getTime() - first.getTime() + 86400_000) /
        (7 * 86400_000),
    ) * 7;
  return (
    <section className="mini-calendar" aria-label="迷你月历">
      <div className="mini-heading">
        <b>{format(month, "yyyy 年 M 月")}</b>
        <span>
          <button
            className="icon-button"
            title="上一月"
            onClick={() => onMonth(addMonths(month, -1))}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            className="icon-button"
            title="下一月"
            onClick={() => onMonth(addMonths(month, 1))}
          >
            <ChevronRight size={15} />
          </button>
        </span>
      </div>
      <div className="mini-grid">
        {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
          <span className="mini-weekday" key={day}>
            {day}
          </span>
        ))}
        {Array.from({ length: count }, (_, index) => {
          const day = addDays(first, index);
          return (
            <button
              key={day.toISOString()}
              title={format(day, "yyyy-MM-dd")}
              className={[
                !isSameMonth(day, month) ? "muted" : "",
                isSameDay(day, selected) ? "selected" : "",
                isSameDay(day, new Date()) ? "today" : "",
              ].join(" ")}
              onClick={() => onSelect(day)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </section>
  );
}
