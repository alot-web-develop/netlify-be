const HttpClient = require("./http-client");

/**
 * Upload session storage (in-memory for now)
 * In production, consider using Redis or database
 */
const uploadSessions = global.uploadSessions || new Map();
global.uploadSessions = uploadSessions;

/**
 * Session ID to Google upload URL mapping
 */
const sessionMapping = global.sessionMapping || new Map();
global.sessionMapping = sessionMapping;

/**
 * Validation errors
 */
class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

/**
 * Google Drive API errors
 */
class GoogleDriveError extends Error {
  constructor(message, statusCode = null) {
    super(message);
    this.name = "GoogleDriveError";
    this.statusCode = statusCode;
  }
}

/**
 * Validate upload request data
 * @param {Object} requestBody - The request body to validate
 * @returns {Object} Validated data
 * @throws {ValidationError} If validation fails
 */
function validateUploadRequest(requestBody) {
  const { fileName, fileSize, mimeType } = requestBody;

  if (!fileName || typeof fileName !== "string") {
    throw new ValidationError(
      "fileName is required and must be a string",
      "fileName"
    );
  }

  if (!fileSize || typeof fileSize !== "number" || fileSize <= 0) {
    throw new ValidationError(
      "fileSize is required and must be a positive number",
      "fileSize"
    );
  }

  // No file size limit since we're uploading directly to Google Drive

  if (!mimeType || typeof mimeType !== "string") {
    throw new ValidationError(
      "mimeType is required and must be a string",
      "mimeType"
    );
  }

  return { fileName, fileSize, mimeType };
}

/**
 * Create a resumable upload session with Google Drive
 * @param {Object} params - Upload parameters
 * @param {string} params.fileName - Name of the file
 * @param {number} params.fileSize - Size of the file in bytes
 * @param {string} params.mimeType - MIME type of the file
 * @param {string} params.uploadFolderId - Google Drive folder ID
 * @param {string} params.accessToken - Google Drive access token
 * @returns {Promise<string>} Upload URL for the resumable session
 * @throws {GoogleDriveError} If session creation fails
 */
async function createGoogleDriveSession({
  fileName,
  fileSize,
  mimeType,
  uploadFolderId,
  accessToken,
}) {
  const fileMetadata = {
    name: fileName,
    parents: [uploadFolderId],
  };

  const url =
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true";
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "X-Upload-Content-Type": mimeType,
    "X-Upload-Content-Length": fileSize.toString(),
  };

  try {
    const response = await HttpClient.postJson(url, fileMetadata, headers);

    if (response.statusCode !== 200) {
      let errorMessage = "Failed to initialize upload";
      try {
        const errorData = JSON.parse(response.data);
        errorMessage = errorData.error?.message || errorMessage;
      } catch {
        // Ignore JSON parse errors, use default message
      }
      throw new GoogleDriveError(
        `${errorMessage} (${response.statusCode})`,
        response.statusCode
      );
    }

    const uploadUrl = response.headers.location;
    if (!uploadUrl) {
      throw new GoogleDriveError("No upload URL received from Google Drive");
    }

    return uploadUrl;
  } catch (error) {
    if (error instanceof GoogleDriveError) {
      throw error;
    }
    throw new GoogleDriveError(
      `Failed to create Google Drive session: ${error.message}`
    );
  }
}

/**
 * Generate Netlify proxy upload URL
 * @param {string} sessionId - Upload session ID
 * @param {string} origin - Request origin header
 * @returns {string} Netlify upload proxy URL
 */
function generateNetlifyUploadUrl(sessionId, origin) {
  const baseUrl = origin?.replace("3000", "8888") || "http://localhost:8888";
  return `${baseUrl}/.netlify/functions/upload-proxy?session=${sessionId}`;
}

/**
 * Store upload session data
 * @param {string} sessionId - Unique session ID
 * @param {Object} sessionData - Session data to store
 * @param {string} sessionData.uploadUrl - Google Drive upload URL
 * @param {string} sessionData.fileName - File name
 * @param {number} sessionData.fileSize - File size
 * @param {string} sessionData.mimeType - MIME type
 */
function storeUploadSession(sessionId, sessionData) {
  // Get the actual Google upload URL from mapping
  const googleUploadUrl = sessionMapping.get(sessionId);
  
  uploadSessions.set(sessionId, {
    ...sessionData,
    uploadUrl: googleUploadUrl, // Use the actual Google URL
    createdAt: Date.now(),
  });
}

/**
 * Generate short session ID and map it to Google Drive upload URL
 * @param {string} uploadUrl - Google Drive upload URL
 * @returns {string} Short session ID
 */
function extractSessionId(uploadUrl) {
  // Generate short UUID-like session ID
  const sessionId = generateShortId();
  
  // Store mapping from short ID to Google upload URL
  sessionMapping.set(sessionId, uploadUrl);
  
  return sessionId;
}

/**
 * Generate short session ID
 * @returns {string} Short session ID
 */
function generateShortId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Create successful upload response
 * @param {Object} params - Response parameters
 * @param {string} params.uploadUrl - Netlify upload URL
 * @param {string} params.sessionId - Session ID
 * @param {string} params.fileName - File name
 * @param {number} params.fileSize - File size
 * @param {string} params.mimeType - MIME type
 * @param {Object} params.corsHeaders - CORS headers
 * @returns {Object} Formatted response
 */
function createUploadResponse({
  uploadUrl,
  fileName,
  fileSize,
  mimeType,
  corsHeaders,
}) {
  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      uploadUrl, // Direct Google Drive upload URL
      fileName,
      fileSize,
      mimeType,
      expiresIn: 3600,
      instructions: {
        method: "PUT",
        headers: {
          "Content-Type": mimeType,
          "Content-Length": fileSize.toString(),
        },
        note: "Upload directly to Google Drive - no size limits",
      },
    }),
  };
}

/**
 * Create error response
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Object} corsHeaders - CORS headers
 * @param {string} [details] - Additional error details
 * @returns {Object} Formatted error response
 */
function createErrorResponse(statusCode, message, corsHeaders, details = null) {
  const body = { error: message };
  if (details) {
    body.details = details;
  }

  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
  };
}

/**
 * Clean up expired upload sessions
 * @param {number} maxAge - Maximum age in milliseconds (default: 1 hour)
 */
function cleanupExpiredSessions(maxAge = 3600000) {
  const now = Date.now();
  for (const [sessionId, session] of uploadSessions.entries()) {
    if (now - session.createdAt > maxAge) {
      uploadSessions.delete(sessionId);
    }
  }
}

module.exports = {
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
  uploadSessions,
};
