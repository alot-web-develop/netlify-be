#!/usr/bin/env node

/**
 * Exchange OAuth2 authorization code for tokens
 * Run this after getting the authorization code from the OAuth flow
 */

require('dotenv').config();
const OAuth2TokenManager = require('../lib/oauth2-manager');

async function exchangeCodeForTokens() {
  // Get authorization code from command line argument
  const authCode = process.argv[2];
  
  if (!authCode) {
    console.error('\n❌ Error: Authorization code is required');
    console.log('\nUsage: node scripts/exchange-oauth-code.js <authorization_code>');
    console.log('\nExample: node scripts/exchange-oauth-code.js 4/0AdLIrYe...');
    console.log('\nTo get an authorization code:');
    console.log('1. Run: node scripts/generate-oauth-url.js');
    console.log('2. Visit the generated URL and authorize the app');
    console.log('3. Copy the "code" parameter from the callback URL');
    process.exit(1);
  }

  try {
    console.log('🔄 Exchanging authorization code for tokens...\n');
    
    const tokenManager = new OAuth2TokenManager();
    const tokens = await tokenManager.getTokenFromCode(authCode);
    
    console.log('✅ Successfully obtained tokens!\n');
    
    console.log('📋 Token Information:');
    console.log(`Access Token: ${tokens.access_token?.substring(0, 20)}...`);
    console.log(`Token Type: ${tokens.token_type}`);
    console.log(`Expires In: ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'N/A'}`);
    
    if (tokens.refresh_token) {
      console.log(`\n🔑 New Refresh Token: ${tokens.refresh_token}`);
      console.log('\n📝 Update your .env file:');
      console.log(`OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    } else {
      console.log('\n⚠️  No refresh token received (using existing one)');
      console.log('This is normal if you\'re refreshing an existing authorization.');
    }
    
    console.log('\n🎉 Your OAuth2 setup is now ready!');
    console.log('The casesImages function should now work with proper Drive permissions.');
    
  } catch (error) {
    console.error('\n❌ Error exchanging authorization code:', error.message);
    
    if (error.message.includes('invalid_grant') || error.message.includes('expired')) {
      console.log('\n💡 Possible solutions:');
      console.log('1. The authorization code may have expired (they expire quickly)');
      console.log('2. Generate a new authorization URL: node scripts/generate-oauth-url.js');
      console.log('3. Make sure you copied the complete authorization code');
    }
    
    process.exit(1);
  }
}

if (require.main === module) {
  exchangeCodeForTokens();
}

module.exports = exchangeCodeForTokens;