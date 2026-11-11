import type { AppSnapshot } from "../shared/types";
import { almanac, holiday } from "../shared/almanac";

export default function DayLabel({
  day,
  snapshot,
}: {
  day: string;
  snapshot: AppSnapshot;
}) {
  const value = almanac(day);
  const special = snapshot.settings.showHolidays
    ? holiday(day, snapshot)
    : undefined;
  const label =
    (snapshot.settings.showSolarTerms && value.term) ||
    (snapshot.settings.showHolidays && value.festival) ||
    (snapshot.settings.showLunar && value.lunar);
  return (
    <span
      className="day-label"
      title={[value.lunar, value.term, value.festival, special?.name]
        .filter(Boolean)
        .join(" · ")}
    >
      {label && <small>{label}</small>}
      {special && (
        <i className={special.work ? "workday" : "holiday"}>
          {special.work ? "班" : "休"}
        </i>
      )}
    </span>
  );
}
