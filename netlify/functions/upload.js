const OAuth2TokenManager = require("../../lib/oauth2-manager");
const { uploadFolderId } = require("../../lib/config");
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
  cleanupExpiredSessions,
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
  const corsCheck = handleCorsAndMethod(
    event,
    "POST",
    "Content-Type, Authorization"
  );

  if (corsCheck.statusCode) return corsCheck;
  const { corsHeaders } = corsCheck;

  if (!authenticateRequest(event)) {
    return createErrorResponse(401, "Unauthorized", corsHeaders);
  }

  // Clean up expired sessions periodically
  cleanupExpiredSessions();

  try {
    let requestBody;
    try {
      requestBody = JSON.parse(event.body);
      console.log("Parsed request body:", requestBody);
    } catch (parseError) {
      return createErrorResponse(
        400,
        "Invalid JSON in request body",
        corsHeaders
      );
    }

    const { fileName, fileSize, mimeType, requiresChunking } =
      validateUploadRequest(requestBody);
    const accessToken = await tokenManager.getAccessToken();

    // Create RESUMABLE upload session in Google Drive
    const googleUploadUrl = await createGoogleDriveSession({
      fileName,
      fileSize,
      mimeType,
      uploadFolderId,
      accessToken,
    });

    // Extract session ID and create Netlify proxy URL
    const sessionId = extractSessionId(googleUploadUrl);
    const netlifyUploadUrl = generateNetlifyUploadUrl(
      sessionId,
      event.headers.origin
    );

    // Store session data for later use by upload-proxy or chunked upload
    storeUploadSession(sessionId, {
      fileName,
      fileSize,
      mimeType,
      requiresChunking,
    });

    return createUploadResponse({
      uploadUrl: requiresChunking ? null : netlifyUploadUrl, // Null for chunked uploads
      sessionId,
      fileName,
      fileSize,
      mimeType,
      requiresChunking,
      corsHeaders,
    });
  } catch (error) {
    return errorsHandler(error, corsHeaders);
  }
};

const errorsHandler = (error, corsHeaders) => {
  const [isValidationError, isGoogleDriveError, isAuthError] = [
    error instanceof ValidationError,
    error instanceof GoogleDriveError,
    error.message?.includes("token") || error.message?.includes("auth"),
  ];

  if (isValidationError)
    return createErrorResponse(400, error.message, corsHeaders);

  if (isGoogleDriveError) {
    const statusCode =
      error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 502;
    return createErrorResponse(statusCode, error.message, corsHeaders);
  }

  if (isAuthError) {
    {
      return createErrorResponse(
        401,
        "Authentication failed",
        corsHeaders,
        error.message
      );
    }
  }

  return createErrorResponse(
    500,
    "Failed to create upload session",
    corsHeaders,
    error.message
  );
};
