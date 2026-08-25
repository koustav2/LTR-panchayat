'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const { waitForDatabase, query } = require('./db');
const { ApiError } = require('./lib/validate');

const app = express();

// Behind nginx / cPanel's proxy, so the client IP comes from X-Forwarded-For.
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

if (config.corsOrigin) {
  app.use(cors({ origin: config.corsOrigin.split(',').map((s) => s.trim()), credentials: true }));
}

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'database unavailable' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/master', require('./routes/master'));
app.use('/api/beneficiaries', require('./routes/beneficiaries'));
app.use('/api/applications', require('./routes/applications'));
app.use('/api/files', require('./routes/files'));

// Optional: serve the built frontend from the same process. Used by the
// cPanel "Setup Node.js App" deployment, where there is no separate nginx.
const webDist = process.env.SERVE_WEB_DIR;
if (webDist && fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `File is too large. Maximum ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`,
    });
  }
  if (err && err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'That record already exists.' });
  }
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

async function start() {
  await waitForDatabase();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] listening on :${config.port} (${config.isProd ? 'production' : 'development'})`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[api] failed to start:', err);
    process.exit(1);
  });
}

module.exports = { app, start };
