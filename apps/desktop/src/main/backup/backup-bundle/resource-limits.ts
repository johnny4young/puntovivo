import type Database from 'better-sqlite3';

/**
 * Keep backup-only SQLite connections from inheriting a large page cache or
 * memory-backed temporary store. These connections perform sequential scans;
 * a 1 MiB cache is sufficient and makes their RSS independent of DB size.
 */
export function applyBoundedBackupResources(db: Database.Database): void {
  db.pragma('cache_size = -1024');
  db.pragma('temp_store = FILE');
  db.pragma('mmap_size = 0');
  db.pragma('cache_spill = ON');
}
