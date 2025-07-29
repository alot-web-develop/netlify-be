#!/usr/bin/env node

/**
 * Generate OAuth2 authorization URL for re-authorization
 * Run this script if you need to re-authorize the application with new scopes
 */

require('dotenv').config();
const OAuth2TokenManager = require('../lib/oauth2-manager');

async function generateAuthUrl() {
  try {
    const tokenManager = new OAuth2TokenManager();
    const authUrl = tokenManager.generateAuthUrl();
    
    console.log('\n=== OAuth2 Re-authorization Required ===\n');
    console.log('The application needs to be re-authorized with the following scopes:');
    tokenManager.getScopes().forEach(scope => {
      console.log(`  - ${scope}`);
    });
    
    console.log('\n1. Visit the following URL in your browser:');
    console.log(`\n${authUrl}\n`);
    
    console.log('2. Complete the authorization process');
    console.log('3. Copy the authorization code from the callback URL');
    console.log('4. Update your OAUTH_REFRESH_TOKEN environment variable with the new refresh token');
    
    console.log('\nNote: You can use the getTokenFromCode() method to exchange the authorization code for tokens.');
    
  } catch (error) {
    console.error('Error generating authorization URL:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  generateAuthUrl();
}

module.exports = generateAuthUrl;