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

function consumeGenerateBudget() {
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

  if (GENERATE_MAX_PER_HOUR > 0 && generateBudgetState.hourCount >= GENERATE_MAX_PER_HOUR) {
    return {
      allowed: false,
      error: 'Timekvoten for bildegenerering er brukt opp. Prov igjen neste time.',
      retryAfterSeconds: secondsUntilNextUtcHour(nowMs)
    };
  }

  if (GENERATE_MAX_PER_DAY > 0 && generateBudgetState.dayCount >= GENERATE_MAX_PER_DAY) {
    return {
      allowed: false,
      error: 'Dognkvoten for bildegenerering er brukt opp. Prov igjen i morgen.',
      retryAfterSeconds: secondsUntilNextUtcDay(nowMs)
    };
  }

  generateBudgetState.hourCount += 1;
  generateBudgetState.dayCount += 1;
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

const IMAGE_MODEL_CONFIGS = {
  'gemini-3.1-flash-image-preview': {
    label: 'Gemini 3.1 Flash Image Preview',
    supportsAspectRatio: true,
    supportsGoogleSearch: false
  },
  'gemini-3-pro-image-preview': {
    label: 'Gemini 3 Pro Image Preview',
    supportsAspectRatio: true,
    supportsGoogleSearch: false
  }
};
const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';
const MAX_INLINE_IMAGE_BYTES = 7 * 1024 * 1024;
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

function validateInlineInputFiles(files) {
  if (!files || !Array.isArray(files) || files.length === 0) {
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
      useGoogleSearch,
      models
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const fileValidationError = validateInlineInputFiles(req.files);
    if (fileValidationError) {
      cleanupUploadedFiles(req.files);
      return res.status(400).json({ error: fileValidationError });
    }

    const selectedModels = normalizeSelectedModels(models);
    if (selectedModels.length === 0) {
      return res.status(400).json({
        error: `Ingen gyldige modeller valgt. Tillatte modeller: ${Object.keys(IMAGE_MODEL_CONFIGS).join(', ')}`
      });
    }

    const budgetResult = consumeGenerateBudget();
    if (!budgetResult.allowed) {
      res.setHeader('Retry-After', String(budgetResult.retryAfterSeconds));
      return res.status(429).json({ error: budgetResult.error });
    }

    // Build parts array based on input
    const parts = [];
    
    // Keep user prompt unchanged to avoid introducing extra policy-sensitive phrasing.
    parts.push(prompt);
    
    // Add images after the prompt
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const imagePart = fileToGenerativePart(file.path, file.mimetype);
        parts.push(imagePart);
      }
    }

    console.log('Sending request to Gemini with prompt:', parts[0]);
    console.log('Number of input images:', req.files ? req.files.length : 0);
    console.log('Total parts in request:', parts.length);

    const modelResults = [];
    for (const selectedModel of selectedModels) {
      const modelConfigMeta = IMAGE_MODEL_CONFIGS[selectedModel];
      const modelResult = {
        model: selectedModel,
        label: modelConfigMeta.label,
        text: null,
        image: null,
        groundingMetadata: null,
        error: null,
        debug: {
          attempts: []
        }
      };

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
          model: selectedModel,
          generationConfig
        };

        if (useGoogleSearch === 'true' && modelConfigMeta.supportsGoogleSearch) {
          modelConfig.tools = [{ google_search: {} }];
        }

        if (attempt.safetyMode === 'relaxed') {
          modelConfig.safetySettings = RELAXED_SAFETY_SETTINGS;
        }

        try {
          console.log(`Calling model: ${selectedModel} (attempt=${attempt.label}, resolution=${attempt.resolution}, aspectRatio=${attempt.includeAspectRatio ? aspectRatio : 'none'}, safety=${attempt.safetyMode})`);
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
              modelResult.image = saveInlineImage(part.inlineData.data, selectedModel);
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
          console.error(`Error from model ${selectedModel} attempt ${attempt.label}:`, modelError);
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

      modelResults.push(modelResult);
    }

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
