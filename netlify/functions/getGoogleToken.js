const { google } = require("googleapis");

//----DECLARATION CORS

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

//----DECLARATION AUTH GOOGLE

const serviceAccount = {
  type: process.env.SAK_TYPE,
  project_id: process.env.SAK_PROJECT_ID,
  private_key_id: process.env.SAK_PRIVATE_KEY_ID,
  private_key: process.env.SAK_PRIVATE_KEY.replace(/@/g, "\n"),
  client_email: process.env.SAK_CLIENT_EMAIL,
  client_id: process.env.SAK_CLIENT_ID,
  auth_uri: process.env.SAK_AUTH_URI,
  token_uri: process.env.SAK_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.SAK_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.SAK_CLIENT_X509_CERT_URL,
  universe_domain: process.env.SAK_UNIVERSE_DOMAIN,
};

const auth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
  ],
});

//////////////////////////////////
/////----HANDLER
//////////////////////////////////

exports.handler = async (event) => {
  // GESTIONE PRE-FLIGHT CORS

  if (event.httpMethod === "OPTIONS") {
    console.log("Handling OPTIONS preflight request");
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: "OK (CORS preflight)",
    };
  }

  const AUTH_SECRET = process.env.HUBSPOT_FORM_GUID;
  const authHeader = event.headers.authorization;

  if (authHeader !== `Bearer ${AUTH_SECRET}`) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  try {
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse.token;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        accessToken,
        expiresIn: 3600,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
