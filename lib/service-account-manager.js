const { google } = require('googleapis');

class ServiceAccountManager {
  constructor() {
    this.scopes = [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets'
    ];
    
    this.authClient = null;
    this._driveClient = null;
    this._sheetsClient = null;
    
    this._initializeAuth();
  }

  _initializeAuth() {
    try {
      const serviceAccountKey = this._getServiceAccountCredentials();
      
      console.log('Service account credentials loaded:', {
        client_email: serviceAccountKey.client_email,
        project_id: serviceAccountKey.project_id,
        has_private_key: !!serviceAccountKey.private_key,
        private_key_length: serviceAccountKey.private_key ? serviceAccountKey.private_key.length : 0
      });
      
      // Use GoogleAuth with credentials instead of JWT directly
      this.authClient = new google.auth.GoogleAuth({
        credentials: serviceAccountKey,
        scopes: this.scopes
      });
      
      console.log('Service account authentication initialized successfully');
    } catch (error) {
      console.error('Service account initialization error:', error.message);
      throw new Error(`Failed to initialize service account: ${error.message}`);
    }
  }

  _getServiceAccountCredentials() {
    const {
      SERVICE_ACCOUNT_EMAIL,
      SERVICE_ACCOUNT_PRIVATE_KEY,
      SERVICE_ACCOUNT_PROJECT_ID
    } = process.env;

    if (!SERVICE_ACCOUNT_EMAIL || !SERVICE_ACCOUNT_PRIVATE_KEY || !SERVICE_ACCOUNT_PROJECT_ID) {
      const missing = [];
      if (!SERVICE_ACCOUNT_EMAIL) missing.push('SERVICE_ACCOUNT_EMAIL');
      if (!SERVICE_ACCOUNT_PRIVATE_KEY) missing.push('SERVICE_ACCOUNT_PRIVATE_KEY');
      if (!SERVICE_ACCOUNT_PROJECT_ID) missing.push('SERVICE_ACCOUNT_PROJECT_ID');
      
      throw new Error(`Missing required service account environment variables: ${missing.join(', ')}`);
    }

    // Handle private key with escaped newlines and ensure proper formatting
    let privateKey = SERVICE_ACCOUNT_PRIVATE_KEY;
    
    // Remove quotes if they exist
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.slice(1, -1);
    }
    
    // If the key has literal \n characters, replace them with actual newlines
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }
    
    // If the key has @ symbols instead of newlines (common in some env files), replace them
    if (privateKey.includes('@')) {
      privateKey = privateKey.replace(/@/g, '\n');
    }
    
    // Clean up any extra whitespace
    privateKey = privateKey.trim();
    
    // Ensure proper formatting - the key should start and end with the markers
    if (!privateKey.startsWith('-----BEGIN')) {
      // If it's just the key content without headers, add them
      if (privateKey.length > 0) {
        privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
      }
    }
    
    // Validate the key format
    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
      throw new Error('Invalid private key format. Make sure it includes BEGIN and END markers.');
    }
    
    console.log('Private key format check:', {
      starts_correctly: privateKey.startsWith('-----BEGIN PRIVATE KEY-----'),
      ends_correctly: privateKey.endsWith('-----END PRIVATE KEY-----'),
      total_length: privateKey.length,
      has_newlines: privateKey.includes('\n')
    });

    return {
      type: 'service_account',
      project_id: SERVICE_ACCOUNT_PROJECT_ID,
      client_email: SERVICE_ACCOUNT_EMAIL,
      private_key: privateKey,
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token'
    };
  }

  async authenticate() {
    try {
      const client = await this.authClient.getClient();
      const accessToken = await client.getAccessToken();
      return accessToken.token;
    } catch (error) {
      throw new Error(`Service account authentication failed: ${error.message}`);
    }
  }

  getClient() {
    return this.authClient;
  }

  async getDriveClient() {
    if (!this._driveClient) {
      this._driveClient = google.drive({ version: 'v3', auth: this.authClient });
    }
    return this._driveClient;
  }

  async getSheetsClient() {
    if (!this._sheetsClient) {
      this._sheetsClient = google.sheets({ version: 'v4', auth: this.authClient });
    }
    return this._sheetsClient;
  }

  getScopes() {
    return this.scopes;
  }
}

module.exports = ServiceAccountManager;