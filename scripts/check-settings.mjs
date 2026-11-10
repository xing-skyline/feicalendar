import { expect } from "@playwright/test";
import path from "node:path";

export async function checkCalendarSettings(page, screenshotDirectory, prefix) {
  await page.getByTitle("设置", { exact: true }).click();
  await expect(
    page.getByLabel("关闭窗口后最小化到托盘", { exact: true }),
  ).toBeChecked();
  await page.getByLabel("新日程默认时长", { exact: true }).selectOption("90");
  await page.getByLabel("新日程默认提醒", { exact: true }).selectOption("15");
  await page.getByRole("button", { name: "日历显示", exact: true }).click();
  await page.getByLabel("每周起始日", { exact: true }).selectOption("0");
  await page.getByLabel("时间格式", { exact: true }).selectOption("12");
  await page.getByLabel("显示开始时间", { exact: true }).selectOption("8");
  await page.getByLabel("显示结束时间", { exact: true }).selectOption("18");
  await page.getByRole("button", { name: "教学周", exact: true }).click();
  await expect(
    page.getByLabel("第一教学周的日期", { exact: true }),
  ).toHaveValue("");
  const firstWeekDate = await page.evaluate(() => {
    const previousWeek = new Date(Date.now() - 7 * 86400_000);
    return previousWeek.toLocaleDateString("en-CA", {
      timeZone: "Asia/Shanghai",
    });
  });
  await page
    .getByLabel("第一教学周的日期", { exact: true })
    .fill(firstWeekDate);
  await page.getByLabel("教学周总数", { exact: true }).fill("3");
  await page
    .getByRole("button", { name: "保存教学周设置", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.calendar.snapshot())).settings
          .teachingWeeks,
    )
    .toBe(3);
  await page.screenshot({
    path: path.join(screenshotDirectory, `${prefix}-teaching-settings.png`),
    animations: "disabled",
  });
  await page.getByLabel("关闭设置", { exact: true }).click();
  await page.getByRole("button", { name: "今天", exact: true }).click();
  await page.getByRole("tab", { name: "周视图", exact: true }).click();
  await expect(page.locator(".mini-weekday").first()).toHaveText("日");
  await expect(page.locator(".fc-col-header-cell").first()).toContainText(
    "周日",
  );
  await expect(page.getByLabel("当前教学周", { exact: true })).toContainText(
    "教学第 2 周",
  );
  const slots = page.locator(".fc-timegrid-slot-lane");
  await expect(slots).toHaveCount(20);
  await expect(slots.first()).toHaveAttribute("data-time", "08:00:00");
  await expect(slots.last()).toHaveAttribute("data-time", "17:30:00");
  await expect(
    page.locator(".fc-timegrid-slot-label-cushion").first(),
  ).toContainText(/上午|AM|am/);
  await page.getByTitle("上一时段", { exact: true }).click();
  await expect(page.getByLabel("当前教学周", { exact: true })).toContainText(
    "教学第 1 周",
  );
  await page.getByTitle("上一时段", { exact: true }).click();
  await expect(page.getByLabel("当前教学周", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "今天", exact: true }).click();
  await page.getByTitle("下一时段", { exact: true }).click();
  await expect(page.getByLabel("当前教学周", { exact: true })).toContainText(
    "教学第 3 周",
  );
  await page.getByTitle("下一时段", { exact: true }).click();
  await expect(page.getByLabel("当前教学周", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "今天", exact: true }).click();
  await page
    .getByRole("button", { name: "新建日程", exact: false })
    .first()
    .click();
  await checkNewEventDefaults(page);
  await page.getByLabel("关闭日程", { exact: true }).click();
  await page
    .locator('.fc-timegrid-slot-lane[data-time="12:00:00"]')
    .click({ position: { x: 30, y: 10 } });
  await checkNewEventDefaults(page);
  await page.getByLabel("关闭日程", { exact: true }).click();
  await page.getByRole("tab", { name: "月视图", exact: true }).click();
  const weekNumbers = page.locator(".fc-daygrid-week-number");
  await expect(weekNumbers.filter({ hasText: "第 2 周" })).toBeVisible();
  expect(
    (await weekNumbers.allTextContents()).filter((text) => text.trim()),
  ).not.toContain("第 4 周");
  await page.screenshot({
    path: path.join(screenshotDirectory, `${prefix}-teaching-month.png`),
    animations: "disabled",
  });
}

async function checkNewEventDefaults(page) {
  await expect(
    page.getByRole("dialog", { name: "新建日程", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("提醒时间", { exact: true })).toHaveValue("15");
  const start = await page.getByLabel("开始时间", { exact: true }).inputValue();
  const end = await page.getByLabel("结束时间", { exact: true }).inputValue();
  expect(new Date(end).getTime() - new Date(start).getTime()).toBe(90 * 60_000);
}
