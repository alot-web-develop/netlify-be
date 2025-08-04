const OAuth2TokenManager = require("../../lib/oauth2-manager");
const { uploadFolderId } = require("../../lib/config");
const { handleCorsAndMethod } = require("../../lib/cors-handler");
const {
  ValidationError,
  GoogleDriveError,
  validateUploadRequest,
  createGoogleDriveSession,
  createUploadResponse,
  createErrorResponse,
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

  console.log("[Auth] Expected SHARED_KEY:", AUTH_SECRET);
  console.log("[Auth] Received header:", authHeader);

  return authHeader === `Bearer ${AUTH_SECRET}`;
}

/**
 * Get a direct Google Drive resumable upload URL
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

  try {
    let body;
    try {
      body = JSON.parse(event.body);
    } catch (e) {
      return createErrorResponse(400, "Invalid JSON", corsHeaders);
    }

    const { fileName, fileSize, mimeType } = validateUploadRequest(body);

    const accessToken = await tokenManager.getAccessToken();

    const resumableUrl = await createGoogleDriveSession({
      fileName,
      fileSize,
      mimeType,
      uploadFolderId,
      accessToken,
    });

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uploadUrl: resumableUrl,
        fileName,
        fileSize,
        mimeType,
        message: "Google resumable upload URL created",
      }),
    };
  } catch (error) {
    const status =
      error instanceof ValidationError
        ? 400
        : error instanceof GoogleDriveError
        ? error.statusCode || 502
        : error.message?.includes("token")
        ? 401
        : 500;

    return createErrorResponse(status, error.message, corsHeaders);
  }
};
