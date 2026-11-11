import { safeStorage } from "electron";
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { Connection } from "../src/shared/types";
import type { Vault } from "./service";

export class CredentialVault implements Vault {
  private file: string;
  private cache?: Record<string, Connection>;
  constructor(directory: string) {
    this.file = path.join(directory, "connections.encrypted");
  }

  private async all(): Promise<Record<string, Connection>> {
    if (this.cache) return structuredClone(this.cache);
    let buffer: Buffer;
    try {
      buffer = await readFile(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cache = {};
        return {};
      }
      throw error;
    }
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("Windows 凭据加密暂不可用，请重新登录系统后重试。");
    const parsed = JSON.parse(safeStorage.decryptString(buffer));
    this.cache = structuredClone(parsed);
    return parsed;
  }

  private async save(value: Record<string, Connection>) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("Windows 凭据加密暂不可用，连接尚未保存。");
    await writeFile(
      `${this.file}.tmp`,
      safeStorage.encryptString(JSON.stringify(value)),
    );
    await rename(`${this.file}.tmp`, this.file);
    this.cache = structuredClone(value);
  }

  async read(id: string) {
    return (await this.all())[id];
  }
  async write(connection: Connection) {
    const connections = await this.all();
    connections[connection.id] = connection;
    await this.save(connections);
  }
  async remove(id: string) {
    const connections = await this.all();
    delete connections[id];
    await this.save(connections);
  }
}
