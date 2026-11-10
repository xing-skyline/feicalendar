import { expect } from "@playwright/test";
import path from "node:path";

export async function checkSyncConnections(page, screenshotDirectory, prefix) {
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: "日历连接", exact: true }).click();
  await page.getByRole("button", { name: "添加连接", exact: true }).click();
  await page.getByLabel("服务预设", { exact: true }).selectOption("4");
  await expect(page.getByLabel("订阅方式", { exact: true })).toHaveValue(
    "webdav",
  );
  await expect(page.getByLabel("订阅地址", { exact: true })).toHaveValue(
    "https://dav.jianguoyun.com/dav/",
  );
  await expect(
    page.getByLabel("同步教学周配置", { exact: true }),
  ).toBeChecked();
  await page.screenshot({
    path: path.join(screenshotDirectory, `${prefix}-webdav-settings.png`),
  });
  await page.getByLabel("服务预设", { exact: true }).selectOption("1");
  await expect(page.getByLabel("订阅方式", { exact: true })).toHaveValue(
    "caldav",
  );
  await expect(
    page.getByLabel("以只读方式连接", { exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(async () => {
    await window.calendar.settings({ autoSync: false });
    for (const connection of [
      {
        id: "ui-caldav",
        kind: "caldav",
        name: "测试日历服务",
        url: "https://calendar.example.invalid/",
      },
      {
        id: "ui-webdav-a",
        kind: "webdav",
        name: "测试网盘甲",
        url: "https://cloud-a.example.invalid/",
      },
      {
        id: "ui-webdav-b",
        kind: "webdav",
        name: "测试网盘乙",
        url: "https://cloud-b.example.invalid/",
      },
    ]) {
      await window.calendar.saveConnection({
        ...connection,
        username: "fixture-user",
        password: "fixture-secret",
        enabled: false,
      });
    }
  });
  for (const name of ["测试日历服务", "测试网盘甲", "测试网盘乙"]) {
    const toggle = page.getByLabel(`启用 ${name}`, { exact: true });
    await toggle.click();
    await expect(toggle).toBeChecked();
  }
  await page.getByLabel("启用 测试网盘甲", { exact: true }).click();
  await expect(page.getByLabel("启用 测试网盘甲", { exact: true })).not.toBeChecked();
  await expect(
    page.getByLabel("启用 测试日历服务", { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel("启用 测试网盘乙", { exact: true }),
  ).toBeChecked();
  const connections = await page.evaluate(
    async () => (await window.calendar.snapshot()).connections,
  );
  expect(connections).toHaveLength(3);
  expect(connections.filter((item) => item.enabled)).toHaveLength(2);
  expect(connections.every((item) => item.hasPassword && !item.password)).toBe(
    true,
  );
  await page.screenshot({
    path: path.join(screenshotDirectory, `${prefix}-multiple-connections.png`),
  });
  await page.evaluate(async () => {
    for (const id of ["ui-caldav", "ui-webdav-a", "ui-webdav-b"])
      await window.calendar.removeConnection(id);
    await window.calendar.settings({ autoSync: true });
  });
  await page.getByLabel("关闭设置", { exact: true }).click();
}
