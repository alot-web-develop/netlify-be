const OAuth2TokenManager = require("../../lib/oauth2-manager");
const { targetFolderId } = require("../../lib/config");
const { handleCorsAndMethod } = require("../../lib/cors-handler");

const tokenManager = new OAuth2TokenManager();

exports.handler = async (event) => {
  const corsCheck = handleCorsAndMethod(
    event,
    "POST",
    "Content-Type, Authorization"
  );

  if (corsCheck.statusCode) return corsCheck;
  const { corsHeaders } = corsCheck;

  const AUTH_SECRET = process.env.SHARED_KEY;
  const authHeader = event.headers.authorization;

  if (authHeader !== `Bearer ${AUTH_SECRET}`) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { fileName, fileSize, mimeType } = body;

    if (!fileName || !fileSize || !mimeType) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Missing required fields: fileName, fileSize, mimeType",
        }),
      };
    }

    const fileMetadata = {
      name: fileName,
      parents: [targetFolderId],
    };

    const accessToken = await tokenManager.getAccessToken();

    // Chiamata manuale per creare sessione resumable e ottenere URL specifico
    const https = require("https");

    const uploadUrl = await new Promise((resolve, reject) => {
      const postData = JSON.stringify(fileMetadata);

      const options = {
        hostname: "www.googleapis.com",
        port: 443,
        path: "/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": mimeType,
          "X-Upload-Content-Length": fileSize.toString(),
          "Content-Length": Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, (res) => {
        let responseData = "";
        res.on("data", (chunk) => (responseData += chunk));

        res.on("end", () => {
          if (res.statusCode !== 200) {
            try {
              const errorJson = JSON.parse(responseData);
              reject(
                new Error(
                  `Failed to initialize upload: ${res.statusCode} - ${
                    errorJson.error?.message || responseData
                  }`
                )
              );
            } catch {
              reject(
                new Error(
                  `Failed to initialize upload: ${res.statusCode} - ${responseData}`
                )
              );
            }
            return;
          }
        });

        const location = res.headers.location;
        if (location) {
          resolve(location);
        } else {
          reject(new Error("No upload URL in Location header"));
        }
      });

      req.on("error", reject);
      req.write(postData);
      req.end();
    });

    if (!uploadUrl) {
      throw new Error("No upload URL received from Google Drive");
    }

    const sessionId =
      uploadUrl?.split?.("upload_id=")?.[1]?.split("&")[0] ||
      `session_${Date.now()}`;

    global.uploadSessions = global.uploadSessions || new Map();
    global.uploadSessions.set(sessionId, {
      uploadUrl,
      fileName,
      fileSize,
      mimeType,
      createdAt: Date.now(),
    });

    const netlifyUploadUrl = `${
      event.headers.origin?.replace("3000", "8888") || "http://localhost:8888"
    }/.netlify/functions/upload-proxy?session=${sessionId}`;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        uploadUrl: netlifyUploadUrl, // URL "presigned" Netlify
        sessionId,
        fileName,
        fileSize,
        mimeType,
        expiresIn: 3600, // 1 ora
        instructions: {
          method: "PUT",
          headers: {
            "Content-Type": mimeType,
            "Content-Length": fileSize.toString(),
          },
          note: "Upload directly to this Netlify URL - no CORS issues",
        },
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Failed to create upload session",
        details: err.message,
      }),
    };
  }
};
