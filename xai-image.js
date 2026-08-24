const fs = require('fs');

const XAI_MAX_INPUT_IMAGES = 3;
const XAI_DEFAULT_QUALITY = 'medium';
const XAI_SUPPORTED_ASPECT_RATIOS = [
  '1:2',
  '9:20',
  '9:19.5',
  '9:16',
  '2:3',
  '3:4',
  '1:1',
  '4:3',
  '3:2',
  '16:9',
  '19.5:9',
  '20:9',
  '2:1'
];

function aspectRatioAsNumber(aspectRatio) {
  const [rawWidth, rawHeight] = String(aspectRatio || '').split(':');
  const width = Number.parseFloat(rawWidth);
  const height = Number.parseFloat(rawHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return width / height;
}

function resolveXaiAspectRatio(aspectRatio) {
  if (XAI_SUPPORTED_ASPECT_RATIOS.includes(aspectRatio)) {
    return aspectRatio;
  }

  const requestedRatio = aspectRatioAsNumber(aspectRatio);
  if (!requestedRatio) {
    return '16:9';
  }

  return XAI_SUPPORTED_ASPECT_RATIOS.reduce((nearest, candidate) => {
    const candidateRatio = aspectRatioAsNumber(candidate);
    const distance = Math.abs(Math.log(candidateRatio / requestedRatio));
    if (!nearest || distance < nearest.distance) {
      return { aspectRatio: candidate, distance };
    }
    return nearest;
  }, null).aspectRatio;
}

function resolveXaiResolution(resolution) {
  const normalizedResolution = String(resolution || '').toLowerCase();
  return normalizedResolution === '2k' || normalizedResolution === '4k' ? '2k' : '1k';
}

function getXaiErrorMessage(status, responseData, responseText) {
  if (responseData && responseData.error && responseData.error.message) {
    return responseData.error.message;
  }
  if (responseData && responseData.error && typeof responseData.error === 'string') {
    return responseData.error;
  }
  if (responseData && responseData.message) {
    return responseData.message;
  }
  if (responseText && responseText.trim()) {
    return responseText.trim().slice(0, 500);
  }
  return `xAI API returnerte status ${status}.`;
}

function fileToXaiImage(file) {
  const mimeType = file.mimetype || 'image/webp';
  const base64Data = fs.readFileSync(file.path).toString('base64');
  return {
    type: 'image_url',
    url: `data:${mimeType};base64,${base64Data}`
  };
}

function buildXaiImageRequest({ modelId, prompt, files, aspectRatio, resolution }) {
  const inputFiles = Array.isArray(files) ? files : [];
  if (inputFiles.length > XAI_MAX_INPUT_IMAGES) {
    throw new Error(`Grok Imagine stotter maks ${XAI_MAX_INPUT_IMAGES} referansebilder via API.`);
  }

  const payload = {
    model: modelId,
    prompt,
    aspect_ratio: resolveXaiAspectRatio(aspectRatio),
    resolution: resolveXaiResolution(resolution),
    quality: XAI_DEFAULT_QUALITY,
    response_format: 'b64_json'
  };

  if (inputFiles.length === 1) {
    payload.image = fileToXaiImage(inputFiles[0]);
  } else if (inputFiles.length > 1) {
    payload.images = inputFiles.map(fileToXaiImage);
  }

  return {
    pathname: inputFiles.length > 0 ? '/images/edits' : '/images/generations',
    payload
  };
}

async function parseJsonResponse(response) {
  const responseText = await response.text();
  let responseData = null;
  if (responseText) {
    try {
      responseData = JSON.parse(responseText);
    } catch (_error) {
      responseData = null;
    }
  }
  return { responseData, responseText };
}

async function requestXaiImage({
  apiKey,
  baseUrl,
  modelId,
  prompt,
  files,
  aspectRatio,
  resolution,
  fetchImpl = fetch
}) {
  if (!apiKey) {
    throw new Error('XAI_API_KEY mangler. Sett miljovariabelen for a bruke Grok Imagine.');
  }

  const request = buildXaiImageRequest({ modelId, prompt, files, aspectRatio, resolution });
  const normalizedBaseUrl = String(baseUrl || 'https://api.x.ai/v1').replace(/\/+$/, '');
  const response = await fetchImpl(`${normalizedBaseUrl}${request.pathname}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request.payload)
  });
  const { responseData, responseText } = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(getXaiErrorMessage(response.status, responseData, responseText));
  }

  const imageData = responseData && Array.isArray(responseData.data)
    ? responseData.data[0]
    : null;
  if (!imageData) {
    throw new Error('xAI returnerte ikke et bilde.');
  }

  let imageBuffer;
  let contentType = imageData.mime_type || 'image/jpeg';
  if (imageData.b64_json) {
    imageBuffer = Buffer.from(imageData.b64_json, 'base64');
  } else if (imageData.url) {
    const imageResponse = await fetchImpl(imageData.url);
    if (!imageResponse.ok) {
      throw new Error(`Klarte ikke laste ned Grok-bildet (${imageResponse.status}).`);
    }
    imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    contentType = imageResponse.headers.get('content-type') || contentType;
  } else {
    throw new Error('xAI returnerte verken base64-data eller bilde-URL.');
  }

  if (imageBuffer.length === 0) {
    throw new Error('xAI returnerte et tomt bilde.');
  }

  return {
    imageBuffer,
    contentType,
    revisedPrompt: imageData.revised_prompt || null,
    usage: responseData.usage || null,
    request
  };
}

module.exports = {
  XAI_MAX_INPUT_IMAGES,
  XAI_SUPPORTED_ASPECT_RATIOS,
  buildXaiImageRequest,
  getXaiErrorMessage,
  requestXaiImage,
  resolveXaiAspectRatio,
  resolveXaiResolution
};
