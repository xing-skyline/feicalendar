import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
  createHash,
  randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  AppSnapshot,
  BackupOptions,
  BackupPreview,
  CalendarEvent,
  CalendarSource,
} from "../src/shared/types";
import { eventContent } from "./history";

const derive = promisify(scrypt);
const maximum = 50 * 1024 * 1024;

export async function encryptBackup(
  state: AppSnapshot,
  password: string,
): Promise<string> {
  if (password.length < 8 || password.length > 1024)
    throw new Error("备份密码需要 8–1024 个字符");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = (await derive(password, salt, 32)) as Buffer;
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const payload = Buffer.concat([
      cipher.update(JSON.stringify(state), "utf8"),
      cipher.final(),
    ]);
    return JSON.stringify({
      format: "feicalendar-backup",
      version: 1,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: payload.toString("base64"),
    });
  } finally {
    key.fill(0);
  }
}

export async function decryptBackup(
  value: string,
  password: string,
): Promise<AppSnapshot> {
  if (value.length > maximum || password.length > 1024)
    throw new Error("备份文件或密码超出限制");
  const envelope = z
    .object({
      format: z.literal("feicalendar-backup"),
      version: z.literal(1),
      salt: z.string().max(32),
      iv: z.string().max(32),
      tag: z.string().max(32),
      data: z.string().max(maximum),
    })
    .parse(JSON.parse(value));
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16)
    throw new Error("备份文件格式无效");
  const key = (await derive(password, salt, 32)) as Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const content = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return parseBackup(content);
  } catch {
    throw new Error("备份密码不正确，或文件已损坏");
  } finally {
    key.fill(0);
  }
}

export function parseBackup(value: string): AppSnapshot {
  if (value.length > maximum) throw new Error("备份文件超过 50 MB");
  const text = z.string().max(20000);
  const date = z
    .string()
    .max(40)
    .refine((value) => Number.isFinite(new Date(value).getTime()));
  const data = z
    .object({
      version: z.literal(1),
      events: z
        .array(
          z
            .object({
              id: text,
              calendarId: text,
              title: z.string().trim().min(1).max(1000),
              start: date,
              end: date,
              allDay: z.boolean(),
              description: text,
              location: text,
              reminder: z.number().int().min(-1).max(20160),
              recurrence: z.string().max(1000),
              completed: z.boolean(),
              syncState: z.enum([
                "local",
                "synced",
                "pending",
                "error",
                "conflict",
              ]),
              deleted: z.boolean().optional(),
              recurring: z.boolean().optional(),
              exceptions: z.array(date).max(5000).optional(),
            })
            .passthrough()
            .refine((event) => new Date(event.end) > new Date(event.start)),
        )
        .max(100000),
      calendars: z
        .array(
          z
            .object({
              id: text,
              name: z.string().max(100),
              color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
              provider: z.enum([
                "local",
                "feishu",
                "caldav",
                "webdav",
                "ics",
                "google",
                "microsoft",
              ]),
              visible: z.boolean(),
              writable: z.boolean(),
            })
            .passthrough(),
        )
        .max(1000),
      settings: z.object({}).passthrough(),
      connections: z.array(z.unknown()),
      queue: z.array(z.unknown()),
    })
    .passthrough()
    .parse(JSON.parse(value));
  return data as unknown as AppSnapshot;
}

export interface RestorePlan {
  preview: BackupPreview;
  calendars: CalendarSource[];
  changes: { action: "create" | "update" | "delete"; event: CalendarEvent }[];
  fingerprint: string;
}

export function stateFingerprint(state: AppSnapshot): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        state.events.map((event) => [event.id, eventContent(event)]).sort(),
      ),
    )
    .digest("hex");
}

export function planRestore(
  current: AppSnapshot,
  backup: AppSnapshot,
  options: BackupOptions,
): RestorePlan {
  const changes: RestorePlan["changes"] = [];
  const calendars = backup.calendars.filter(
    (calendar) =>
      calendar.provider === "local" &&
      !current.calendars.some((item) => item.id === calendar.id),
  );
  const byCalendar = new Map(
    [...current.calendars, ...calendars].map((calendar) => [
      calendar.id,
      calendar,
    ]),
  );
  const byId = new Map(
    current.events
      .filter((event) => !event.deleted)
      .map((event) => [event.id, event]),
  );
  const backupIds = new Set(
    backup.events.filter((event) => !event.deleted).map((event) => event.id),
  );
  let skipped = 0;
  for (const event of backup.events.filter((item) => !item.deleted)) {
    const calendar = byCalendar.get(event.calendarId);
    if (
      !calendar?.writable ||
      (calendar.provider !== "local" && !options.includeCloud)
    ) {
      skipped++;
      continue;
    }
    const previous = byId.get(event.id);
    if (previous && previous.calendarId !== event.calendarId) {
      skipped++;
      continue;
    }
    if (eventContent(previous) !== eventContent(event))
      changes.push({
        action: previous ? "update" : "create",
        event: structuredClone(event),
      });
  }
  if (options.deleteMissing)
    for (const event of current.events.filter(
      (item) => !item.deleted && !backupIds.has(item.id),
    )) {
      const calendar = byCalendar.get(event.calendarId);
      if (
        calendar?.writable &&
        (calendar.provider === "local" || options.includeCloud)
      )
        changes.push({ action: "delete", event });
    }
  return {
    fingerprint: stateFingerprint(current),
    calendars,
    changes,
    preview: {
      token: randomUUID(),
      skipped,
      changes: changes.map(({ action, event }) => ({
        action,
        title: event.title,
        start: event.start,
        calendar: byCalendar.get(event.calendarId)!.name,
        cloud: byCalendar.get(event.calendarId)!.provider !== "local",
      })),
    },
  };
}

export class Backups {
  private imported = new Map<string, { state: AppSnapshot; at: number }>();
  private plans = new Map<string, { plan: RestorePlan; at: number }>();
  constructor(private directory: string) {}
  async list() {
    const folder = path.join(this.directory, "backups");
    let files: string[] = [];
    try {
      files = await readdir(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const result = [];
    for (const file of files
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
      .sort()
      .reverse()) {
      const state = await this.read(file);
      result.push({
        id: file,
        name: file.slice(0, 10),
        events: state.events.filter((event) => !event.deleted).length,
      });
    }
    return result;
  }
  private async read(id: string): Promise<AppSnapshot> {
    const imported = this.imported.get(id);
    if (imported && Date.now() - imported.at < 30 * 60_000)
      return imported.state;
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(id))
      throw new Error("备份选择已失效，请重新导入");
    const filename = path.join(this.directory, "backups", id);
    if ((await stat(filename)).size > maximum) throw new Error("备份文件过大");
    return parseBackup(await readFile(filename, "utf8"));
  }
  import(state: AppSnapshot) {
    const id = `import-${randomUUID()}`;
    this.imported.clear();
    this.imported.set(id, { state, at: Date.now() });
    return {
      id,
      name: "导入的加密备份",
      events: state.events.filter((event) => !event.deleted).length,
    };
  }
  async preview(state: AppSnapshot, id: string, options: BackupOptions) {
    const plan = planRestore(state, await this.read(id), options);
    this.plans.clear();
    this.plans.set(plan.preview.token, { plan, at: Date.now() });
    return plan.preview;
  }
  take(token: string, state: AppSnapshot) {
    const entry = this.plans.get(token);
    if (!entry || Date.now() - entry.at > 10 * 60_000)
      throw new Error("恢复预览已过期，请重新预览");
    if (entry.plan.fingerprint !== stateFingerprint(state))
      throw new Error("预览后日程有新的变化，请重新预览");
    this.plans.delete(token);
    return entry.plan;
  }
}
