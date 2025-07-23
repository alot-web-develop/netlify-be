const { google } = require("googleapis");

class OAuth2TokenManager {
  constructor() {
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
}

module.exports = OAuth2TokenManager;