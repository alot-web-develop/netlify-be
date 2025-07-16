const { google } = require("googleapis");
require("dotenv").config();

//----DECLARATION ALLOWED ORIGINS

const allowedOrigins = [
  "http://localhost:3000",
  "https://olamide.alotwebstudio.com",
  "https://olamidedentaltechnology.co.uk",
];

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
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ],
});

const drive = google.drive({ version: "v3", auth });

//////////////////////////////////
/////----HANDLER
//////////////////////////////////

exports.handler = async (event) => {
  ///// ---- DECLARATION CORS ----
  const origin = event.headers.origin;

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin)
      ? origin
      : "",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  ///// ---- CONTROLLO METODO HTTP ----

  if (event.httpMethod === "OPTIONS") {
    console.log("Handling OPTIONS preflight request");
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: "OK (CORS preflight)",
    };
  }

  try {
    const response = await drive.files.list({
      q: `'${process.env.DRIVE_CASEFOLDER_ID}' in parents and trashed = false`,
      fields: "files(id, name, mimeType)",
    });

    const validExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".webp",
      ".gif",
      ".bmp",
      ".tiff",
      ".heic",
    ];

    const imageFiles = response.data.files.filter((file) => {
      const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
      return ext && validExtensions.includes(ext);
    });

    const imageList = await Promise.all(
      imageFiles.map(async (file) => {
        try {
          const permissions = await drive.permissions.list({
            fileId: file.id,
            fields: "permissions(type, role)",
          });

          const isPublic = permissions.data.permissions.some(
            (p) => p.type === "anyone" && p.role === "reader"
          );

          if (!isPublic) {
            await drive.permissions.create({
              fileId: file.id,
              requestBody: { role: "reader", type: "anyone" },
            });
          }

          return {
            imgSrc: `https://drive.google.com/thumbnail?id=${file.id}&sz=w1000`,
            alt: file.name.replace(/\.\w+$/, "").replace(/[-_]/g, " "),
          };
        } catch (err) {
          throw new Error(err);
        }
      })
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(imageList.filter(Boolean)),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
