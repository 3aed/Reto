import bcrypt from 'bcryptjs';
import type { DbConnection } from './db.ts';
import { openDatabase, runMigrations } from './db.ts';
import { loadConfig } from './config.ts';
import { isStrongPassword, isValidEmail, writeAuditLog } from './security.ts';

const BCRYPT_ROUNDS = 12;

export async function provisionInitialAdmin(
  db: DbConnection,
  emailRaw: string,
  passwordRaw: string
): Promise<{ created: boolean; message: string }> {
  const email = String(emailRaw || '').trim().toLowerCase();
  const password = String(passwordRaw || '');

  if (!isValidEmail(email)) {
    throw new Error('ADMIN_INITIAL_EMAIL must be a valid email address.');
  }

  const strength = isStrongPassword(password);
  if (!strength.valid) {
    throw new Error(`ADMIN_INITIAL_PASSWORD rejected: ${strength.reason}`);
  }

  const countRow = db
    .prepare('SELECT COUNT(*) AS count FROM admin_users')
    .get() as { count: number };

  if (countRow.count > 0) {
    return {
      created: false,
      message: 'An administrator account already exists. Initial provisioning skipped.',
    };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const result = db
    .prepare(
      `
      INSERT INTO admin_users (email, password_hash, role, active)
      VALUES (?, ?, 'super_admin', 1)
    `
    )
    .run(email, passwordHash);

  writeAuditLog(db, {
    adminUserId: Number(result.lastInsertRowid),
    adminEmail: email,
    action: 'ADMIN_INITIAL_PROVISIONED',
    targetType: 'admin_user',
    targetId: String(result.lastInsertRowid),
    details: { method: 'environment_or_cli' },
    ipAddress: 'local',
  });

  return {
    created: true,
    message: `Initial administrator provisioned for ${email}.`,
  };
}

export async function bootstrapInitialAdminFromEnv(db: DbConnection): Promise<void> {
  const email = (process.env.ADMIN_INITIAL_EMAIL || '').trim();
  const password = process.env.ADMIN_INITIAL_PASSWORD || '';
  if (!email && !password) {
    return;
  }
  if (!email || !password) {
    console.warn(
      '[RetroMarket] Both ADMIN_INITIAL_EMAIL and ADMIN_INITIAL_PASSWORD must be set to auto-provision the initial admin.'
    );
    return;
  }
  const outcome = await provisionInitialAdmin(db, email, password);
  if (outcome.created) {
    console.log(`[RetroMarket] ${outcome.message}`);
  }
}

// Allow direct execution via `npm run provision:admin`
const isDirectCli =
  typeof process.argv[1] === 'string' &&
  process.argv[1].endsWith('provision-admin.ts');

if (isDirectCli) {
  const cfg = loadConfig();
  const db = openDatabase(cfg.databasePath);
  runMigrations(db);

  const email = process.env.ADMIN_INITIAL_EMAIL || '';
  const password = process.env.ADMIN_INITIAL_PASSWORD || '';
  if (!email || !password) {
    console.error(
      'Usage: set ADMIN_INITIAL_EMAIL and ADMIN_INITIAL_PASSWORD environment variables, then run `npm run provision:admin`.'
    );
    process.exit(1);
  }

  provisionInitialAdmin(db, email, password)
    .then((outcome) => {
      console.log(outcome.message);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
