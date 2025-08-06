const { google } = require('googleapis');
const OAuth2TokenManager = require('../oauth2-manager');
const ServiceAccountManager = require('../service-account-manager');

/**
 * Google API specific errors
 */
class GoogleAPIError extends Error {
  constructor(message, statusCode = null, apiName = null) {
    super(message);
    this.name = 'GoogleAPIError';
    this.statusCode = statusCode;
    this.apiName = apiName;
  }
}

/**
 * Unified Google API client supporting OAuth2 and Service Account authentication
 */
class GoogleAPIClient {
  constructor(useServiceAccount = false) {
    this.useServiceAccount = useServiceAccount;
    this.tokenManager = useServiceAccount ? new ServiceAccountManager() : new OAuth2TokenManager();
    this._driveClient = null;
    this._sheetsClient = null;
  }

  /**
   * Get authenticated Google Drive client
   * @returns {Promise<Object>} Google Drive API client
   */
  async getDriveClient() {
    if (!this._driveClient) {
      if (this.useServiceAccount) {
        this._driveClient = await this.tokenManager.getDriveClient();
      } else {
        const authClient = this.tokenManager.getClient();
        this._driveClient = google.drive({ version: 'v3', auth: authClient });
      }
    }
    return this._driveClient;
  }

  /**
   * Get authenticated Google Sheets client
   * @returns {Promise<Object>} Google Sheets API client
   */
  async getSheetsClient() {
    if (!this._sheetsClient) {
      if (this.useServiceAccount) {
        this._sheetsClient = await this.tokenManager.getSheetsClient();
      } else {
        const authClient = this.tokenManager.getClient();
        this._sheetsClient = google.sheets({ version: 'v4', auth: authClient });
      }
    }
    return this._sheetsClient;
  }

  /**
   * Execute Google Drive API call with error handling
   * @param {Function} apiCall - The API call function
   * @param {string} operation - Description of the operation
   * @returns {Promise<any>} API response data
   */
  async executeDriveCall(apiCall, operation = 'Drive API call') {
    try {
      const drive = await this.getDriveClient();
      const response = await apiCall(drive);
      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      const statusCode = error.response?.status || error.code;
      throw new GoogleAPIError(
        `${operation} failed: ${errorMessage}`,
        statusCode,
        'drive'
      );
    }
  }

  /**
   * Execute Google Sheets API call with error handling
   * @param {Function} apiCall - The API call function
   * @param {string} operation - Description of the operation
   * @returns {Promise<any>} API response data
   */
  async executeSheetsCall(apiCall, operation = 'Sheets API call') {
    try {
      const sheets = await this.getSheetsClient();
      const response = await apiCall(sheets);
      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      const statusCode = error.response?.status || error.code;
      throw new GoogleAPIError(
        `${operation} failed: ${errorMessage}`,
        statusCode,
        'sheets'
      );
    }
  }

  /**
   * List files in a Google Drive folder
   * @param {string} folderId - Google Drive folder ID
   * @param {Object} options - Query options
   * @param {string} options.fields - Fields to include in response
   * @param {string} options.q - Additional query parameters
   * @returns {Promise<Array>} List of files
   */
  async listDriveFiles(folderId, options = {}) {
    const { fields = 'files(id, name, mimeType)', q = '' } = options;
    const query = `'${folderId}' in parents and trashed = false${q ? ` and ${q}` : ''}`;

    return this.executeDriveCall(
      (drive) => drive.files.list({ q: query, fields }),
      'List Drive files'
    );
  }

  /**
   * Get permissions for a Google Drive file
   * @param {string} fileId - Google Drive file ID
   * @returns {Promise<Array>} List of permissions
   */
  async getDriveFilePermissions(fileId) {
    return this.executeDriveCall(
      (drive) => drive.permissions.list({
        fileId,
        fields: 'permissions(type, role)'
      }),
      'Get file permissions'
    );
  }

  /**
   * Create permission for a Google Drive file
   * @param {string} fileId - Google Drive file ID
   * @param {Object} permission - Permission object
   * @returns {Promise<Object>} Created permission
   */
  async createDriveFilePermission(fileId, permission) {
    return this.executeDriveCall(
      (drive) => drive.permissions.create({
        fileId,
        requestBody: permission
      }),
      'Create file permission'
    );
  }

  /**
   * Append data to a Google Sheet
   * @param {string} spreadsheetId - Google Sheets ID
   * @param {string} range - Range to append to (e.g., 'A1')
   * @param {Array<Array>} values - Values to append
   * @param {string} valueInputOption - How to interpret input values
   * @returns {Promise<Object>} Append response
   */
  async appendToSheet(spreadsheetId, range, values, valueInputOption = 'RAW') {
    return this.executeSheetsCall(
      (sheets) => sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption,
        requestBody: { values }
      }),
      'Append to sheet'
    );
  }

  /**
   * Refresh OAuth token (useful for ensuring fresh tokens)
   * Only applicable for OAuth2, service accounts don't need token refresh
   * @returns {Promise<string>} Access token
   */
  async refreshToken() {
    try {
      if (this.useServiceAccount) {
        return await this.tokenManager.authenticate();
      } else {
        return await this.tokenManager.getAccessToken();
      }
    } catch (error) {
      throw new GoogleAPIError(`Token refresh failed: ${error.message}`);
    }
  }
}

// Export singleton instance (OAuth2 by default)
const googleAPIClient = new GoogleAPIClient();

// Factory function to create service account client
const createServiceAccountClient = () => {
  return new GoogleAPIClient(true);
};

module.exports = {
  GoogleAPIClient,
  GoogleAPIError,
  googleAPIClient,
  createServiceAccountClient
};