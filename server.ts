import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import type { AppConfig } from './server/config.ts';
import { loadConfig } from './server/config.ts';
import type { DbConnection } from './server/db.ts';
import { openDatabase, purgeExpiredAdminSessions, runMigrations } from './server/db.ts';
import { securityHeadersMiddleware } from './server/security.ts';
import { bootstrapInitialAdminFromEnv } from './server/provision-admin.ts';
import { createPublicApiRouter } from './server/routes/public.ts';
import { createAdminApiRouter, createPrivateAdminPageRouter } from './server/routes/admin.ts';

const PUBLIC_HTML_PAGES = new Set([
  'index.html',
  'marketplace.html',
  'categories.html',
  'product.html',
  'cart.html',
  'checkout.html',
  'payment.html',
  'orders.html',
  'contact.html',
]);

export interface RetroMarketServerContext {
  app: express.Express;
  db: DbConnection;
  config: AppConfig;
}

export async function createRetroMarketApp(
  overrides?: Partial<AppConfig>
): Promise<RetroMarketServerContext> {
  const config: AppConfig = { ...loadConfig(), ...(overrides || {}) };
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  purgeExpiredAdminSessions(db);
  await bootstrapInitialAdminFromEnv(db);

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use(securityHeadersMiddleware(config));
  app.use(cookieParser());
  app.use(express.json({ limit: '256kb' }));

  // Explicitly block legacy/predictable public admin URLs and sensitive backend directories
  app.use((req: Request, res: Response, next: NextFunction) => {
    const lower = req.path.toLowerCase();
    if (
      lower === '/admin' ||
      lower === '/admin/' ||
      lower === '/admin.html' ||
      lower === '/admin-login.html' ||
      lower.startsWith('/private/') ||
      lower.startsWith('/server/') ||
      lower.startsWith('/db/') ||
      lower.startsWith('/data/') ||
      lower.startsWith('/.env') ||
      lower === '/package.json' ||
      lower === '/server.ts'
    ) {
      res.status(404).type('text/plain').send('Not Found');
      return;
    }
    next();
  });

  // Public Storefront & Guest APIs
  app.use('/api', createPublicApiRouter(db, config));

  // Protected Admin APIs (independently authenticated regardless of secret URL)
  app.use('/api/admin', createAdminApiRouter(db, config));

  // Private Admin Web Interface mounted exclusively at configured secret path
  if (config.adminSecretPath) {
    app.use(`/${config.adminSecretPath}`, createPrivateAdminPageRouter(db, config));
  } else {
    console.warn(
      '[RetroMarket] ADMIN_SECRET_PATH is not configured (must be 8–80 alphanumeric/_/- chars). Private admin web interface is disabled until configured.'
    );
  }

  // Serve strictly allow-listed public storefront HTML pages & public assets
  const staticRoot =
    config.isProduction && fs.existsSync(path.resolve(process.cwd(), 'dist'))
      ? path.resolve(process.cwd(), 'dist')
      : process.cwd();

  app.use(
    '/css',
    express.static(path.join(staticRoot, 'css'), {
      index: false,
      dotfiles: 'ignore',
    })
  );
  app.use(
    '/js',
    express.static(path.join(staticRoot, 'js'), {
      index: false,
      dotfiles: 'ignore',
    })
  );
  app.use(
    '/assets',
    express.static(path.join(staticRoot, 'assets'), {
      index: false,
      dotfiles: 'ignore',
    })
  );

  app.get('/', (_req: Request, res: Response) => {
    res.sendFile(path.join(staticRoot, 'index.html'));
  });

  app.get('/:page', (req: Request, res: Response, next: NextFunction) => {
    const page = String(req.params.page || '');
    if (PUBLIC_HTML_PAGES.has(page)) {
      res.sendFile(path.join(staticRoot, page));
      return;
    }
    next();
  });

  // 404 handler (never leaks internals)
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'API endpoint not found.' });
      return;
    }
    res.status(404).type('text/plain').send('404 Not Found');
  });

  // Generic error handler — never expose stack traces or secret details
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const isSyntaxErr =
      err instanceof SyntaxError && 'status' in err && Number((err as { status?: number }).status) === 400;
    if (isSyntaxErr) {
      res.status(400).json({ error: 'Malformed JSON request body.' });
      return;
    }
    if (!config.isProduction) {
      console.error('[RetroMarket Server Error]', err);
    }
    if (req.path.startsWith('/api/')) {
      res.status(500).json({ error: 'Internal server error.' });
      return;
    }
    res.status(500).type('text/plain').send('Internal Server Error');
  });

  return { app, db, config };
}

const isEntryPoint =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));

if (isEntryPoint) {
  createRetroMarketApp()
    .then(({ app, config }) => {
      app.listen(config.port, '0.0.0.0', () => {
        console.log(
          `[RetroMarket] Production backend listening on http://0.0.0.0:${config.port} (${config.nodeEnv})`
        );
      });
    })
    .catch((err) => {
      console.error('[RetroMarket] Failed to start server:', err);
      process.exit(1);
    });
}
