const https = require("https");
const { URL } = require("url");
const { handleCorsAndMethod } = require("../../lib/cors-handler");
const OAuth2TokenManager = require("../../lib/oauth2-manager");
const { uploadSessions } = require("../../lib/utils/upload-utils");

const tokenManager = new OAuth2TokenManager();

/**
 * /////////////////////////////////////////////////////////////////////////////
 * Handle chunked file upload
 * @param {Object} event - Lambda event object
 * @returns {Promise<Object>} HTTP response
 */
exports.handler = async (event) => {
  // Handle CORS and validate HTTP method
  const corsCheck = handleCorsAndMethod(
    event,
    "PUT",
    "Content-Type, Content-Length, Content-Range, x-upload-url, x-file-name, x-file-size, x-chunk-size, x-total-chunks, x-uploaded-chunks, x-uploaded-bytes"
  );

  if (corsCheck.statusCode) {
    return corsCheck;
  }
  const { corsHeaders } = corsCheck;

  /////////////////////////////////////////

  // console.log("**typeof event.body:", typeof event.body);
  // console.log("**event.isBase64Encoded:", event.isBase64Encoded);
  // console.log(
  //   "**event.headers['content-type']:",
  //   event.headers?.["content-type"]
  // );

  // Controlla se il body è presente
  if (!event.body) {
    console.error("Body missing from event");
    return {
      statusCode: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Request body is missing" }),
    };
  }

  // const chunkData = event.body;
  // console.log("**Chunk data size:", chunkData?.length);
  // console.log("**isBase64Encoded:", event.isBase64Encoded);

  // console.log("**Body length:", event.body?.length);
  // console.log("**isBase64Encoded:", event.isBase64Encoded);
  // console.log("**typeof body:", typeof event.body);

  // if (event.body && event.isBase64Encoded) {
  //   const buffer = Buffer.from(event.body, "base64");
  //   console.log("Decoded buffer size:", buffer.length);
  // } else {
  //   console.log("Body missing or not base64 encoded");
  // }
  /////////////////////////////////////////

  try {
    const sessionId = event.queryStringParameters?.session;
    const googleUploadUrl = decodeURIComponent(event.headers["x-upload-url"]);
    const fileName = event.headers["x-file-name"];
    const fileSize = parseInt(event.headers["x-file-size"]);
    const mimeType = event.headers["content-type"];
    const chunkSize = parseInt(event.headers["x-chunk-size"]);
    const totalChunks = parseInt(event.headers["x-total-chunks"]);
    const uploadedChunks = parseInt(event.headers["x-uploaded-chunks"]);
    const uploadedBytes = parseInt(event.headers["x-uploaded-bytes"]);
    const chunkIndex = parseInt(event.queryStringParameters?.chunk || "0");

    if (!sessionId) {
      return {
        statusCode: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Missing session parameter" }),
      };
    }

    // const sessionData = uploadSessions.get(sessionId);
    // if (!sessionData || !sessionData.chunks) {
    //   return {
    //     statusCode: 400,
    //     headers: {
    //       ...corsHeaders,
    //       "Content-Type": "application/json",
    //     },
    //     body: JSON.stringify({
    //       error: "Invalid session or not a chunked upload",
    //     }),
    //   };
    // }

    // const { uploadUrl, fileName, fileSize, mimeType, chunks } = sessionData;

    // Calculate range for this chunk
    // const chunkSize = chunks.chunkSize;
    const startByte = chunkIndex * chunkSize;
    const endByte = Math.min(startByte + chunkSize - 1, fileSize - 1);
    const contentLength = endByte - startByte + 1;

    // Get access token for Google Drive
    let accessToken;
    try {
      accessToken = await tokenManager.getAccessToken();
    } catch (tokenError) {
      return {
        statusCode: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          error: "Authentication failed - token refresh error",
        }),
      };
    }

    // Upload chunk to Google Drive
    const result = await uploadChunkToGoogleDrive({
      uploadUrl: googleUploadUrl,
      chunkData: event.body,
      isBase64Encoded: event.isBase64Encoded,
      startByte,
      endByte,
      totalSize: fileSize,
      accessToken,
      mimeType,
      contentLength,
    });

    // Update chunk progress

    const isComplete = uploadedChunks + 1 >= totalChunks;

    const responseBody = {
      success: true,
      chunkIndex,
      uploadedChunks: uploadedChunks,
      totalChunks: totalChunks,
      uploadedBytes: uploadedBytes,
      totalBytes: fileSize,
      isComplete,
      message: isComplete
        ? "File upload completed"
        : `Chunk ${chunkIndex + 1}/${totalChunks} uploaded`,
    };

    // Se è l’ultimo chunk, includi i dati del file
    if (isComplete && result?.fileId) {
      responseBody.fileId = result.fileId;
      responseBody.fileName = fileName;
      responseBody.viewUrl = result.viewUrl;
      responseBody.downloadUrl = result.downloadUrl;

      // Pulisci la sessione solo se tutto finito
      uploadSessions.delete(sessionId);
    }

    console.log("Upload response:", responseBody);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(responseBody),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: "Chunk upload failed",
        details: error.message,
      }),
    };
  }
};

/**
 * /////////////////////////////////////////////////////////////////////////////
 * Upload a single chunk to Google Drive
 * @param {Object} params - Upload parameters
 * @returns {Promise<Object>} Upload result
 */
async function uploadChunkToGoogleDrive({
  uploadUrl,
  chunkData,
  isBase64Encoded,
  startByte,
  endByte,
  totalSize,
  accessToken,
  mimeType,
  contentLength,
}) {
  return new Promise((resolve, reject) => {
    const uploadUrlParsed = new URL(uploadUrl);

    const options = {
      hostname: uploadUrlParsed.hostname,
      port: 443,
      path: uploadUrlParsed.pathname + uploadUrlParsed.search,
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": mimeType,
        "Content-Length": contentLength.toString(),
        "Content-Range": `bytes ${startByte}-${endByte}/${totalSize}`,
      },
    };

    ////////////////////////////////////////////

    // console.log("**Uploading to:", uploadUrl);
    // console.log("**Request headers:", options.headers);
    // console.log("**Chunk size (Content-Length):", contentLength);
    // console.log("**UPLOAD URL:", uploadUrl);
    // console.log("**CHUNK RANGE:", `bytes ${startByte}-${endByte}/${totalSize}`);
    // console.log("**CHUNK LENGTH:", contentLength);
    // console.log("**isBase64Encoded:", isBase64Encoded);
    // console.log("**chunkData type:", typeof chunkData);
    // console.log(
    //   "**chunkData size:",
    //   Buffer.byteLength(chunkData || "", isBase64Encoded ? "base64" : "utf8")
    // );

    ////////////////////////////////////////////

    const proxyReq = https.request(options, (proxyRes) => {
      let responseData = "";
      proxyRes.on("data", (chunk) => (responseData += chunk));

      proxyRes.on("end", () => {
        if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 400) {
          try {
            // Check if this is the final chunk (Google returns file info)
            if (proxyRes.statusCode === 200 || proxyRes.statusCode === 201) {
              const result = JSON.parse(responseData);
              resolve({
                fileId: result.id,
                viewUrl: result.id
                  ? `https://drive.google.com/file/d/${result.id}/view`
                  : null,
                downloadUrl: result.id
                  ? `https://drive.google.com/uc?id=${result.id}`
                  : null,
              });
            } else {
              // Intermediate chunk (308 Resume Incomplete)
              resolve({ success: true });
            }
          } catch (parseError) {
            // Handle non-JSON responses
            resolve({ success: true, rawResponse: responseData });
          }
        } else {
          reject(
            new Error(
              `Chunk upload failed: ${proxyRes.statusCode} - ${responseData}`
            )
          );
        }
      });
    });

    proxyReq.on("error", (error) => {
      reject(error);
    });

    // Add timeout
    // proxyReq.setTimeout(30000000, () => {
    //   proxyReq.destroy();
    //   reject(new Error("Chunk upload timeout"));
    // });

    if (chunkData) {
      const buffer = isBase64Encoded
        ? Buffer.from(chunkData, "base64")
        : Buffer.from(chunkData);

      proxyReq.write(buffer);
    }

    proxyReq.end();
  });
}
