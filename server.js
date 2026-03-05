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

const app = express();
const PORT = process.env.PORT || 7654;
const isProduction = process.env.NODE_ENV === 'production';
const BASIC_AUTH_USER =
  process.env.BASIC_AUTH_USERNAME ||
  envFromFile.BASIC_AUTH_USERNAME ||
  envFromFile.USERNAME ||
  process.env.USERNAME;
const BASIC_AUTH_PASSWORD =
  process.env.BASIC_AUTH_PASSWORD ||
  envFromFile.BASIC_AUTH_PASSWORD ||
  envFromFile.PASSWORD ||
  process.env.PASSWORD;
const authEnabled = Boolean(BASIC_AUTH_USER && BASIC_AUTH_PASSWORD);
const AUTH_COOKIE_NAME = 'studio_auth';
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours
const AUTH_SESSION_SECRET =
  process.env.AUTH_SESSION_SECRET ||
  envFromFile.AUTH_SESSION_SECRET ||
  BASIC_AUTH_PASSWORD ||
  'fallback-auth-secret';
const EXPECTED_AUTH_TOKEN = crypto
  .createHash('sha256')
  .update(`${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}:${AUTH_SESSION_SECRET}`)
  .digest('hex');

if (isProduction && !authEnabled) {
  throw new Error('Set USERNAME/PASSWORD or BASIC_AUTH_USERNAME/BASIC_AUTH_PASSWORD when NODE_ENV=production');
}

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

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
    cookies[key] = decodeURIComponent(value);
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

app.post('/login', (req, res) => {
  if (!authEnabled) {
    return res.redirect('/');
  }

  const { username = '', password = '' } = req.body;
  if (username === BASIC_AUTH_USER && password === BASIC_AUTH_PASSWORD) {
    res.setHeader('Set-Cookie', authCookieHeader(req));
    return res.redirect('/');
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

  const publicPaths = new Set(['/health', '/login', '/favicon.svg']);
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

function fileToGenerativePart(path, mimeType) {
  return {
    inlineData: {
      data: fs.readFileSync(path).toString('base64'),
      mimeType
    }
  };
}

// Error handling middleware for multer
app.use('/generate', (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Filen er for stor. Maksimum størrelse er 50MB per fil.' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'For mange filer. Maksimum 14 filer tillatt.' });
    }
    return res.status(400).json({ error: 'Fileopplastingsfeil: ' + error.message });
  }
  return res.status(500).json({ error: 'Server feil: ' + error.message });
});

app.post('/generate', upload.array('images', 14), async (req, res) => {
  try {
    const { prompt, aspectRatio = '16:9', resolution = '2K', useGoogleSearch } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const generationConfig = {
      temperature: 0.7,
      maxOutputTokens: 2048,
      imageConfig: {
        aspectRatio: aspectRatio,
        imageSize: resolution
      }
    };

    // Build model config
    const modelConfig = {
      model: 'gemini-3-pro-image-preview',
      generationConfig: generationConfig
    };

    // Add Google Search tool if enabled
    if (useGoogleSearch === 'true') {
      modelConfig.tools = [{"google_search": {}}];
    }

    const model = genAI.getGenerativeModel(modelConfig);
    
    // Build parts array based on input
    const parts = [];
    
    // Add prompt first
    if (req.files && req.files.length > 0) {
      // When we have images, be more explicit about what we want
      if (req.files.length === 1) {
        parts.push(`Based on this image: ${prompt}`);
      } else {
        parts.push(`Using these ${req.files.length} reference images: ${prompt}`);
      }
    } else {
      // No input images, generate from scratch
      parts.push(`Generate an image: ${prompt}`);
    }
    
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
    
    const result = await model.generateContent(parts);
    const response = await result.response;
    
    console.log('Response received from Gemini');
    
    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
      console.log('No candidates in response');
      console.log('Full response:', JSON.stringify(response, null, 2));
      
      // Special handling for multi-image requests
      if (req.files && req.files.length > 1) {
        return res.status(500).json({ 
          error: 'Multi-image fusion ikke tilgjengelig ennå. Prøv med ett bilde om gangen, eller uten bilder for tekst-til-bilde generering.' 
        });
      }
      
      return res.status(500).json({ error: 'Ingen innhold generert. Prøv en annen beskrivelse.' });
    }

    const content = candidates[0].content;
    if (!content || !content.parts) {
      console.log('No content or parts in response');
      console.log('Content:', content);
      return res.status(500).json({ error: 'Tom respons fra modellen. Prøv en annen beskrivelse.' });
    }
    
    const parts_response = content.parts;
    
    console.log('Number of parts in response:', parts_response.length);

    let generatedText = '';
    let generatedImage = null;

    for (const part of parts_response) {
      console.log('Processing part:', part.text ? 'text' : part.inlineData ? 'image' : 'unknown');

      if (part.text) {
        generatedText += part.text;
      } else if (part.inlineData) {
        console.log('Found image data, saving...');
        const imageBuffer = Buffer.from(part.inlineData.data, 'base64');
        const filename = `generated_${Date.now()}.png`;
        const filepath = path.join(__dirname, 'public', 'generated', filename);

        if (!fs.existsSync(path.join(__dirname, 'public', 'generated'))) {
          fs.mkdirSync(path.join(__dirname, 'public', 'generated'), { recursive: true });
        }

        fs.writeFileSync(filepath, imageBuffer);
        generatedImage = `/generated/${filename}`;
        console.log('Image saved:', filename);
      }
    }

    // Extract grounding metadata if available (from Google Search)
    let groundingMetadata = null;
    if (candidates[0].groundingMetadata) {
      console.log('Found grounding metadata');
      groundingMetadata = {
        searchEntryPoint: candidates[0].groundingMetadata.searchEntryPoint || null,
        groundingChunks: candidates[0].groundingMetadata.groundingChunks || null,
        webSearchQueries: candidates[0].groundingMetadata.webSearchQueries || null
      };
    }

    if (req.files) {
      req.files.forEach(file => {
        fs.unlinkSync(file.path);
      });
    }

    res.json({
      text: generatedText || null,
      image: generatedImage,
      groundingMetadata: groundingMetadata
    });

  } catch (error) {
    console.error('Detailed error:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }
    
    let errorMessage = 'Failed to generate content';
    
    if (error.message.includes('API_KEY') || error.message.includes('INVALID_ARGUMENT')) {
      errorMessage = 'Invalid or missing Google API key. Please check your .env file.';
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
