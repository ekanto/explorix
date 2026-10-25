import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import './types.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { authenticate, requireAuth } from './middleware/auth.js';
import { loadProject } from './middleware/access.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth.js';
import { adminRouter } from './modules/admin.js';
import { globalRouter } from './modules/global.js';
import { projectsRouter, projectConfigRouter } from './modules/projects.js';
import { templatesRouter } from './modules/templates.js';
import { chartersRouter } from './modules/charters.js';
import { sessionsRouter } from './modules/sessions.js';
import { findingsRouter } from './modules/findings.js';
import { issuesRouter } from './modules/issues.js';
import { requirementsRouter } from './modules/requirements.js';
import { commentsRouter } from './modules/comments.js';
import { attachmentsRouter } from './modules/attachments.js';
import { testCasesRouter } from './modules/testCases.js';
import { testRunsRouter } from './modules/testRuns.js';
import { automationRouter } from './modules/automation.js';
import { reportsRouter } from './modules/reports.js';
import { reportingRouter } from './modules/reporting.js';
import { aiRouter, aiStatusRouter } from './modules/ai.js';
import { integrationsRouter, tokensRouter } from './modules/integrations.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  // Desktop: the API listens on loopback only; rejecting foreign Host headers blocks DNS-rebinding attacks from web pages.
  if (config.isDesktop) {
    app.use((req, res, next) => {
      if (req.hostname === '127.0.0.1' || req.hostname === 'localhost') return next();
      res.status(421).json({ error: { code: 'misdirected', message: 'Unexpected host' } });
    });
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  if (!config.isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => !req.url?.startsWith('/api') } }));
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.text({ type: ['text/csv', 'text/plain', 'application/xml', 'text/xml'], limit: '20mb' }));

  if (!config.rateLimitDisabled) {
    app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false }));
  }

  // Public endpoints
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'explorix', time: new Date().toISOString() }));
  const specPath = [path.join(here, 'openapi.yaml'), path.join(here, '..', 'src', 'openapi.yaml')].find((p) => fs.existsSync(p));
  if (specPath) {
    const spec = YAML.parse(fs.readFileSync(specPath, 'utf8'));
    app.get('/api/openapi.json', (_req, res) => res.json(spec));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'Explorix API' }));
  }

  app.use('/api', authenticate);
  app.use('/api/auth', authRouter);
  app.use('/api', requireAuth);
  app.use('/api/admin', adminRouter);
  app.use('/api/tokens', tokensRouter);
  app.use('/api/ai', aiStatusRouter);
  app.use('/api', globalRouter);
  app.use('/api/projects', projectsRouter);

  const p = express.Router({ mergeParams: true });
  p.use(loadProject);
  p.use('/', projectConfigRouter);
  p.use('/templates', templatesRouter);
  p.use('/charters', chartersRouter);
  p.use('/sessions', sessionsRouter);
  p.use('/findings', findingsRouter);
  p.use('/issues', issuesRouter);
  p.use('/requirements', requirementsRouter);
  p.use('/comments', commentsRouter);
  p.use('/attachments', attachmentsRouter);
  p.use('/', testCasesRouter);
  p.use('/', testRunsRouter);
  p.use('/automation', automationRouter);
  p.use('/reports', reportsRouter);
  p.use('/reporting', reportingRouter);
  p.use('/ai', aiRouter);
  p.use('/integrations', integrationsRouter);
  app.use('/api/projects/:projectId', p);

  app.use('/api', notFoundHandler);

  // Production: serve the built web app (single origin keeps cookies first-party).
  const webDist = config.WEB_DIST ? path.resolve(config.WEB_DIST) : path.resolve(here, '../../web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
