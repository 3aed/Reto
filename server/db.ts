import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type DbConnection = DatabaseSync;

export function openDatabase(databasePath: string): DbConnection {
  if (databasePath !== ':memory:') {
    const dir = path.dirname(databasePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (databasePath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

export function runMigrations(
  db: DbConnection,
  migrationsDir: string = path.resolve(process.cwd(), 'db', 'migrations')
): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const appliedStmt = db.prepare('SELECT version FROM schema_migrations');
  const appliedRows = appliedStmt.all() as Array<{ version: string }>;
  const appliedSet = new Set(appliedRows.map((row) => row.version));

  const newlyApplied: string[] = [];

  for (const file of files) {
    if (appliedSet.has(file)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(file);
      db.exec('COMMIT;');
      newlyApplied.push(file);
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  // Ensure the single website_settings configuration row exists (no fake products, sellers, or wallets)
  db.prepare(`
    INSERT OR IGNORE INTO website_settings (
      id, site_name, tagline, logo_path, default_currency,
      support_email, seller_contact_info, guest_checkout_notice,
      btc_wallet_address, eth_wallet_address, usdt_wallet_address, usdt_network
    ) VALUES (
      1, 'RetroMarket', 'Classic Online Buying & Selling Directory', 'assets/icons/logo-mark.svg', 'USD',
      '', '', 'Shop and check out as a guest without creating a customer account. Save your Order Reference ID to track your order.',
      '', '', '', 'ERC-20'
    )
  `).run();

  return newlyApplied;
}

export function runInTransaction<T>(db: DbConnection, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Ignore rollback errors if already rolled back
    }
    throw err;
  }
}

export function purgeExpiredAdminSessions(db: DbConnection): void {
  db.prepare("DELETE FROM admin_sessions WHERE expires_at <= datetime('now')").run();
  db.prepare(
    "DELETE FROM password_reset_tokens WHERE expires_at <= datetime('now') OR used_at IS NOT NULL"
  ).run();
}
