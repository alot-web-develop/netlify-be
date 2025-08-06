const { googleAPIClient, GoogleAPIError } = require('./google-api-client');

/**
 * Drive validation errors
 */
class DriveValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'DriveValidationError';
    this.field = field;
  }
}

/**
 * Valid image file extensions
 */
const VALID_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.tiff',
  '.heic'
];

/**
 * Validate drive request (minimal validation for GET request)
 * @param {Object} queryParams - Query parameters from request
 * @returns {Object} Validated parameters (currently just passes through)
 */
function validateDriveRequest(queryParams = {}) {
  // For a simple GET request, we don't need much validation
  // This is a placeholder for potential future query parameters
  return queryParams;
}

/**
 * Check if file is a valid image based on extension
 * @param {string} fileName - Name of the file
 * @returns {boolean} True if file is a valid image
 */
function isValidImageFile(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return false;
  }

  const extension = fileName.toLowerCase().match(/\.[^.]+$/)?.[0];
  return extension && VALID_IMAGE_EXTENSIONS.includes(extension);
}

/**
 * Filter files to only include valid images
 * @param {Array} files - Array of file objects from Google Drive
 * @returns {Array} Filtered array of image files
 */
function filterImageFiles(files) {
  if (!Array.isArray(files)) {
    return [];
  }

  return files.filter(file => {
    return file && file.name && isValidImageFile(file.name);
  });
}

/**
 * Check if a file is publicly accessible
 * @param {string} fileId - Google Drive file ID
 * @param {Object} apiClient - Google API client to use (defaults to singleton)
 * @returns {Promise<boolean>} True if file is public
 */
async function isFilePublic(fileId, apiClient = googleAPIClient) {
  try {
    const permissionsData = await apiClient.getDriveFilePermissions(fileId);
    const permissions = permissionsData.permissions || [];
    
    return permissions.some(permission => 
      permission.type === 'anyone' && permission.role === 'reader'
    );
  } catch (error) {
    // If we can't check permissions, assume it's not public
    console.warn(`Could not check permissions for file ${fileId}:`, error.message);
    return false;
  }
}

/**
 * Make a file publicly readable
 * @param {string} fileId - Google Drive file ID
 * @param {Object} apiClient - Google API client to use (defaults to singleton)
 * @returns {Promise<Object>} Permission creation result
 */
async function makeFilePublic(fileId, apiClient = googleAPIClient) {
  const permission = {
    role: 'reader',
    type: 'anyone'
  };

  return apiClient.createDriveFilePermission(fileId, permission);
}

/**
 * Ensure file has public read permissions
 * @param {string} fileId - Google Drive file ID
 * @param {Object} apiClient - Google API client to use (defaults to singleton)
 * @returns {Promise<void>}
 * @throws {GoogleAPIError} If permission management fails
 */
async function ensurePublicPermissions(fileId, apiClient = googleAPIClient) {
  try {
    const isPublic = await isFilePublic(fileId, apiClient);
    
    if (!isPublic) {
      await makeFilePublic(fileId, apiClient);
    }
  } catch (error) {
    if (error instanceof GoogleAPIError) {
      throw error;
    }
    throw new GoogleAPIError(`Failed to ensure public permissions for file ${fileId}: ${error.message}`);
  }
}

/**
 * Format file name for display (remove extension, replace dashes/underscores with spaces)
 * @param {string} fileName - Original file name
 * @returns {string} Formatted display name
 */
function formatDisplayName(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return 'Untitled';
  }

  return fileName
    .replace(/\.\w+$/, '') // Remove extension
    .replace(/[-_]/g, ' ') // Replace dashes and underscores with spaces
    .trim();
}

/**
 * Create image object for client response
 * @param {Object} file - Google Drive file object
 * @returns {Object} Formatted image object
 */
function createImageObject(file) {
  const { id, name } = file;
  
  return {
    imgSrc: `https://lh3.googleusercontent.com/d/${id}`,
    alt: formatDisplayName(name),
    fileId: id,
    fileName: name
  };
}

/**
 * Fetch and process image files from Google Drive folder
 * @param {string} folderId - Google Drive folder ID
 * @param {Object} options - Processing options
 * @param {boolean} options.ensurePublic - Whether to ensure files are publicly accessible
 * @param {boolean} options.includeMetadata - Whether to include additional metadata
 * @param {Object} options.apiClient - Google API client to use (defaults to singleton)
 * @returns {Promise<Array>} Array of processed image objects
 */
async function fetchImageFiles(folderId, options = {}) {
  const { ensurePublic = true, includeMetadata = false, apiClient = googleAPIClient } = options;

  try {
    // Fetch files from the specified folder
    const response = await apiClient.listDriveFiles(folderId, {
      fields: 'files(id, name, mimeType, size, createdTime, modifiedTime)'
    });

    const files = response.files || [];
    
    // Filter to only image files
    const imageFiles = filterImageFiles(files);

    // Process each image file
    const processedImages = await Promise.all(
      imageFiles.map(async (file) => {
        try {
          // Ensure public permissions if requested
          if (ensurePublic) {
            await ensurePublicPermissions(file.id, apiClient);
          }

          // Create basic image object
          const imageObj = createImageObject(file);

          // Add metadata if requested
          if (includeMetadata) {
            imageObj.metadata = {
              mimeType: file.mimeType,
              size: file.size,
              createdTime: file.createdTime,
              modifiedTime: file.modifiedTime
            };
          }

          return imageObj;
        } catch (error) {
          // Log error but don't fail the entire operation
          console.error(`Failed to process file ${file.id} (${file.name}):`, error.message);
          return null;
        }
      })
    );

    // Filter out failed items and return successful ones
    return processedImages.filter(Boolean);
  } catch (error) {
    if (error instanceof GoogleAPIError) {
      throw error;
    }
    throw new GoogleAPIError(`Failed to fetch image files from folder ${folderId}: ${error.message}`);
  }
}

/**
 * Create successful drive response
 * @param {Array} imageList - Array of image objects
 * @param {Object} corsHeaders - CORS headers
 * @param {Object} metadata - Optional metadata to include
 * @returns {Object} Formatted success response
 */
function createDriveSuccessResponse(imageList, corsHeaders, metadata = {}) {
  const response = {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      images: imageList,
      count: imageList.length,
      ...metadata
    })
  };

  return response;
}

/**
 * Create drive error response
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Object} corsHeaders - CORS headers
 * @param {string} [details] - Additional error details
 * @returns {Object} Formatted error response
 */
function createDriveErrorResponse(statusCode, message, corsHeaders, details = null) {
  const body = { error: message };
  
  if (details) {
    body.details = details;
  }

  return {
    statusCode,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

/**
 * Simple response format for backward compatibility
 * @param {Array} imageList - Array of image objects
 * @param {Object} corsHeaders - CORS headers
 * @returns {Object} Simple response format (just the image array)
 */
function createSimpleDriveResponse(imageList, corsHeaders) {
  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(imageList)
  };
}

module.exports = {
  DriveValidationError,
  VALID_IMAGE_EXTENSIONS,
  validateDriveRequest,
  isValidImageFile,
  filterImageFiles,
  isFilePublic,
  makeFilePublic,
  ensurePublicPermissions,
  formatDisplayName,
  createImageObject,
  fetchImageFiles,
  createDriveSuccessResponse,
  createDriveErrorResponse,
  createSimpleDriveResponse
};