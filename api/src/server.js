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

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'same-site' },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // blob: is needed for the client-side photo preview — the browser
        // compresses the camera image to a Blob and shows it before upload.
        // Helmet's default img-src omits blob:, which silently refuses it.
        'img-src': ["'self'", 'data:', 'blob:'],
      },
    },
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

if (config.corsOrigin) {
  app.use(cors({ origin: config.corsOrigin.split(',').map((s) => s.trim()), credentials: true }));
}

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: config.apiRateMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a moment and try again.' },
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
  // Storage problems are an operator issue, not a user mistake. Say so plainly
  // rather than hiding behind a generic 500.
  if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
    console.error('[storage] cannot write to UPLOAD_DIR:', config.uploadDir, err.message);
    return res.status(500).json({
      error: 'The server cannot save uploads right now. Please tell the administrator.',
    });
  }
  if (err && err.code === 'ENOSPC') {
    console.error('[storage] disk full while writing to', config.uploadDir);
    return res.status(507).json({ error: 'The server has run out of disk space for uploads.' });
  }
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

/**
 * Prove at boot that uploads will actually work.
 *
 * The upload directory is a bind mount, so its permissions come from the host
 * and can be wrong in a way nothing else notices — the app starts happily and
 * then fails on the first photo a field worker tries to send. Writing a probe
 * file here turns that into a loud message at deploy time.
 */
async function checkUploadDir() {
  const probe = path.join(config.uploadDir, '.write-probe');
  try {
    await fs.promises.mkdir(config.uploadDir, { recursive: true });
    await fs.promises.writeFile(probe, 'ok');
    await fs.promises.unlink(probe);
    console.log(`[uploads] ${config.uploadDir} is writable`);
  } catch (err) {
    console.error(
      `[uploads] CANNOT WRITE to ${config.uploadDir} (${err.code}). ` +
        'Photo and document uploads will fail. ' +
        'If this is a Docker bind mount, fix ownership on the host: ' +
        'chown -R 1000:1000 data/uploads'
    );
  }
}

async function start() {
  await waitForDatabase();
  await checkUploadDir();
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
