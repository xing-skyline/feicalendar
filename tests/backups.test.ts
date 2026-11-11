import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../electron/store";
import { encryptBackup, decryptBackup, planRestore } from "../electron/backups";
import { eventDraft } from "../src/shared/capture";

test("Encrypted backups authenticate the full payload and reject wrong passwords", async () => {
  const state = emptyState();
  state.events = [{ ...eventDraft(state), id: "one", title: "私密测试日程" }];
  const encrypted = await encryptBackup(state, "test-password-123");
  assert.ok(!encrypted.includes("私密测试日程"));
  assert.equal(
    (await decryptBackup(encrypted, "test-password-123")).events[0].title,
    "私密测试日程",
  );
  await assert.rejects(
    decryptBackup(encrypted, "incorrect-password"),
    /密码不正确/,
  );
  const envelope = JSON.parse(encrypted);
  envelope.data =
    (envelope.data.startsWith("A") ? "B" : "A") + envelope.data.slice(1);
  await assert.rejects(
    decryptBackup(JSON.stringify(envelope), "test-password-123"),
    /文件已损坏/,
  );
});

test("Restore previews distinguish changes and cloud scope and omit deletion by default", () => {
  const current = emptyState();
  current.events = [
    { ...eventDraft(current), id: "one", title: "当前" },
    { ...eventDraft(current), id: "two", title: "保留" },
  ];
  const backup = structuredClone(current);
  backup.events = [
    { ...current.events[0], title: "旧标题" },
    { ...current.events[0], id: "three", title: "恢复" },
  ];
  const plan = planRestore(current, backup, {
    includeCloud: false,
    deleteMissing: false,
  });
  assert.deepEqual(
    plan.changes.map((item) => item.action),
    ["update", "create"],
  );
  assert.equal(
    planRestore(current, backup, {
      includeCloud: false,
      deleteMissing: true,
    }).changes.filter((item) => item.action === "delete").length,
    1,
  );
});
