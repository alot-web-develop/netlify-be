const { google } = require("googleapis");
const nodemailer = require("nodemailer");
const multiparty = require("multiparty");
const { Readable } = require("stream");
const fs = require("fs");

require("dotenv").config();

//----DECLARATION CORS

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

//----DECLARATION AUTH GOOGLE

//
const serviceAccount = {
  type: process.env.SAK_TYPE,
  project_id: process.env.SAK_PROJECT_ID,
  private_key_id: process.env.SAK_PRIVATE_KEY_ID,
  private_key: process.env.SAK_PRIVATE_KEY.replace(/\\n/g, "\n"),
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

const drive = google.drive({ version: "v3", auth });
const sheets = google.sheets({ version: "v4", auth });

//----FUNCTION: BUFFER TO STREAM

function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

//----FUNCTION: CARICA SU DRIVE

async function uploadFileToDrive(fileBuffer, filename, mimeType, folderId) {
  ///// ---- UPLOAD FILE SU GOOGLE DRIVE: carica e rende pubblico il file ----
  console.log(`Uploading file to Drive: ${filename}, type: ${mimeType}`);

  const stream = bufferToStream(fileBuffer);

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      mimeType,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: "id",
  });

  const fileId = res.data.id;
  console.log(`File uploaded, ID: ${fileId}`);

  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });

  const result = await drive.files.get({
    fileId,
    fields: "webViewLink, webContentLink",
  });

  console.log(`File permission set. Link: ${result.data.webViewLink}`);
  return result.data.webViewLink;
}

//////////////////////////////////
/////----HANDLER
//////////////////////////////////

exports.handler = async (event) => {
  ///// ---- AVVIO HANDLER ----

  console.log("Chiave processata:", serviceAccount.private_key);

  console.log("Lambda triggered");

  ///// ---- CONTROLLO METODO HTTP ----

  if (event.httpMethod !== "POST") {
    console.log("Invalid method:", event.httpMethod);
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: "Method Not Allowed",
    };
  }

  try {
    ///// ---- PARSING MULTIPART FORM ----

    console.log("Parsing multipart form");

    const data = await new Promise((resolve, reject) => {
      const form = new multiparty.Form();
      const buffer = Buffer.from(event.body, "base64");

      const req = require("stream").Readable.from(buffer);
      req.headers = {
        "content-type": event.headers["content-type"],
        "content-length": event.headers["content-length"] || buffer.length,
      };

      form.parse(req, (err, fields, files) => {
        if (err) {
          ///// ---- ERRORE PARSING FORM ----

          console.error("Form parse error:", err);
          reject(err);
        } else {
          console.log("Form parsed successfully");
          resolve({ fields, files });
        }
      });
    });

    ///// ---- ESTRAZIONE CAMPI DAL FORM ----

    const { name, email, message, phone, practice, consentText, formId } =
      Object.fromEntries(
        Object.entries(data.fields).map(([k, v]) => [k, v[0]])
      );

    console.log("Parsed fields:", { name, email, phone, practice, formId });

    ///// ---- UPLOAD FILE (SE PRESENTI) ----

    const fileLinks = [];

    if (data.files && Object.keys(data.files).length > 0) {
      console.log("Processing uploaded files");

      for (const key in data.files) {
        for (const file of data.files[key]) {
          const buffer = fs.readFileSync(file.path);
          const link = await uploadFileToDrive(
            buffer,
            file.originalFilename,
            file.headers["content-type"],
            process.env.DRIVE_FOLDER_ID
          );
          fileLinks.push({ filename: file.originalFilename, link });
        }
      }
    }

    ///// ---- COSTRUZIONE TESTO EMAIL ----

    let text = `Name: ${name}\nEmail: ${email}\nMessage: ${message}`;
    text += `\nPhone: ${phone || "not provided"}`;
    text += `\nPractice name: ${practice || "not provided"}`;
    if (fileLinks.length > 0) {
      text += "\n\nFiles:\n";
      fileLinks.forEach(({ filename, link }) => {
        text += `- ${filename}: ${link}\n`;
      });
    }

    ///// ---- CONFIGURAZIONE E INVIO EMAIL ----

    console.log("Sending email to:", process.env.GMAIL_USER);

    const transporter = nodemailer.createTransport({
      host: process.env.GMAIL_HOST,
      port: 587,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: "alot.webstudio@gmail.com",
      subject: `New message from ${name}`,
      text,
    });

    console.log("Email sent successfully");

    ///// ---- SALVATAGGIO CONSENSO SU GOOGLE SHEETS ----

    console.log("Saving consent to Google Sheets");

    const sheetResponse = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GDPR_CONSENTS_SHEET_ID,
      range: "A1",
      valueInputOption: "RAW",
      requestBody: {
        values: [[new Date().toISOString(), name, email, consentText, formId]],
      },
    });

    console.log("Sheet response:", sheetResponse.data);

    ///// ---- RISPOSTA SUCCESSO ----

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        status: "success",
        message: "Email sent and data saved.",
      }),
    };
  } catch (err) {
    ///// ---- GESTIONE ERRORE ----

    console.error("Error in handler:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ status: "error", message: err.message }),
    };
  }
};
