/**
 * SQLite 数据库工具
 * 使用 @tauri-apps/plugin-sql 进行数据持久化
 * 密码字段使用 Rust 端 AES-256-GCM 加密存储
 */

import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

const DB_PATH = "sqlite:openclaw.db";

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!dbInstance) {
    dbInstance = await Database.load(DB_PATH);
  }
  return dbInstance;
}

async function encryptPassword(plain: string): Promise<string> {
  if (!plain) return "";
  return invoke<string>("encrypt_text", { plaintext: plain });
}

async function decryptPassword(encrypted: string): Promise<string> {
  if (!encrypted) return "";
  return invoke<string>("decrypt_text", { encrypted });
}

export interface ResourceRecord {
  name: string;
  type: "local" | "remote";
  host?: string;
  port?: number;
  username?: string;
  password?: string;
}

export interface ResourceRow {
  id: number;
  name: string;
  type: string;
  host: string | null;
  port: number | null;
  username: string | null;
  password: string | null;
  created_at: string;
}

/**
 * 检查是否存在已配置的资源（用于判断是否跳过安装引导）
 */
export async function hasResources(): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM resources`
  );
  return rows.length > 0 && rows[0].cnt > 0;
}

export interface ResourceWithId extends ResourceRecord {
  id: number;
}

/**
 * 获取资源列表（密码自动解密，含 id）
 */
export async function getResources(): Promise<ResourceWithId[]> {
  const db = await getDb();
  const rows = await db.select<ResourceRow[]>(`SELECT * FROM resources ORDER BY id`);
  const results: ResourceWithId[] = [];
  for (const row of rows) {
    results.push({
      id: row.id,
      name: row.name,
      type: row.type as "local" | "remote",
      host: row.host ?? undefined,
      port: row.port ?? undefined,
      username: row.username ?? undefined,
      password: row.password ? await decryptPassword(row.password) : undefined,
    });
  }
  return results;
}

/**
 * 新增资源
 */
export async function addResource(resource: ResourceRecord): Promise<number> {
  const db = await getDb();
  if (resource.type === "local") {
    const result = await db.execute(
      `INSERT INTO resources (name, type) VALUES ($1, $2)`,
      [resource.name, resource.type]
    );
    return result.lastInsertId ?? 0;
  } else {
    const encryptedPwd = await encryptPassword(resource.password ?? "");
    const result = await db.execute(
      `INSERT INTO resources (name, type, host, port, username, password) VALUES ($1, $2, $3, $4, $5, $6)`,
      [resource.name, resource.type, resource.host ?? "", resource.port ?? 22, resource.username ?? "", encryptedPwd]
    );
    return result.lastInsertId ?? 0;
  }
}

/**
 * 更新资源
 */
export async function updateResource(id: number, resource: ResourceRecord) {
  const db = await getDb();
  if (resource.type === "local") {
    await db.execute(
      `UPDATE resources SET name = $1, type = $2, host = NULL, port = NULL, username = NULL, password = NULL WHERE id = $3`,
      [resource.name, resource.type, id]
    );
  } else {
    const encryptedPwd = await encryptPassword(resource.password ?? "");
    await db.execute(
      `UPDATE resources SET name = $1, type = $2, host = $3, port = $4, username = $5, password = $6 WHERE id = $7`,
      [resource.name, resource.type, resource.host ?? "", resource.port ?? 22, resource.username ?? "", encryptedPwd, id]
    );
  }
}

/**
 * 删除资源
 */
export async function deleteResource(id: number) {
  const db = await getDb();
  await db.execute(`DELETE FROM resources WHERE id = $1`, [id]);
}

