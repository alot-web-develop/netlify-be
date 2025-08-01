const https = require('https');
const { URL } = require('url');
const { handleCorsAndMethod } = require('../../lib/cors-handler');
const OAuth2TokenManager = require('../../lib/oauth2-manager');
const { uploadSessions } = require('../../lib/utils/upload-utils');

const tokenManager = new OAuth2TokenManager();

/**
 * Handle chunked file upload
 * @param {Object} event - Lambda event object
 * @returns {Promise<Object>} HTTP response
 */
exports.handler = async (event) => {
  // Handle CORS and validate HTTP method
  const corsCheck = handleCorsAndMethod(event, 'PUT', 'Content-Type, Content-Length, Content-Range');
  if (corsCheck.statusCode) {
    return corsCheck;
  }
  const { corsHeaders } = corsCheck;

  try {
    const sessionId = event.queryStringParameters?.session;
    const chunkIndex = parseInt(event.queryStringParameters?.chunk || '0');
    
    if (!sessionId) {
      return {
        statusCode: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: "Missing session parameter" }),
      };
    }

    const sessionData = uploadSessions.get(sessionId);
    if (!sessionData || !sessionData.chunks) {
      return {
        statusCode: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: "Invalid session or not a chunked upload" }),
      };
    }

    const { uploadUrl, fileName, fileSize, mimeType, chunks } = sessionData;

    // Calculate range for this chunk
    const chunkSize = chunks.chunkSize;
    const startByte = chunkIndex * chunkSize;
    const endByte = Math.min(startByte + chunkSize - 1, fileSize - 1);
    const contentLength = endByte - startByte + 1;

    // Get access token for Google Drive
    let accessToken;
    try {
      accessToken = await tokenManager.getAccessToken();
    } catch (tokenError) {
      return {
        statusCode: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Authentication failed - token refresh error' }),
      };
    }

    // Upload chunk to Google Drive
    const result = await uploadChunkToGoogleDrive({
      uploadUrl,
      chunkData: event.body,
      isBase64Encoded: event.isBase64Encoded,
      startByte,
      endByte,
      totalSize: fileSize,
      accessToken,
      mimeType,
      contentLength
    });

    // Update chunk progress
    chunks.uploadedChunks++;
    chunks.uploadedBytes += contentLength;

    const isComplete = chunks.uploadedChunks >= chunks.totalChunks;
    
    if (isComplete) {
      // Clean up session when upload is complete
      uploadSessions.delete(sessionId);
    }

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        chunkIndex,
        uploadedChunks: chunks.uploadedChunks,
        totalChunks: chunks.totalChunks,
        uploadedBytes: chunks.uploadedBytes,
        totalBytes: fileSize,
        isComplete,
        fileId: result?.fileId,
        fileName,
        viewUrl: result?.viewUrl,
        downloadUrl: result?.downloadUrl,
        message: isComplete ? "File upload completed" : `Chunk ${chunkIndex + 1}/${chunks.totalChunks} uploaded`
      }),
    };

  } catch (error) {
    return {
      statusCode: 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        error: "Chunk upload failed",
        details: error.message 
      }),
    };
  }
};

/**
 * Upload a single chunk to Google Drive
 * @param {Object} params - Upload parameters
 * @returns {Promise<Object>} Upload result
 */
async function uploadChunkToGoogleDrive({
  uploadUrl,
  chunkData,
  isBase64Encoded,
  startByte,
  endByte,
  totalSize,
  accessToken,
  mimeType,
  contentLength
}) {
  return new Promise((resolve, reject) => {
    const uploadUrlParsed = new URL(uploadUrl);
    
    const options = {
      hostname: uploadUrlParsed.hostname,
      port: 443,
      path: uploadUrlParsed.pathname + uploadUrlParsed.search,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': mimeType,
        'Content-Length': contentLength.toString(),
        'Content-Range': `bytes ${startByte}-${endByte}/${totalSize}`,
      }
    };

    const proxyReq = https.request(options, (proxyRes) => {
      let responseData = '';
      proxyRes.on('data', chunk => responseData += chunk);
      
      proxyRes.on('end', () => {
        if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 400) {
          try {
            // Check if this is the final chunk (Google returns file info)
            if (proxyRes.statusCode === 200 || proxyRes.statusCode === 201) {
              const result = JSON.parse(responseData);
              resolve({
                fileId: result.id,
                viewUrl: result.id ? `https://drive.google.com/file/d/${result.id}/view` : null,
                downloadUrl: result.id ? `https://drive.google.com/uc?id=${result.id}` : null
              });
            } else {
              // Intermediate chunk (308 Resume Incomplete)
              resolve({ success: true });
            }
          } catch (parseError) {
            // Handle non-JSON responses
            resolve({ success: true, rawResponse: responseData });
          }
        } else {
          reject(new Error(`Chunk upload failed: ${proxyRes.statusCode} - ${responseData}`));
        }
      });
    });

    proxyReq.on('error', (error) => {
      reject(error);
    });
    
    // Add timeout
    proxyReq.setTimeout(300000, () => {
      proxyReq.destroy();
      reject(new Error('Chunk upload timeout'));
    });

    if (chunkData) {
      const buffer = isBase64Encoded 
        ? Buffer.from(chunkData, 'base64')
        : Buffer.from(chunkData);
      
      proxyReq.write(buffer);
    }
    
    proxyReq.end();
  });
}