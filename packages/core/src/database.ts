import { DataSource } from 'typeorm';
import { Project } from './entities/Project';
import { ContextEntry } from './entities/ContextEntry';
import { Decision } from './entities/Decision';
import { ApiKey } from './entities/ApiKey';
import { SyncConfig } from './entities/SyncConfig';
import path from 'path';
import os from 'os';
import fs from 'fs';

const ALL_ENTITIES = [Project, ContextEntry, Decision, ApiKey, SyncConfig];

export interface DatabaseOptions {
  /** Full path to the SQLite database file. Defaults to ~/.thinkcoffee/data.sqlite */
  dbPath?: string;
  /** Enable TypeORM query logging */
  logging?: boolean;
}

let dataSource: DataSource | null = null;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getDefaultDataDir(): string {
  return path.join(os.homedir(), '.thinkcoffee');
}

function getDefaultDbPath(): string {
  const dir = getDefaultDataDir();
  ensureDir(dir);
  return path.join(dir, 'data.sqlite');
}

function resolveDbPath(options: DatabaseOptions): string {
  if (options.dbPath) {
    return options.dbPath;
  }

  const envDbPath = process.env.THINKCOFFEE_DB_PATH?.trim();
  if (envDbPath) {
    return envDbPath === ':memory:' ? envDbPath : path.resolve(envDbPath);
  }

  const envDataDir = process.env.THINKCOFFEE_DATA_DIR?.trim();
  if (envDataDir) {
    const resolvedDir = path.resolve(envDataDir);
    ensureDir(resolvedDir);
    return path.join(resolvedDir, 'data.sqlite');
  }

  return getDefaultDbPath();
}

function resolveLogging(options: DatabaseOptions): boolean {
  if (typeof options.logging === 'boolean') {
    return options.logging;
  }

  const envValue = process.env.THINKCOFFEE_DB_LOGGING?.trim().toLowerCase();
  return envValue === '1' || envValue === 'true' || envValue === 'yes';
}

export async function getDatabase(options: DatabaseOptions = {}): Promise<DataSource> {
  if (dataSource?.isInitialized) {
    return dataSource;
  }

  const dbPath = resolveDbPath(options);
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    ensureDir(dir);
  }

  dataSource = new DataSource({
    type: 'sqlite',
    database: dbPath,
    synchronize: true,
    logging: resolveLogging(options),
    entities: ALL_ENTITIES,
  });

  await dataSource.initialize();
  return dataSource;
}

export async function closeDatabase(): Promise<void> {
  if (dataSource?.isInitialized) {
    await dataSource.destroy();
    dataSource = null;
  }
}
