const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const dotenv = require('dotenv');
const dotenvResult = dotenv.config();
const envFromFile = dotenvResult.parsed || {};
// No-op change to verify Railway auto-deploy trigger.

const app = express();
const PORT = process.env.PORT || 7654;
function readEnv(name) {
  const fromProcess = process.env[name];
  if (typeof fromProcess === 'string' && fromProcess.trim() !== '') {
    return fromProcess.trim();
  }
  const fromFile = envFromFile[name];
  if (typeof fromFile === 'string' && fromFile.trim() !== '') {
    return fromFile.trim();
  }
  return '';
}

function readEnvNumber(name, fallback) {
  const value = readEnv(name);
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

const BASIC_AUTH_USER = readEnv('BASIC_AUTH_USERNAME') || readEnv('USERNAME');
const BASIC_AUTH_PASSWORD = readEnv('BASIC_AUTH_PASSWORD') || readEnv('PASSWORD');
const authEnabled = Boolean(BASIC_AUTH_USER && BASIC_AUTH_PASSWORD);
const AUTH_COOKIE_NAME = 'studio_auth';
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours
const AUTH_SESSION_SECRET = readEnv('AUTH_SESSION_SECRET') || BASIC_AUTH_PASSWORD || 'fallback-auth-secret';
const ALLOW_UNAUTHENTICATED = readEnv('ALLOW_UNAUTHENTICATED').toLowerCase() === 'true';
const LOGIN_WINDOW_MS = readEnvNumber('LOGIN_WINDOW_SECONDS', 10 * 60) * 1000;
const LOGIN_MAX_ATTEMPTS_PER_IP = readEnvNumber('LOGIN_MAX_ATTEMPTS_PER_IP', 15);
const LOGIN_FAILED_WINDOW_MS = readEnvNumber('LOGIN_FAILED_WINDOW_SECONDS', 15 * 60) * 1000;
const LOGIN_MAX_FAILED_ATTEMPTS_PER_IP = readEnvNumber('LOGIN_MAX_FAILED_ATTEMPTS_PER_IP', 8);
const LOGIN_FAILED_LOCKOUT_SECONDS = readEnvNumber('LOGIN_FAILED_LOCKOUT_SECONDS', 30 * 60);
const GENERATE_WINDOW_MS = readEnvNumber('GENERATE_WINDOW_SECONDS', 10 * 60) * 1000;
const GENERATE_MAX_REQUESTS_PER_IP = readEnvNumber('GENERATE_MAX_REQUESTS_PER_IP', 40);
const GENERATE_MAX_REQUESTS_PER_USER = readEnvNumber('GENERATE_MAX_REQUESTS_PER_USER', 120);
const GENERATE_MAX_PER_HOUR = readEnvNumber('GENERATE_MAX_PER_HOUR', 300);
const GENERATE_MAX_PER_DAY = readEnvNumber('GENERATE_MAX_PER_DAY', 1200);
const EXPECTED_AUTH_TOKEN = crypto
  .createHash('sha256')
  .update(`${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}:${AUTH_SESSION_SECRET}`)
  .digest('hex');

if (!authEnabled && !ALLOW_UNAUTHENTICATED) {
  throw new Error('Auth credentials are required. Set BASIC_AUTH_USERNAME/BASIC_AUTH_PASSWORD (or USERNAME/PASSWORD). Use ALLOW_UNAUTHENTICATED=true only for local testing.');
}

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim() !== '') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function createRateLimiter({ windowMs, max, keyFn, onLimit }) {
  const eventsByKey = new Map();

  return (req, res, next) => {
    if (max <= 0 || windowMs <= 0) {
      return next();
    }

    const key = keyFn(req);
    const now = Date.now();
    const windowStart = now - windowMs;
    const events = eventsByKey.get(key) || [];

    while (events.length > 0 && events[0] <= windowStart) {
      events.shift();
    }

    if (events.length >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((events[0] + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return onLimit(req, res, retryAfterSeconds);
    }

    events.push(now);
    eventsByKey.set(key, events);

    if (eventsByKey.size > 5000) {
      for (const [storedKey, storedEvents] of eventsByKey.entries()) {
        while (storedEvents.length > 0 && storedEvents[0] <= windowStart) {
          storedEvents.shift();
        }
        if (storedEvents.length === 0) {
          eventsByKey.delete(storedKey);
        }
      }
    }

    return next();
  };
}

const loginRateLimiter = createRateLimiter({
  windowMs: LOGIN_WINDOW_MS,
  max: LOGIN_MAX_ATTEMPTS_PER_IP,
  keyFn: (req) => getClientIp(req),
  onLimit: (_req, res) => res.redirect('/login?error=rate')
});

const generateIpRateLimiter = createRateLimiter({
  windowMs: GENERATE_WINDOW_MS,
  max: GENERATE_MAX_REQUESTS_PER_IP,
  keyFn: (req) => getClientIp(req),
  onLimit: (_req, res, retryAfterSeconds) => res.status(429).json({
    error: `For mange foresporsler fra denne IP-en. Prov igjen om ${retryAfterSeconds} sekunder.`
  })
});

const generateUserRateLimiter = createRateLimiter({
  windowMs: GENERATE_WINDOW_MS,
  max: GENERATE_MAX_REQUESTS_PER_USER,
  keyFn: () => (authEnabled ? `user:${BASIC_AUTH_USER}` : 'public'),
  onLimit: (_req, res, retryAfterSeconds) => res.status(429).json({
    error: `For mange foresporsler for denne brukeren. Prov igjen om ${retryAfterSeconds} sekunder.`
  })
});

const generateBudgetState = {
  hourKey: '',
  hourCount: 0,
  dayKey: '',
  dayCount: 0
};
const failedLoginByIp = new Map();

function getUtcHourKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 13);
}

function getUtcDayKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function secondsUntilNextUtcHour(nowMs) {
  const nextHourMs = (Math.floor(nowMs / 3600000) + 1) * 3600000;
  return Math.max(1, Math.ceil((nextHourMs - nowMs) / 1000));
}

function secondsUntilNextUtcDay(nowMs) {
  const now = new Date(nowMs);
  const nextDayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  return Math.max(1, Math.ceil((nextDayMs - nowMs) / 1000));
}

function consumeGenerateBudget(requestCount = 1) {
  if (GENERATE_MAX_PER_HOUR <= 0 && GENERATE_MAX_PER_DAY <= 0) {
    return { allowed: true };
  }

  const nowMs = Date.now();
  const hourKey = getUtcHourKey(nowMs);
  const dayKey = getUtcDayKey(nowMs);

  if (generateBudgetState.hourKey !== hourKey) {
    generateBudgetState.hourKey = hourKey;
    generateBudgetState.hourCount = 0;
  }

  if (generateBudgetState.dayKey !== dayKey) {
    generateBudgetState.dayKey = dayKey;
    generateBudgetState.dayCount = 0;
  }

  if (GENERATE_MAX_PER_HOUR > 0 && generateBudgetState.hourCount + requestCount > GENERATE_MAX_PER_HOUR) {
    return {
      allowed: false,
      error: 'Timekvoten for bildegenerering er brukt opp. Prov igjen neste time.',
      retryAfterSeconds: secondsUntilNextUtcHour(nowMs)
    };
  }

  if (GENERATE_MAX_PER_DAY > 0 && generateBudgetState.dayCount + requestCount > GENERATE_MAX_PER_DAY) {
    return {
      allowed: false,
      error: 'Dognkvoten for bildegenerering er brukt opp. Prov igjen i morgen.',
      retryAfterSeconds: secondsUntilNextUtcDay(nowMs)
    };
  }

  generateBudgetState.hourCount += requestCount;
  generateBudgetState.dayCount += requestCount;
  return { allowed: true };
}

function getOrInitFailedLoginState(ip, nowMs) {
  const existing = failedLoginByIp.get(ip);
  if (!existing) {
    const state = { firstFailedAtMs: nowMs, failedAttempts: 0, blockedUntilMs: 0 };
    failedLoginByIp.set(ip, state);
    return state;
  }

  if (existing.blockedUntilMs > 0 && existing.blockedUntilMs <= nowMs) {
    existing.blockedUntilMs = 0;
    existing.failedAttempts = 0;
    existing.firstFailedAtMs = nowMs;
  }

  if (existing.failedAttempts > 0 && nowMs - existing.firstFailedAtMs > LOGIN_FAILED_WINDOW_MS) {
    existing.failedAttempts = 0;
    existing.firstFailedAtMs = nowMs;
  }

  return existing;
}

function cleanupFailedLoginState(nowMs) {
  if (failedLoginByIp.size <= 5000) {
    return;
  }

  const staleBefore = nowMs - LOGIN_FAILED_WINDOW_MS - (LOGIN_FAILED_LOCKOUT_SECONDS * 1000);
  for (const [ip, state] of failedLoginByIp.entries()) {
    if (state.blockedUntilMs > 0 && state.blockedUntilMs > nowMs) {
      continue;
    }
    if (state.firstFailedAtMs < staleBefore) {
      failedLoginByIp.delete(ip);
    }
  }
}

function getLoginLockoutSeconds(req) {
  if (LOGIN_MAX_FAILED_ATTEMPTS_PER_IP <= 0 || LOGIN_FAILED_LOCKOUT_SECONDS <= 0) {
    return 0;
  }

  const ip = getClientIp(req);
  const nowMs = Date.now();
  const state = getOrInitFailedLoginState(ip, nowMs);
  if (state.blockedUntilMs <= nowMs) {
    return 0;
  }

  return Math.max(1, Math.ceil((state.blockedUntilMs - nowMs) / 1000));
}

function recordFailedLoginAttempt(req) {
  if (LOGIN_MAX_FAILED_ATTEMPTS_PER_IP <= 0 || LOGIN_FAILED_LOCKOUT_SECONDS <= 0) {
    return 0;
  }

  const ip = getClientIp(req);
  const nowMs = Date.now();
  const state = getOrInitFailedLoginState(ip, nowMs);

  if (state.failedAttempts === 0) {
    state.firstFailedAtMs = nowMs;
  }
  state.failedAttempts += 1;

  if (state.failedAttempts >= LOGIN_MAX_FAILED_ATTEMPTS_PER_IP) {
    state.blockedUntilMs = nowMs + (LOGIN_FAILED_LOCKOUT_SECONDS * 1000);
    state.failedAttempts = 0;
    state.firstFailedAtMs = nowMs;
  }

  cleanupFailedLoginState(nowMs);
  return getLoginLockoutSeconds(req);
}

function clearFailedLoginAttempts(req) {
  const ip = getClientIp(req);
  failedLoginByIp.delete(ip);
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  if (!header) {
    return cookies;
  }

  header.split(';').forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) {
      return;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      return;
    }
    const key = trimmed.slice(0, separatorIndex);
    const value = trimmed.slice(separatorIndex + 1);
    try {
      cookies[key] = decodeURIComponent(value);
    } catch (_error) {
      cookies[key] = value;
    }
  });

  return cookies;
}

function hasValidAuthCookie(req) {
  if (!authEnabled) {
    return true;
  }

  const cookies = parseCookies(req);
  const cookieValue = cookies[AUTH_COOKIE_NAME];
  if (!cookieValue) {
    return false;
  }

  const received = Buffer.from(cookieValue, 'utf8');
  const expected = Buffer.from(EXPECTED_AUTH_TOKEN, 'utf8');
  if (received.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(received, expected);
}

function authCookieHeader(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const isSecureRequest = req.secure || forwardedProto === 'https';
  const securePart = isSecureRequest ? '; Secure' : '';
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(EXPECTED_AUTH_TOKEN)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}${securePart}`;
}

function clearAuthCookieHeader(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const isSecureRequest = req.secure || forwardedProto === 'https';
  const securePart = isSecureRequest ? '; Secure' : '';
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${securePart}`;
}

app.get('/login', (req, res) => {
  if (!authEnabled || hasValidAuthCookie(req)) {
    return res.redirect('/');
  }
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', loginRateLimiter, (req, res) => {
  if (!authEnabled) {
    return res.redirect('/');
  }

  const lockoutSeconds = getLoginLockoutSeconds(req);
  if (lockoutSeconds > 0) {
    res.setHeader('Retry-After', String(lockoutSeconds));
    return res.redirect('/login?error=locked');
  }

  const { username = '', password = '' } = req.body;
  if (username === BASIC_AUTH_USER && password === BASIC_AUTH_PASSWORD) {
    clearFailedLoginAttempts(req);
    res.setHeader('Set-Cookie', authCookieHeader(req));
    return res.redirect('/');
  }

  const updatedLockoutSeconds = recordFailedLoginAttempt(req);
  if (updatedLockoutSeconds > 0) {
    res.setHeader('Retry-After', String(updatedLockoutSeconds));
    return res.redirect('/login?error=locked');
  }

  return res.redirect('/login?error=1');
});

app.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearAuthCookieHeader(req));
  return res.redirect('/login');
});

app.use((req, res, next) => {
  if (!authEnabled) {
    return next();
  }

  const publicPaths = new Set(['/health', '/login', '/favicon.svg', '/robots.txt']);
  if (publicPaths.has(req.path)) {
    return next();
  }

  if (req.method === 'POST' && req.path === '/login') {
    return next();
  }

  if (hasValidAuthCookie(req)) {
    return next();
  }

  if (req.path.startsWith('/generate')) {
    return res.status(401).json({ error: 'Autentisering kreves.' });
  }

  return res.redirect('/login');
});
app.use(express.static('public'));

const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 14
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const OPENAI_API_KEY = readEnv('OPENAI_API_KEY');
const OPENAI_API_BASE_URL = readEnv('OPENAI_API_BASE_URL') || 'https://api.openai.com/v1';
const BFL_API_KEY = readEnv('BFL_API_KEY');
const BFL_API_BASE_URL = readEnv('BFL_API_BASE_URL') || 'https://api.bfl.ai/v1';
const BFL_POLL_INTERVAL_MS = readEnvNumber('BFL_POLL_INTERVAL_MS', 750);
const BFL_POLL_TIMEOUT_MS = readEnvNumber('BFL_POLL_TIMEOUT_SECONDS', 120) * 1000;

const IMAGE_MODEL_CONFIGS = {
  'gemini-3.1-flash-image-preview': {
    label: 'Gemini 3.1 Flash Image Preview',
    provider: 'google',
    supportsAspectRatio: true,
    supportsGoogleSearch: false
  },
  'gemini-3-pro-image-preview': {
    label: 'Gemini 3 Pro Image Preview',
    provider: 'google',
    supportsAspectRatio: true,
    supportsGoogleSearch: false
  },
  'gpt-image-2': {
    label: 'GPT Image 2',
    provider: 'openai',
    supportsAspectRatio: true,
    supportsGoogleSearch: false,
    supportsExactSize: true
  },
  'flux-2-max': {
    label: 'FLUX.2 Max',
    provider: 'bfl',
    endpoint: 'flux-2-max',
    supportsAspectRatio: true,
    supportsGoogleSearch: false,
    maxInputImages: 8
  }
};
const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';
const MAX_INLINE_IMAGE_BYTES = 7 * 1024 * 1024;
const BFL_MAX_INPUT_IMAGES = 8;
const BFL_MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024;
const BFL_MIN_IMAGE_EDGE = 64;
const BFL_MAX_IMAGE_PIXELS = 2048 * 2048;
const BFL_SIZE_MULTIPLE = 16;
const BFL_DEFAULT_OUTPUT_FORMAT = 'png';
const OPENAI_MIN_IMAGE_PIXELS = 655360;
const OPENAI_MAX_IMAGE_PIXELS = 8294400;
const OPENAI_MAX_IMAGE_EDGE = 3840;
const OPENAI_MAX_IMAGE_RATIO = 3;
const OPENAI_SIZE_MULTIPLE = 16;
const OPENAI_DEFAULT_SIZE_MODE = 'aspect';
const RELAXED_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
];

function normalizeSelectedModels(rawModels) {
  const values = Array.isArray(rawModels) ? rawModels : [rawModels];
  const requested = values
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim());
  const fallbackModels = requested.length > 0 ? requested : [DEFAULT_IMAGE_MODEL];
  const uniqueModels = [...new Set(fallbackModels)];
  return uniqueModels.filter((model) => IMAGE_MODEL_CONFIGS[model]);
}

function getModelProvider(modelId) {
  return IMAGE_MODEL_CONFIGS[modelId] && IMAGE_MODEL_CONFIGS[modelId].provider;
}

function selectedModelsIncludeProvider(selectedModels, provider) {
  return selectedModels.some((modelId) => getModelProvider(modelId) === provider);
}

function onlySelectedProvider(selectedModels, provider) {
  return selectedModels.length === 1 && getModelProvider(selectedModels[0]) === provider;
}

function summarizeResponseForDebug(response) {
  if (!response || typeof response !== 'object') {
    return 'No response object';
  }

  const segments = [];
  if (Array.isArray(response.candidates)) {
    segments.push(`candidates=${response.candidates.length}`);
  }
  if (response.promptFeedback && response.promptFeedback.blockReason) {
    segments.push(`blockReason=${response.promptFeedback.blockReason}`);
  }
  if (response.promptFeedback && response.promptFeedback.blockReasonMessage) {
    segments.push(`blockReasonMessage=${response.promptFeedback.blockReasonMessage}`);
  }
  if (response.modelVersion) {
    segments.push(`modelVersion=${response.modelVersion}`);
  }
  return segments.length > 0 ? segments.join(', ') : 'No extra metadata';
}

function validateInlineInputFiles(files, selectedModels) {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return null;
  }

  if (!selectedModelsIncludeProvider(selectedModels, 'google')) {
    return null;
  }

  const oversized = files.filter((file) => file && file.size > MAX_INLINE_IMAGE_BYTES);
  if (oversized.length > 0) {
    const details = oversized
      .map((file) => `${file.originalname || file.filename || 'ukjent-fil'} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`)
      .join(', ');
    return `En eller flere filer er for store for Gemini inline-opplasting. Maks er 7 MB per fil. For store filer: ${details}`;
  }

  return null;
}

function formatMegabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function validateBflInputFiles(files, selectedModels) {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return null;
  }

  if (!selectedModelsIncludeProvider(selectedModels, 'bfl')) {
    return null;
  }

  if (files.length > BFL_MAX_INPUT_IMAGES) {
    return `FLUX.2 Max stotter maks ${BFL_MAX_INPUT_IMAGES} referansebilder via API. Fjern ${files.length - BFL_MAX_INPUT_IMAGES} bilde(r) og prov igjen.`;
  }

  const oversized = files.filter((file) => file && file.size > BFL_MAX_INPUT_IMAGE_BYTES);
  if (oversized.length > 0) {
    const details = oversized
      .map((file) => `${file.originalname || file.filename || 'ukjent-fil'} (${formatMegabytes(file.size)})`)
      .join(', ');
    return `En eller flere filer er for store for FLUX.2 Max. Maks er ${formatMegabytes(BFL_MAX_INPUT_IMAGE_BYTES)} per fil. For store filer: ${details}`;
  }

  return null;
}

function parseAspectRatio(aspectRatio) {
  const [rawWidth, rawHeight] = String(aspectRatio || '16:9').split(':');
  const width = Number.parseFloat(rawWidth);
  const height = Number.parseFloat(rawHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 16, height: 9 };
  }
  return { width, height };
}

function floorToMultiple(value, multiple) {
  return Math.floor(value / multiple) * multiple;
}

function resolveBflImageSize(aspectRatio, resolution) {
  const { width: ratioWidth, height: ratioHeight } = parseAspectRatio(aspectRatio);
  const ratio = ratioWidth / ratioHeight;
  const longEdgeByResolution = {
    '1K': 1024,
    '2K': 2048,
    '4K': 3840
  };
  const requestedLongEdge = longEdgeByResolution[resolution] || longEdgeByResolution['2K'];
  let desiredWidth = ratio >= 1 ? requestedLongEdge : requestedLongEdge * ratio;
  let desiredHeight = ratio >= 1 ? requestedLongEdge / ratio : requestedLongEdge;
  const desiredPixels = desiredWidth * desiredHeight;

  if (desiredPixels > BFL_MAX_IMAGE_PIXELS) {
    const scale = Math.sqrt(BFL_MAX_IMAGE_PIXELS / desiredPixels);
    desiredWidth *= scale;
    desiredHeight *= scale;
  }

  const width = Math.max(BFL_MIN_IMAGE_EDGE, floorToMultiple(desiredWidth, BFL_SIZE_MULTIPLE));
  const height = Math.max(BFL_MIN_IMAGE_EDGE, floorToMultiple(desiredHeight, BFL_SIZE_MULTIPLE));

  if (width * height > BFL_MAX_IMAGE_PIXELS) {
    throw new Error('Valgt FLUX.2-storrelse overstiger 4MP-grensen.');
  }

  return { width, height };
}

function isValidOpenAIImageSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return false;
  }
  if (width <= 0 || height <= 0) {
    return false;
  }
  if (width > OPENAI_MAX_IMAGE_EDGE || height > OPENAI_MAX_IMAGE_EDGE) {
    return false;
  }
  if (width % OPENAI_SIZE_MULTIPLE !== 0 || height % OPENAI_SIZE_MULTIPLE !== 0) {
    return false;
  }
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (longEdge / shortEdge > OPENAI_MAX_IMAGE_RATIO) {
    return false;
  }
  const totalPixels = width * height;
  return totalPixels >= OPENAI_MIN_IMAGE_PIXELS && totalPixels <= OPENAI_MAX_IMAGE_PIXELS;
}

function nearestValidOpenAIImageSize(desiredWidth, desiredHeight) {
  const desiredRatio = desiredWidth / desiredHeight;
  let best = null;

  for (let width = OPENAI_SIZE_MULTIPLE; width <= OPENAI_MAX_IMAGE_EDGE; width += OPENAI_SIZE_MULTIPLE) {
    for (let height = OPENAI_SIZE_MULTIPLE; height <= OPENAI_MAX_IMAGE_EDGE; height += OPENAI_SIZE_MULTIPLE) {
      if (!isValidOpenAIImageSize(width, height)) {
        continue;
      }

      const ratioScore = Math.abs(Math.log((width / height) / desiredRatio)) * 4;
      const widthScore = Math.abs(Math.log(width / desiredWidth));
      const heightScore = Math.abs(Math.log(height / desiredHeight));
      const score = ratioScore + widthScore + heightScore;

      if (!best || score < best.score) {
        best = { width, height, score };
      }
    }
  }

  if (!best) {
    throw new Error('Klarte ikke finne en gyldig GPT Image 2-storrelse for valgt aspektforhold.');
  }

  return `${best.width}x${best.height}`;
}

function mapComparisonSizeToOpenAI(aspectRatio, resolution) {
  const { width: ratioWidth, height: ratioHeight } = parseAspectRatio(aspectRatio);
  const ratio = ratioWidth / ratioHeight;
  const longEdgeByResolution = {
    '1K': 1024,
    '2K': 2048,
    '4K': 3840
  };
  const longEdge = longEdgeByResolution[resolution] || longEdgeByResolution['2K'];
  const desiredWidth = ratio >= 1 ? longEdge : longEdge * ratio;
  const desiredHeight = ratio >= 1 ? longEdge / ratio : longEdge;
  return nearestValidOpenAIImageSize(desiredWidth, desiredHeight);
}

function validateExactOpenAIImageSize(widthValue, heightValue) {
  const width = Number(widthValue);
  const height = Number(heightValue);

  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error('Eksakt GPT Image 2-storrelse ma ha gyldig bredde og hoyde.');
  }
  if (width <= 0 || height <= 0) {
    throw new Error('Eksakt GPT Image 2-storrelse ma vaere storre enn 0 px.');
  }
  if (width > OPENAI_MAX_IMAGE_EDGE || height > OPENAI_MAX_IMAGE_EDGE) {
    throw new Error(`GPT Image 2 tillater maks ${OPENAI_MAX_IMAGE_EDGE}px pa lengste kant.`);
  }
  if (width % OPENAI_SIZE_MULTIPLE !== 0 || height % OPENAI_SIZE_MULTIPLE !== 0) {
    throw new Error(`GPT Image 2 krever at bredde og hoyde er delelige med ${OPENAI_SIZE_MULTIPLE}.`);
  }

  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (longEdge / shortEdge > OPENAI_MAX_IMAGE_RATIO) {
    throw new Error(`GPT Image 2 tillater maks ${OPENAI_MAX_IMAGE_RATIO}:1 forhold mellom lengste og korteste kant.`);
  }

  const totalPixels = width * height;
  if (totalPixels < OPENAI_MIN_IMAGE_PIXELS || totalPixels > OPENAI_MAX_IMAGE_PIXELS) {
    throw new Error(`GPT Image 2 krever mellom ${OPENAI_MIN_IMAGE_PIXELS.toLocaleString('nb-NO')} og ${OPENAI_MAX_IMAGE_PIXELS.toLocaleString('nb-NO')} pixler totalt.`);
  }

  return `${width}x${height}`;
}

function resolveOpenAIImageSize({ selectedModels, aspectRatio, resolution, openaiSizeMode, openaiWidth, openaiHeight }) {
  const canUseOpenAIFlexibleSize = onlySelectedProvider(selectedModels, 'openai');
  const normalizedSizeMode = typeof openaiSizeMode === 'string' && openaiSizeMode.trim() !== ''
    ? openaiSizeMode.trim()
    : OPENAI_DEFAULT_SIZE_MODE;

  if (canUseOpenAIFlexibleSize && normalizedSizeMode === 'auto') {
    return { size: 'auto', mode: 'auto' };
  }

  if (canUseOpenAIFlexibleSize && normalizedSizeMode === 'exact') {
    return {
      size: validateExactOpenAIImageSize(openaiWidth, openaiHeight),
      mode: 'exact'
    };
  }

  return {
    size: mapComparisonSizeToOpenAI(aspectRatio, resolution),
    mode: 'aspect'
  };
}

function buildAttemptPlan(resolution, includeAspectRatio) {
  const rawAttempts = [];

  rawAttempts.push({
    resolution,
    includeAspectRatio,
    label: 'requested',
    safetyMode: 'default'
  });

  if (includeAspectRatio) {
    rawAttempts.push({
      resolution,
      includeAspectRatio: false,
      label: 'no-aspect-ratio',
      safetyMode: 'default'
    });
  }

  if (resolution !== '1K') {
    rawAttempts.push({
      resolution: '1K',
      includeAspectRatio,
      label: 'fallback-1k',
      safetyMode: 'default'
    });
    rawAttempts.push({
      resolution: '1K',
      includeAspectRatio: false,
      label: 'fallback-1k-no-aspect-ratio',
      safetyMode: 'default'
    });
  }

  const defaultAttempts = [...rawAttempts];
  for (const attempt of defaultAttempts) {
    rawAttempts.push({
      resolution: attempt.resolution,
      includeAspectRatio: attempt.includeAspectRatio,
      label: `${attempt.label}-relaxed-safety`,
      safetyMode: 'relaxed'
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const attempt of rawAttempts) {
    const key = `${attempt.resolution}|${attempt.includeAspectRatio}|${attempt.safetyMode}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(attempt);
  }

  return deduped;
}

function fileToGenerativePart(path, mimeType) {
  return {
    inlineData: {
      data: fs.readFileSync(path).toString('base64'),
      mimeType
    }
  };
}

function saveInlineImage(base64Data, modelId) {
  const imageBuffer = Buffer.from(base64Data, 'base64');
  const modelSuffix = modelId.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const filename = `generated_${Date.now()}_${modelSuffix}.png`;
  const generatedDir = path.join(__dirname, 'public', 'generated');
  const filepath = path.join(generatedDir, filename);

  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  fs.writeFileSync(filepath, imageBuffer);
  return `/generated/${filename}`;
}

function saveImageBuffer(imageBuffer, modelId, contentType, fallbackExtension = 'png') {
  const normalizedContentType = String(contentType || '').split(';')[0].trim().toLowerCase();
  const extensionByContentType = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };
  const extension = extensionByContentType[normalizedContentType] || fallbackExtension;
  const modelSuffix = modelId.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const filename = `generated_${Date.now()}_${modelSuffix}.${extension}`;
  const generatedDir = path.join(__dirname, 'public', 'generated');
  const filepath = path.join(generatedDir, filename);

  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  fs.writeFileSync(filepath, imageBuffer);
  return `/generated/${filename}`;
}

function createImageModelResult(modelId, modelConfigMeta) {
  return {
    model: modelId,
    label: modelConfigMeta.label,
    text: null,
    image: null,
    groundingMetadata: null,
    error: null,
    debug: {
      attempts: []
    }
  };
}

function getOpenAIErrorMessage(status, responseData, responseText) {
  if (responseData && responseData.error && responseData.error.message) {
    return responseData.error.message;
  }
  if (responseData && responseData.error && typeof responseData.error === 'string') {
    return responseData.error;
  }
  if (responseText && responseText.trim()) {
    return responseText.trim().slice(0, 500);
  }
  return `OpenAI API returnerte status ${status}.`;
}

async function requestOpenAIImages(pathname, { jsonBody, formData }) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY mangler. Sett miljovariabelen for a bruke GPT Image 2.');
  }

  const headers = {
    Authorization: `Bearer ${OPENAI_API_KEY}`
  };
  const requestOptions = {
    method: 'POST',
    headers
  };

  if (jsonBody) {
    headers['Content-Type'] = 'application/json';
    requestOptions.body = JSON.stringify(jsonBody);
  } else {
    requestOptions.body = formData;
  }

  const baseUrl = OPENAI_API_BASE_URL.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}${pathname}`, requestOptions);
  const responseText = await response.text();
  let responseData = null;

  if (responseText) {
    try {
      responseData = JSON.parse(responseText);
    } catch (_error) {
      responseData = null;
    }
  }

  if (!response.ok) {
    throw new Error(getOpenAIErrorMessage(response.status, responseData, responseText));
  }

  if (!responseData || !Array.isArray(responseData.data) || !responseData.data[0] || !responseData.data[0].b64_json) {
    throw new Error('OpenAI returnerte ikke et base64-bilde.');
  }

  return responseData;
}

async function generateWithOpenAIImageModel(modelId, modelConfigMeta, requestContext) {
  const modelResult = createImageModelResult(modelId, modelConfigMeta);
  try {
    const { prompt, files, selectedModels, aspectRatio, resolution, openaiSizeMode, openaiWidth, openaiHeight } = requestContext;
    const resolvedSize = resolveOpenAIImageSize({
      selectedModels,
      aspectRatio,
      resolution,
      openaiSizeMode,
      openaiWidth,
      openaiHeight
    });

    modelResult.debug.attempts.push({
      label: 'requested',
      size: resolvedSize.size,
      sizeMode: resolvedSize.mode
    });

    const hasInputImages = files && files.length > 0;
    const responseData = hasInputImages
      ? await generateOpenAIImageEdit(modelId, prompt, files, resolvedSize.size)
      : await generateOpenAIImage(modelId, prompt, resolvedSize.size);

    modelResult.image = saveInlineImage(responseData.data[0].b64_json, modelId);
    if (responseData.data[0].revised_prompt) {
      modelResult.text = responseData.data[0].revised_prompt;
    }
    if (responseData.usage) {
      modelResult.debug.usage = responseData.usage;
    }
  } catch (error) {
    const message = error && error.message ? error.message : 'Ukjent OpenAI-feil';
    console.error(`Error from model ${modelId}:`, error);
    modelResult.error = message;
    if (modelResult.debug.attempts.length === 0) {
      modelResult.debug.attempts.push({
        label: 'requested',
        summary: `exception=${message}`
      });
    } else {
      modelResult.debug.attempts[modelResult.debug.attempts.length - 1].summary = `exception=${message}`;
    }
  }

  return modelResult;
}

async function generateOpenAIImage(modelId, prompt, size) {
  const payload = {
    model: modelId,
    prompt,
    size
  };

  return requestOpenAIImages('/images/generations', { jsonBody: payload });
}

async function generateOpenAIImageEdit(modelId, prompt, files, size) {
  const formData = new FormData();
  formData.append('model', modelId);
  formData.append('prompt', prompt);
  formData.append('size', size);

  for (const file of files) {
    const imageBlob = new Blob([fs.readFileSync(file.path)], { type: file.mimetype });
    formData.append('image[]', imageBlob, file.originalname || file.filename || 'image.png');
  }

  return requestOpenAIImages('/images/edits', { formData });
}

function getBflErrorMessage(status, responseData, responseText) {
  if (responseData && responseData.detail) {
    if (Array.isArray(responseData.detail)) {
      return responseData.detail
        .map((item) => item && item.msg ? item.msg : JSON.stringify(item))
        .join('; ');
    }
    if (typeof responseData.detail === 'string') {
      return responseData.detail;
    }
  }
  if (responseData && responseData.error) {
    return typeof responseData.error === 'string'
      ? responseData.error
      : JSON.stringify(responseData.error);
  }
  if (responseData && responseData.message) {
    return responseData.message;
  }
  if (responseText && responseText.trim()) {
    return responseText.trim().slice(0, 500);
  }
  return `BFL API returnerte status ${status}.`;
}

function resolveBflUrl(pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const baseUrl = BFL_API_BASE_URL.replace(/\/+$/, '');
  return `${baseUrl}/${String(pathOrUrl || '').replace(/^\/+/, '')}`;
}

async function requestBflJson(pathOrUrl, { method = 'GET', jsonBody = null } = {}) {
  if (!BFL_API_KEY) {
    throw new Error('BFL_API_KEY mangler. Sett miljovariabelen for a bruke FLUX.2 Max.');
  }

  const headers = {
    accept: 'application/json',
    'x-key': BFL_API_KEY
  };
  const requestOptions = {
    method,
    headers
  };

  if (jsonBody) {
    headers['Content-Type'] = 'application/json';
    requestOptions.body = JSON.stringify(jsonBody);
  }

  const response = await fetch(resolveBflUrl(pathOrUrl), requestOptions);
  const responseText = await response.text();
  let responseData = null;

  if (responseText) {
    try {
      responseData = JSON.parse(responseText);
    } catch (_error) {
      responseData = null;
    }
  }

  if (!response.ok) {
    throw new Error(getBflErrorMessage(response.status, responseData, responseText));
  }

  if (!responseData || typeof responseData !== 'object') {
    throw new Error('BFL returnerte ikke gyldig JSON.');
  }

  return responseData;
}

function getBflResultErrorMessage(resultData) {
  if (!resultData || typeof resultData !== 'object') {
    return 'BFL returnerte et ugyldig resultat.';
  }
  if (resultData.details && typeof resultData.details === 'object' && Object.keys(resultData.details).length > 0) {
    return `${resultData.status}: ${JSON.stringify(resultData.details).slice(0, 500)}`;
  }
  return `BFL-status: ${resultData.status || 'ukjent'}`;
}

async function pollBflResult(pollingUrl) {
  const deadline = Date.now() + BFL_POLL_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    const resultData = await requestBflJson(pollingUrl);
    const status = resultData.status;

    if (status === 'Ready') {
      const sampleUrl = resultData.result && resultData.result.sample;
      if (!sampleUrl) {
        throw new Error('BFL-resultatet manglet result.sample.');
      }
      return resultData;
    }

    if (status === 'Error' || status === 'Failed' || status === 'Task not found' || status === 'Request Moderated' || status === 'Content Moderated') {
      throw new Error(getBflResultErrorMessage(resultData));
    }

    await new Promise((resolve) => setTimeout(resolve, BFL_POLL_INTERVAL_MS));
  }

  throw new Error(`BFL-resultatet ble ikke klart innen ${Math.ceil(BFL_POLL_TIMEOUT_MS / 1000)} sekunder.`);
}

function appendBflInputImages(payload, files, maxInputImages) {
  if (!files || files.length === 0) {
    return;
  }

  files.slice(0, maxInputImages).forEach((file, index) => {
    const fieldName = index === 0 ? 'input_image' : `input_image_${index + 1}`;
    payload[fieldName] = fs.readFileSync(file.path).toString('base64');
  });
}

async function downloadBflImage(sampleUrl, modelId, outputFormat) {
  const response = await fetch(sampleUrl);
  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(responseText && responseText.trim()
      ? responseText.trim().slice(0, 500)
      : `Klarte ikke laste ned BFL-bildet (${response.status}).`);
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';
  return saveImageBuffer(imageBuffer, modelId, contentType, outputFormat);
}

async function generateWithBflImageModel(modelId, modelConfigMeta, requestContext) {
  const modelResult = createImageModelResult(modelId, modelConfigMeta);
  try {
    const { prompt, files, aspectRatio, resolution } = requestContext;
    const { width, height } = resolveBflImageSize(aspectRatio, resolution);
    const outputFormat = BFL_DEFAULT_OUTPUT_FORMAT;
    const payload = {
      prompt,
      width,
      height,
      safety_tolerance: 2,
      output_format: outputFormat
    };
    appendBflInputImages(payload, files, modelConfigMeta.maxInputImages || BFL_MAX_INPUT_IMAGES);

    modelResult.debug.attempts.push({
      label: 'requested',
      width,
      height,
      inputImages: files ? files.length : 0,
      outputFormat
    });

    const submitResponse = await requestBflJson(modelConfigMeta.endpoint, {
      method: 'POST',
      jsonBody: payload
    });
    const pollingUrl = submitResponse.polling_url || (submitResponse.id
      ? resolveBflUrl(`/get_result?id=${encodeURIComponent(submitResponse.id)}`)
      : '');

    if (!pollingUrl) {
      throw new Error('BFL returnerte ikke polling_url.');
    }

    modelResult.debug.requestId = submitResponse.id || null;
    modelResult.debug.cost = submitResponse.cost || null;
    modelResult.debug.inputMp = submitResponse.input_mp || null;
    modelResult.debug.outputMp = submitResponse.output_mp || null;

    const resultData = await pollBflResult(pollingUrl);
    modelResult.image = await downloadBflImage(resultData.result.sample, modelId, outputFormat);
    modelResult.debug.status = resultData.status;
    if (resultData.details) {
      modelResult.debug.details = resultData.details;
    }
  } catch (error) {
    const message = error && error.message ? error.message : 'Ukjent BFL-feil';
    console.error(`Error from model ${modelId}:`, error);
    modelResult.error = message;
    if (modelResult.debug.attempts.length === 0) {
      modelResult.debug.attempts.push({
        label: 'requested',
        summary: `exception=${message}`
      });
    } else {
      modelResult.debug.attempts[modelResult.debug.attempts.length - 1].summary = `exception=${message}`;
    }
  }

  return modelResult;
}

async function generateWithGeminiImageModel(modelId, modelConfigMeta, requestContext) {
  const { parts, aspectRatio, resolution, useGoogleSearch } = requestContext;
  const modelResult = createImageModelResult(modelId, modelConfigMeta);
  const attemptPlan = buildAttemptPlan(
    resolution,
    Boolean(modelConfigMeta.supportsAspectRatio && aspectRatio)
  );
  let modelSucceeded = false;

  for (const attempt of attemptPlan) {
    const generationConfig = {
      temperature: 0.7,
      maxOutputTokens: 2048,
      imageConfig: {
        imageSize: attempt.resolution
      }
    };

    if (attempt.includeAspectRatio) {
      generationConfig.imageConfig.aspectRatio = aspectRatio;
    }

    const modelConfig = {
      model: modelId,
      generationConfig
    };

    if (useGoogleSearch === 'true' && modelConfigMeta.supportsGoogleSearch) {
      modelConfig.tools = [{ google_search: {} }];
    }

    if (attempt.safetyMode === 'relaxed') {
      modelConfig.safetySettings = RELAXED_SAFETY_SETTINGS;
    }

    try {
      console.log(`Calling model: ${modelId} (attempt=${attempt.label}, resolution=${attempt.resolution}, aspectRatio=${attempt.includeAspectRatio ? aspectRatio : 'none'}, safety=${attempt.safetyMode})`);
      const model = genAI.getGenerativeModel(modelConfig);
      const result = await model.generateContent(parts);
      const response = await result.response;
      const candidates = response.candidates || [];
      const debugSummary = summarizeResponseForDebug(response);
      modelResult.debug.attempts.push({
        label: attempt.label,
        resolution: attempt.resolution,
        aspectRatio: attempt.includeAspectRatio ? aspectRatio : null,
        safetyMode: attempt.safetyMode,
        summary: debugSummary
      });

      if (candidates.length === 0) {
        modelResult.error = `Ingen kandidater returnert fra modellen (${debugSummary}).`;
        continue;
      }

      const content = candidates[0].content;
      if (!content || !content.parts || content.parts.length === 0) {
        modelResult.error = `Tom respons fra modellen (${debugSummary}).`;
        continue;
      }

      for (const part of content.parts) {
        if (part.text) {
          modelResult.text = `${modelResult.text || ''}${part.text}`;
        } else if (part.inlineData && part.inlineData.data) {
          modelResult.image = saveInlineImage(part.inlineData.data, modelId);
        }
      }

      if (candidates[0].groundingMetadata) {
        modelResult.groundingMetadata = {
          searchEntryPoint: candidates[0].groundingMetadata.searchEntryPoint || null,
          groundingChunks: candidates[0].groundingMetadata.groundingChunks || null,
          webSearchQueries: candidates[0].groundingMetadata.webSearchQueries || null
        };
      }

      if (!modelResult.text && !modelResult.image) {
        modelResult.error = `Modellen returnerte ingen brukbar tekst eller bilde (${debugSummary}).`;
        continue;
      }

      modelResult.error = null;
      modelSucceeded = true;
      break;
    } catch (modelError) {
      console.error(`Error from model ${modelId} attempt ${attempt.label}:`, modelError);
      const message = modelError && modelError.message
        ? modelError.message
        : 'Ukjent modellfeil';
      modelResult.debug.attempts.push({
        label: attempt.label,
        resolution: attempt.resolution,
        aspectRatio: attempt.includeAspectRatio ? aspectRatio : null,
        safetyMode: attempt.safetyMode,
        summary: `exception=${message}`
      });
      modelResult.error = message;

      // Retry only for model-content issues; invalid API key/quota should fail fast.
      if (message.includes('API_KEY') || message.includes('quota') || message.includes('QUOTA_EXCEEDED')) {
        break;
      }
    }
  }

  if (!modelSucceeded && modelResult.error && modelResult.debug.attempts.length > 0) {
    modelResult.error = `${modelResult.error} (forsok: ${modelResult.debug.attempts.length})`;
  }

  return modelResult;
}

async function generateWithSelectedImageModel(modelId, requestContext) {
  const modelConfigMeta = IMAGE_MODEL_CONFIGS[modelId];
  if (modelConfigMeta.provider === 'openai') {
    return generateWithOpenAIImageModel(modelId, modelConfigMeta, requestContext);
  }
  if (modelConfigMeta.provider === 'bfl') {
    return generateWithBflImageModel(modelId, modelConfigMeta, requestContext);
  }
  return generateWithGeminiImageModel(modelId, modelConfigMeta, requestContext);
}

function createUnhandledModelErrorResult(modelId, error) {
  const modelConfigMeta = IMAGE_MODEL_CONFIGS[modelId] || { label: modelId || 'Modell' };
  const message = error && error.message ? error.message : 'Ukjent modellfeil';
  const modelResult = createImageModelResult(modelId, modelConfigMeta);
  modelResult.error = message;
  modelResult.debug.attempts.push({
    label: 'unhandled',
    summary: `exception=${message}`
  });
  return modelResult;
}

function cleanupUploadedFiles(files) {
  if (!files || !Array.isArray(files)) {
    return;
  }

  files.forEach((file) => {
    if (file && file.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  });
}

app.post('/generate', generateIpRateLimiter, generateUserRateLimiter, upload.array('images', 14), async (req, res) => {
  try {
    const {
      prompt,
      aspectRatio = '16:9',
      resolution = '2K',
      openaiSizeMode = OPENAI_DEFAULT_SIZE_MODE,
      openaiWidth,
      openaiHeight,
      useGoogleSearch,
      models
    } = req.body;

    if (!prompt) {
      cleanupUploadedFiles(req.files);
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const selectedModels = normalizeSelectedModels(models);
    if (selectedModels.length === 0) {
      cleanupUploadedFiles(req.files);
      return res.status(400).json({
        error: `Ingen gyldige modeller valgt. Tillatte modeller: ${Object.keys(IMAGE_MODEL_CONFIGS).join(', ')}`
      });
    }

    const fileValidationError = validateInlineInputFiles(req.files, selectedModels);
    if (fileValidationError) {
      cleanupUploadedFiles(req.files);
      return res.status(400).json({ error: fileValidationError });
    }

    const bflFileValidationError = validateBflInputFiles(req.files, selectedModels);
    if (bflFileValidationError) {
      cleanupUploadedFiles(req.files);
      return res.status(400).json({ error: bflFileValidationError });
    }

    if (selectedModelsIncludeProvider(selectedModels, 'openai')) {
      try {
        resolveOpenAIImageSize({
          selectedModels,
          aspectRatio,
          resolution,
          openaiSizeMode,
          openaiWidth,
          openaiHeight
        });
      } catch (sizeError) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ error: sizeError.message });
      }
    }

    const budgetResult = consumeGenerateBudget(selectedModels.length);
    if (!budgetResult.allowed) {
      cleanupUploadedFiles(req.files);
      res.setHeader('Retry-After', String(budgetResult.retryAfterSeconds));
      return res.status(429).json({ error: budgetResult.error });
    }

    // Build parts array based on input
    const parts = [];
    
    // Keep user prompt unchanged to avoid introducing extra policy-sensitive phrasing.
    parts.push(prompt);
    
    // Add images after the prompt for Gemini. Other providers read the uploaded files directly in their adapters.
    if (selectedModelsIncludeProvider(selectedModels, 'google') && req.files && req.files.length > 0) {
      for (const file of req.files) {
        const imagePart = fileToGenerativePart(file.path, file.mimetype);
        parts.push(imagePart);
      }
    }

    console.log('Sending image generation request with prompt:', parts[0]);
    console.log('Number of input images:', req.files ? req.files.length : 0);
    console.log('Total parts in request:', parts.length);

    console.log(`Calling ${selectedModels.length} selected model(s) in parallel: ${selectedModels.join(', ')}`);
    const modelPromises = selectedModels.map((selectedModel) => generateWithSelectedImageModel(selectedModel, {
      prompt,
      files: req.files || [],
      selectedModels,
      aspectRatio,
      resolution,
      openaiSizeMode,
      openaiWidth,
      openaiHeight,
      useGoogleSearch,
      parts
    }));
    const settledModelResults = await Promise.allSettled(modelPromises);
    const modelResults = settledModelResults.map((settledResult, index) => {
      if (settledResult.status === 'fulfilled') {
        return settledResult.value;
      }
      return createUnhandledModelErrorResult(selectedModels[index], settledResult.reason);
    });

    cleanupUploadedFiles(req.files);

    const hasAnySuccess = modelResults.some((item) => item.image || item.text);
    if (!hasAnySuccess) {
      return res.status(500).json({
        error: 'Ingen modeller returnerte gyldig innhold. Se detaljer per modell.',
        results: modelResults
      });
    }

    if (modelResults.length === 1) {
      const single = modelResults[0];
      return res.json({
        text: single.text,
        image: single.image,
        groundingMetadata: single.groundingMetadata,
        results: modelResults
      });
    }

    return res.json({
      results: modelResults
    });

  } catch (error) {
    console.error('Detailed error:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);

    cleanupUploadedFiles(req.files);
    
    let errorMessage = 'Failed to generate content';
    
    if (error.message.includes('API_KEY')) {
      errorMessage = 'Invalid or missing Google API key. Please check your .env file.';
    } else if (error.message.includes('INVALID_ARGUMENT')) {
      errorMessage = 'Ugyldig foresporsel til modellen. Sjekk modellvalg og parametre.';
    } else if (error.message.includes('quota') || error.message.includes('QUOTA_EXCEEDED')) {
      errorMessage = 'API quota exceeded. Please try again later.';
    } else if (error.message.includes('safety') || error.message.includes('SAFETY')) {
      errorMessage = 'Content blocked by safety filters. Please try a different prompt.';
    } else if (error.message.includes('network') || error.message.includes('NETWORK')) {
      errorMessage = 'Network error. Please check your internet connection.';
    } else if (error.message.includes('UNSUPPORTED') || error.message.includes('not supported')) {
      errorMessage = 'This type of request is not supported by the model yet.';
    }
    
    res.status(500).json({ error: errorMessage + ' - ' + error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Filen er for stor. Maksimum størrelse er 50MB per fil.' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'For mange filer. Maksimum 14 filer tillatt.' });
    }
    return res.status(400).json({ error: 'Fileopplastingsfeil: ' + error.message });
  }

  if (req.path && req.path.startsWith('/generate')) {
    return res.status(500).json({ error: 'Server feil: ' + error.message });
  }

  return next(error);
});
