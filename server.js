const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 7654;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 2
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
      return res.status(400).json({ error: 'For mange filer. Maksimum 2 filer tillatt.' });
    }
    return res.status(400).json({ error: 'Fileopplastingsfeil: ' + error.message });
  }
  return res.status(500).json({ error: 'Server feil: ' + error.message });
});

app.post('/generate', upload.array('images', 2), async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-3-pro-image-preview',
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      }
    });
    
    // Build parts array based on input
    const parts = [];
    
    // Add prompt first
    if (req.files && req.files.length > 0) {
      // When we have images, be more explicit about what we want
      if (req.files.length === 1) {
        parts.push(`Based on this image: ${prompt}`);
      } else if (req.files.length === 2) {
        parts.push(`Using these two images: ${prompt}`);
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

    if (req.files) {
      req.files.forEach(file => {
        fs.unlinkSync(file.path);
      });
    }

    res.json({
      text: generatedText || null,
      image: generatedImage
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