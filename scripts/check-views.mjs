import { expect } from "@playwright/test";
import path from "node:path";

export async function checkCalendarViews(page, screenshotDirectory, prefix) {
  const dismiss = page.getByLabel("关闭提示", { exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  const views = [
    { name: "日视图", id: "timeGridDay", columns: 1, screenshot: "day" },
    { name: "三日视图", id: "timeGridThreeDay", columns: 3 },
    { name: "周视图", id: "timeGridWeek", columns: 7, screenshot: "week" },
    { name: "月视图", id: "dayGridMonth", screenshot: "month" },
    { name: "年视图", id: "multiMonthYear" },
    { name: "日程列表", id: "listMonth" },
  ];
  for (const view of views) {
    const tab = page.getByRole("tab", { name: view.name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(`.fc-${view.id}-view`)).toBeVisible();
    await expect(page.locator(".fc-view")).toHaveCount(1);
    if (view.columns) {
      await expect(page.locator(".fc-daygrid-day-number")).toHaveCount(0);
      await expect(
        page.locator(".fc-timegrid-body .fc-timegrid-col[data-date]"),
      ).toHaveCount(view.columns);
      await expect(page.locator(".fc-timegrid-slot-label")).toHaveCount(48);
      await expect(page.locator(".fc-timegrid-slot-label-cushion")).toHaveCount(
        24,
      );
    }
    if (view.id === "dayGridMonth") {
      await expect(page.locator(".fc-daygrid-day[data-date]")).toHaveCount(42);
      await expect(page.locator(".fc-daygrid-body tbody > tr")).toHaveCount(6);
    }
    if (view.id === "multiMonthYear") {
      await expect(page.locator(".fc-multimonth-month")).toHaveCount(12);
    }
    if (view.id === "listMonth") {
      await expect(page.locator(".fc-list-event").first()).toBeVisible();
    }
    if (view.screenshot) {
      await page.screenshot({
        path: path.join(
          screenshotDirectory,
          `${prefix}-${view.screenshot}.png`,
        ),
        animations: "disabled",
      });
    }
  }
  // A month date opens the corresponding day, including its persisted view choice.
  await page.getByRole("tab", { name: "月视图", exact: true }).click();
  const dateCell = page.locator(".fc-daygrid-day.fc-day-today");
  const date = await dateCell.getAttribute("data-date");
  await dateCell.locator(".fc-daygrid-day-number").click();
  await expect(
    page.getByRole("tab", { name: "日视图", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.locator(".fc-timegrid-body .fc-timegrid-col[data-date]"),
  ).toHaveAttribute("data-date", date);
  await page.getByRole("tab", { name: "周视图", exact: true }).click();
  // A keyboard selection must switch the actual grid as well as the tab state.
  await page
    .getByRole("tab", { name: "周视图", exact: true })
    .press("ArrowRight");
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible();
  await expect
    .poll(async () => {
      const snapshot = await page.evaluate(() => window.calendar.snapshot());
      return snapshot.settings.calendarView;
    })
    .toBe("dayGridMonth");
}
