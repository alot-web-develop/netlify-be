const { handleCorsAndMethod } = require("../../lib/cors-handler");
const { casesFolderId } = require("../../lib/config");
const {
  DriveValidationError,
  validateDriveRequest,
  fetchImageFiles,
  createSimpleDriveResponse,
  createDriveErrorResponse,
} = require("../../lib/utils/drive-utils");
const { GoogleAPIError, createServiceAccountClient } = require("../../lib/utils/google-api-client");

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
    const queryParams = event.queryStringParameters || {};
    validateDriveRequest(queryParams);

    if (!casesFolderId) {
      return createDriveErrorResponse(
        400,
        "Google Drive folder not configured",
        corsHeaders,
        "DRIVE_CASEFOLDER_ID environment variable is missing"
      );
    }

    // Create service account client for reliable authentication
    const serviceAccountClient = createServiceAccountClient();
    
    const imageList = await fetchImageFiles(casesFolderId, {
      ensurePublic: false,
      includeMetadata: false,
      apiClient: serviceAccountClient,
    });

    console.log(`Successfully retrieved ${imageList.length} images`);
    return createSimpleDriveResponse(imageList, corsHeaders);
  } catch (error) {
    return errorsHandler(error, corsHeaders);
  }
};

function errorsHandler(error, corsHeaders) {
  if (error instanceof DriveValidationError) {
    console.warn("Drive request validation failed:", error.message);
    return createDriveErrorResponse(400, error.message, corsHeaders);
  }

  if (error instanceof GoogleAPIError) {
    console.error("Google Drive API error:", error.message);

    // ERRORS - Use 4xx codes to avoid Netlify HTML error pages
    let statusCode = 400; // Bad Request default
    if (error.statusCode >= 400 && error.statusCode < 500) {
      statusCode = error.statusCode;
    }

    if (error.message.includes("not found") || error.message.includes("404")) {
      return createDriveErrorResponse(
        404,
        "Drive folder not found",
        corsHeaders,
        `Folder ${casesFolderId} does not exist or is not accessible`
      );
    }

    if (error.message.includes("permission") || error.message.includes("403")) {
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
      400,
      "Google Drive API error",
      corsHeaders,
      error.message
    );
  }

  // Handle service account authentication errors
  if (error.message?.includes("service account") || error.message?.includes("JWT") || error.message?.includes("credentials")) {
    console.error("Service account authentication error:", error.message);
    return createDriveErrorResponse(
      401,
      "Service account authentication failed",
      corsHeaders,
      "Unable to authenticate with Google Drive using service account"
    );
  }
}
