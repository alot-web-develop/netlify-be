const { google } = require("googleapis");

class OAuth2TokenManager {
  constructor() {
    // Define required scopes for Google Drive API operations
    this.scopes = [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
    ];

    this.oauth2Client = new google.auth.OAuth2(
      process.env.OAUTH_CLIENT_ID,
      process.env.OAUTH_CLIENT_SECRET,
      process.env.OAUTH_REDIRECT_URI
    );

    this.oauth2Client.setCredentials({
      refresh_token: process.env.OAUTH_REFRESH_TOKEN,
    });
  }

  async getAccessToken() {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      this.oauth2Client.setCredentials(credentials);
      return credentials.access_token;
    } catch (error) {
      throw new Error("Failed to refresh OAuth2 access token");
    }
  }

  getClient() {
    return this.oauth2Client;
  }

  /**
   * Generate authorization URL for OAuth2 flow
   * @returns {string} Authorization URL
   */
  generateAuthUrl() {
    return this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: this.scopes,
      prompt: "consent", // Force consent screen to get refresh token
    });
  }

  /**
   * Exchange authorization code for tokens
   * @param {string} code - Authorization code from OAuth callback
   * @returns {Promise<Object>} Token credentials
   */
  async getTokenFromCode(code) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  /**
   * Get current scopes
   * @returns {Array<string>} Array of OAuth scopes
   */
  getScopes() {
    return this.scopes;
  }
}

module.exports = OAuth2TokenManager;
