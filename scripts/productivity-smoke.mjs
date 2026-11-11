import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const root = process.cwd();
const directory = await mkdtemp(
  path.join(os.tmpdir(), "feicalendar-productivity-"),
);
const env = {
  ...process.env,
  FEICALENDAR_DATA_DIR: directory,
  FEICALENDAR_DISABLE_NOTIFICATIONS: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await electron.launch({
    args: [path.join(root, "scripts/fixtures/productivity-launch.cjs")],
    cwd: root,
    env,
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByRole("heading", { name: "我的日历" })).toBeVisible();
  await page.getByTitle("快捷录入", { exact: true }).click();
  await expect
    .poll(() =>
      application.windows().some((item) => item.url().endsWith("#capture")),
    )
    .toBe(true);
  const capture = application
    .windows()
    .find((item) => item.url().endsWith("#capture"));
  capture.on("pageerror", (error) => errors.push(error.message));
  await capture
    .getByLabel("一句话安排日程")
    .fill("明天下午两点快捷录入验证，持续一小时");
  await capture.getByRole("button", { name: "识别时间", exact: true }).click();
  await expect(capture.getByLabel("快捷日程标题")).toHaveValue("快捷录入验证");
  await capture.getByRole("button", { name: "添加日程", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.calendar.snapshot())).events.length,
    )
    .toBe(1);
  await page.getByLabel("搜索日程", { exact: true }).fill("快捷录入验证");
  await page.locator(".search-result").first().click();
  await page.getByRole("button", { name: "存为模板" }).click();
  await page.getByLabel("模板名称").fill("会议模板");
  await page.getByRole("button", { name: "保存模板", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存模板");
  await page.locator(".local-reminders summary").click();
  await page.getByLabel("使用自定义本机提醒").check();
  await page.getByLabel("提前一天", { exact: true }).check();
  await page.getByRole("button", { name: "保存本机提醒" }).click();
  await expect
    .poll(
      async () =>
        Object.values(
          (await page.evaluate(() => window.calendar.snapshot()))
            .reminderRules || {},
        )[0],
    )
    .toEqual([1440, 10]);
  await page.getByTitle("删除日程", { exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await page.getByLabel("关闭搜索", { exact: true }).click();
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: "回收站与备份", exact: true }).click();
  await page.getByRole("button", { name: "恢复日程", exact: true }).click();
  await expect(page.getByText("回收站为空。", { exact: true })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.calendar.snapshot())).events.filter(
          (item) => !item.deleted,
        ).length,
    )
    .toBe(1);
  await page.getByRole("button", { name: "桌面日历", exact: true }).click();
  await page.getByLabel("桌面显示内容").selectOption("grid");
  await page.getByLabel("开启桌面日历", { exact: true }).click();
  await expect(page.getByLabel("开启桌面日历", { exact: true })).toBeChecked();
  await expect
    .poll(() =>
      application.windows().some((item) => item.url().endsWith("#desktop")),
    )
    .toBe(true);
  const panel = application
    .windows()
    .find((item) => item.url().endsWith("#desktop"));
  panel.on("pageerror", (error) => errors.push(error.message));
  await expect(panel.locator(".desktop-grid-day")).toHaveCount(42);
  await panel.getByRole("button", { name: /快捷录入验证/ }).click();
  await panel.getByLabel("日程标题", { exact: true }).fill("桌面直接编辑验证");
  await panel.getByRole("button", { name: "保存日程", exact: true }).click();
  await expect(panel.getByRole("dialog")).toHaveCount(0);
  await panel.getByLabel("完成 桌面直接编辑验证", { exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.calendar.snapshot())).events[0]
          .completed,
    )
    .toBe(true);
  const old = (await page.evaluate(() => window.calendar.snapshot())).events[0];
  await page.evaluate(
    async (event) =>
      window.calendar.saveEvent({ event: { ...event, title: "可撤销修改" } }),
    old,
  );
  await page.evaluate(() => window.calendar.undoChange());
  expect(
    (await page.evaluate(() => window.calendar.snapshot())).events[0].title,
  ).toBe("桌面直接编辑验证");
  await page.getByRole("button", { name: "学期与课程", exact: true }).click();
  await page.getByRole("button", { name: "新建学期", exact: true }).click();
  await page.getByLabel("学期名称", { exact: true }).fill("测试学期");
  await page.getByLabel("教学周数", { exact: true }).fill("4");
  await page.getByRole("button", { name: "保存学期", exact: true }).click();
  await page.getByRole("button", { name: "新建课程安排", exact: true }).click();
  await page.getByLabel("课程名称", { exact: true }).fill("课程界面验证");
  await page.getByRole("button", { name: "双周", exact: true }).click();
  await page
    .getByRole("button", { name: "保存课程并更新日历", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.calendar.snapshot())).events.filter(
          (event) => event.courseId,
        ).length,
    )
    .toBe(2);
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByTitle("待办清单", { exact: true }).click();
  await page.getByRole("button", { name: "新建待办", exact: true }).click();
  await page.getByLabel("待办标题", { exact: true }).fill("待办拖入验证");
  await page.getByLabel("待办预计时长", { exact: true }).fill("45");
  await page.getByRole("button", { name: "保存待办", exact: true }).click();
  await expect(page.locator(".task-drag-handle")).toBeVisible();
  const lane = page.locator('.fc-timegrid-slot-lane[data-time="09:00:00"]');
  await lane.scrollIntoViewIfNeeded();
  await page.locator(".task-drag-handle").dragTo(lane);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.calendar.snapshot())).events.filter(
          (event) => event.taskId,
        ).length,
    )
    .toBe(1);
  await page.getByTitle("搜索、批量操作、导入与打印", { exact: true }).click();
  await page.getByLabel("高级搜索关键词", { exact: true }).fill("课程界面验证");
  await expect(page.locator(".tools-event")).toHaveCount(2);
  await page.getByRole("button", { name: "打印与 PDF", exact: true }).click();
  const pdfPath = path.join(directory, "calendar.pdf");
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, pdfPath);
  await page.getByRole("button", { name: "保存 PDF", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("calendar.pdf");
  expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe("%PDF-");
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const importPath = path.join(directory, "test.ics");
  await writeFile(
    importPath,
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:ui-import\r\nDTSTART:${today}T020000Z\r\nDTEND:${today}T030000Z\r\nSUMMARY:导入界面验证\r\nEND:VEVENT\r\nEND:VCALENDAR`,
  );
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, importPath);
  await page.getByRole("button", { name: "导入 ICS", exact: true }).click();
  await page
    .getByRole("button", { name: "选择 ICS 并预览", exact: true })
    .click();
  await page
    .getByRole("button", { name: "导入选中 1 项", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.calendar.snapshot())).events.filter(
          (event) => event.title === "导入界面验证",
        ).length,
    )
    .toBe(1);
  await page
    .getByRole("button", { name: "选择 ICS 并预览", exact: true })
    .click();
  await expect(
    page.getByText("1 项，重复 1 项", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭日历工具", exact: true }).click();
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: "回收站与备份", exact: true }).click();
  const backupPath = path.join(directory, "fixture.fcbackup");
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, backupPath);
  await page
    .getByLabel("备份密码", { exact: true })
    .fill("fixture-password-123");
  await page.getByRole("button", { name: "导出加密备份", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已导出加密备份");
  expect(await readFile(backupPath, "utf8")).not.toContain("导入界面验证");
  await page.evaluate(async () => {
    const state = await window.calendar.snapshot();
    const event = state.events.find((item) => item.title === "导入界面验证");
    await window.calendar.saveEvent({
      event: { ...event, title: "恢复前修改" },
    });
  });
  await page
    .getByLabel("备份密码", { exact: true })
    .fill("fixture-password-123");
  await page.getByRole("button", { name: "导入加密备份", exact: true }).click();
  await expect(page.getByLabel("选择恢复快照")).toHaveValue(/import-/);
  await page.getByRole("button", { name: "预览恢复差异", exact: true }).click();
  await expect(page.locator(".restore-change-list")).toContainText(
    "导入界面验证",
  );
  await page
    .getByRole("button", { name: "确认恢复这些日程", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.calendar.snapshot())).events.some(
        (event) => event.title === "导入界面验证",
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
  console.log(
    "PASS quick capture, templates, reminders, encrypted backup restore, desktop editing/completion, undo, semester/course forms, task drag scheduling, advanced search, PDF and deduplicated ICS import through real IPC/UI",
  );
} finally {
  await application?.close();
  await rm(directory, { recursive: true, force: true });
}
