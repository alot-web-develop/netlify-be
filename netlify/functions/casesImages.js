const { handleCorsAndMethod } = require("../../lib/cors-handler");
const { casesFolderId } = require("../../lib/config");
const {
  DriveValidationError,
  validateDriveRequest,
  fetchImageFiles,
  createSimpleDriveResponse,
  createDriveErrorResponse,
} = require("../../lib/utils/drive-utils");
const { GoogleAPIError } = require("../../lib/utils/google-api-client");

/**
 * Main cases images handler - fetches and returns image list from Google Drive
 * @param {Object} event - Lambda event object
 * @returns {Promise<Object>} HTTP response with image list
 */
exports.handler = async (event) => {
  // Handle CORS and validate HTTP method
  const corsCheck = handleCorsAndMethod(
    event,
    "GET",
    "Content-Type, Authorization"
  );
  if (corsCheck.statusCode) {
    return corsCheck;
  }
  const { corsHeaders } = corsCheck;

  try {
    // Validate request (minimal for GET request)
    const queryParams = event.queryStringParameters || {};
    validateDriveRequest(queryParams);

    // Check if folder ID is configured
    if (!casesFolderId) {
      return createDriveErrorResponse(
        500,
        "Google Drive folder not configured",
        corsHeaders,
        "DRIVE_CASEFOLDER_ID environment variable is missing"
      );
    }

    console.log(`Fetching images from Google Drive folder: ${casesFolderId}`);

    // Fetch and process image files
    const imageList = await fetchImageFiles(casesFolderId, {
      ensurePublic: false,
      includeMetadata: false,
    });

    console.log(`Successfully retrieved ${imageList.length} images`);
    return createSimpleDriveResponse(imageList, corsHeaders);
  } catch (error) {
    // Handle specific error types
    if (error instanceof DriveValidationError) {
      console.warn("Drive request validation failed:", error.message);
      return createDriveErrorResponse(400, error.message, corsHeaders);
    }

    if (error instanceof GoogleAPIError) {
      console.error("Google Drive API error:", error.message);

      // Determine appropriate status code
      let statusCode = 502; // Bad Gateway default
      if (error.statusCode >= 400 && error.statusCode < 600) {
        statusCode = error.statusCode;
      }

      // Handle specific Google Drive errors
      if (
        error.message.includes("not found") ||
        error.message.includes("404")
      ) {
        return createDriveErrorResponse(
          404,
          "Drive folder not found",
          corsHeaders,
          `Folder ${casesFolderId} does not exist or is not accessible`
        );
      }

      if (
        error.message.includes("permission") ||
        error.message.includes("403")
      ) {
        return createDriveErrorResponse(
          403,
          "Insufficient permissions to access Drive folder",
          corsHeaders,
          error.message
        );
      }

      if (error.message.includes("quota") || error.message.includes("rate")) {
        return createDriveErrorResponse(
          429,
          "Google Drive API quota exceeded",
          corsHeaders,
          "Please try again later"
        );
      }

      return createDriveErrorResponse(
        statusCode,
        "Google Drive API error",
        corsHeaders,
        error.message
      );
    }

    // Handle OAuth/authentication errors
    if (error.message?.includes("token") || error.message?.includes("auth")) {
      console.error("Authentication error:", error.message);
      return createDriveErrorResponse(
        401,
        "Authentication failed",
        corsHeaders,
        "Unable to authenticate with Google Drive"
      );
    }

    // Generic error fallback
    console.error("Unexpected error in cases images handler:", error);
    return createDriveErrorResponse(
      500,
      "Failed to retrieve images",
      corsHeaders,
      error.message
    );
  }
};
