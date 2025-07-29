const https = require('https');
const { URL } = require('url');
const { handleCorsAndMethod } = require('../../lib/cors-handler');
const OAuth2TokenManager = require('../../lib/oauth2-manager');
const { allowedOrigins } = require('../../lib/config');

const tokenManager = new OAuth2TokenManager();


exports.handler = async (event) => {
  // Gestione CORS e controllo metodo HTTP
  const corsCheck = handleCorsAndMethod(event, 'PUT', 'Content-Type, Content-Length');
  if (corsCheck.statusCode) {
    return corsCheck; // Risposta preflight o errore metodo
  }
  const { corsHeaders } = corsCheck;

  try {
    const sessionId = event.queryStringParameters?.session;
    
    if (!sessionId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Missing session parameter" }),
      };
    }

    global.uploadSessions = global.uploadSessions || new Map();
    const sessionData = global.uploadSessions.get(sessionId);

    if (!sessionData) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Session not found or expired" }),
      };
    }

    const { uploadUrl, fileName, fileSize, mimeType } = sessionData;
    
    let accessToken;
    try {
      accessToken = await tokenManager.getAccessToken();
    } catch (tokenError) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Authentication failed - token refresh error' }),
      };
    }

    const result = await new Promise((resolve, reject) => {
      const uploadUrlParsed = new URL(uploadUrl);
      
      const options = {
        hostname: uploadUrlParsed.hostname,
        port: 443,
        path: uploadUrlParsed.pathname + uploadUrlParsed.search,
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': mimeType,
          'Content-Length': event.headers['content-length'] || fileSize.toString(),
        }
      };

      const proxyReq = https.request(options, (proxyRes) => {
        let responseData = '';
        proxyRes.on('data', chunk => responseData += chunk);
        
        proxyRes.on('end', () => {
          if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
            try {
              const result = JSON.parse(responseData);
              global.uploadSessions.delete(sessionId);
              resolve(result);
            } catch (parseError) {
              resolve({ success: true, rawResponse: responseData });
            }
          } else {
            reject(new Error(`Upload failed: ${proxyRes.statusCode} - ${responseData}`));
          }
        });
      });

      proxyReq.on('error', reject);

      if (event.body) {
        const buffer = event.isBase64Encoded 
          ? Buffer.from(event.body, 'base64')
          : Buffer.from(event.body);
        
        proxyReq.write(buffer);
      }
      
      proxyReq.end();
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        fileId: result.id,
        fileName,
        viewUrl: result.id ? `https://drive.google.com/file/d/${result.id}/view` : null,
        downloadUrl: result.id ? `https://drive.google.com/uc?id=${result.id}` : null,
        message: "File uploaded successfully"
      }),
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: "Upload failed",
        details: error.message 
      }),
    };
  }
};