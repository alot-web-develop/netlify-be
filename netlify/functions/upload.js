const OAuth2TokenManager = require("../../lib/oauth2-manager");
const { targetFolderId } = require("../../lib/config");
const { handleCorsAndMethod } = require("../../lib/cors-handler");
const {
  ValidationError,
  GoogleDriveError,
  validateUploadRequest,
  createGoogleDriveSession,
  generateNetlifyUploadUrl,
  storeUploadSession,
  extractSessionId,
  createUploadResponse,
  createErrorResponse,
  cleanupExpiredSessions
} = require("../../lib/utils/upload-utils");

const tokenManager = new OAuth2TokenManager();

/**
 * Authenticate request using Bearer token
 * @param {Object} event - Lambda event object
 * @returns {boolean} True if authenticated
 */
function authenticateRequest(event) {
  const AUTH_SECRET = process.env.SHARED_KEY;
  const authHeader = event.headers.authorization;
  return authHeader === `Bearer ${AUTH_SECRET}`;
}

/**
 * Main upload handler - creates a resumable upload session
 * @param {Object} event - Lambda event object
 * @returns {Promise<Object>} HTTP response
 */
exports.handler = async (event) => {
  // Handle CORS and validate HTTP method
  const corsCheck = handleCorsAndMethod(
    event,
    "POST",
    "Content-Type, Authorization"
  );

  if (corsCheck.statusCode) return corsCheck;
  const { corsHeaders } = corsCheck;

  // Authenticate request
  if (!authenticateRequest(event)) {
    return createErrorResponse(401, "Unauthorized", corsHeaders);
  }

  // Clean up expired sessions periodically
  cleanupExpiredSessions();

  try {
    // Parse and validate request body
    let requestBody;
    try {
      requestBody = JSON.parse(event.body);
    } catch (parseError) {
      return createErrorResponse(400, "Invalid JSON in request body", corsHeaders);
    }

    const { fileName, fileSize, mimeType } = validateUploadRequest(requestBody);

    // Get Google Drive access token
    const accessToken = await tokenManager.getAccessToken();

    // Create resumable upload session with Google Drive
    const googleUploadUrl = await createGoogleDriveSession({
      fileName,
      fileSize,
      mimeType,
      targetFolderId,
      accessToken
    });

    // Extract session ID and create Netlify proxy URL
    const sessionId = extractSessionId(googleUploadUrl);
    const netlifyUploadUrl = generateNetlifyUploadUrl(sessionId, event.headers.origin);

    // Store session data for later use by upload-proxy
    storeUploadSession(sessionId, {
      uploadUrl: googleUploadUrl,
      fileName,
      fileSize,
      mimeType
    });

    // Return success response with upload instructions
    return createUploadResponse({
      uploadUrl: netlifyUploadUrl,
      sessionId,
      fileName,
      fileSize,
      mimeType,
      corsHeaders
    });

  } catch (error) {
    // Handle specific error types
    if (error instanceof ValidationError) {
      return createErrorResponse(400, error.message, corsHeaders);
    }

    if (error instanceof GoogleDriveError) {
      const statusCode = error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 502;
      return createErrorResponse(statusCode, error.message, corsHeaders);
    }

    // Handle OAuth token errors
    if (error.message?.includes('token') || error.message?.includes('auth')) {
      return createErrorResponse(401, "Authentication failed", corsHeaders, error.message);
    }

    // Generic error fallback
    console.error('Upload session creation failed:', error);
    return createErrorResponse(500, "Failed to create upload session", corsHeaders, error.message);
  }
};
