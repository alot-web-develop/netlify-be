const { google } = require("googleapis");
const nodemailer = require("nodemailer");
const multiparty = require("multiparty");
const { Readable } = require("stream");
const fs = require("fs");

require("dotenv").config();

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.SECURITY_JSON || "{}"),
  scopes: [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
  ],
});

const drive = google.drive({ version: "v3", auth });
const sheets = google.sheets({ version: "v4", auth });

function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

async function uploadFileToDrive(fileBuffer, filename, mimeType, folderId) {
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

  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });

  const result = await drive.files.get({
    fileId,
    fields: "webViewLink, webContentLink",
  });

  return result.data.webViewLink;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: "Method Not Allowed",
    };
  }

  try {
    const form = new multiparty.Form();
    const data = await new Promise((resolve, reject) => {
      form.parse(Buffer.from(event.body, "base64"), (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const { name, email, message, phone, practice, consentText, formId } =
      Object.fromEntries(
        Object.entries(data.fields).map(([k, v]) => [k, v[0]])
      );

    const fileLinks = [];

    if (data.files && Object.keys(data.files).length > 0) {
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

    let text = `Name: ${name}\nEmail: ${email}\nMessage: ${message}`;
    text += `\nPhone: ${phone || "not provided"}`;
    text += `\nPractice name: ${practice || "not provided"}`;
    if (fileLinks.length > 0) {
      text += "\n\nFiles:\n";
      fileLinks.forEach(({ filename, link }) => {
        text += `- ${filename}: ${link}\n`;
      });
    }

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

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GDPR_CONSENTS_SHEET_ID,
      range: "A1",
      valueInputOption: "RAW",
      requestBody: {
        values: [[new Date().toISOString(), name, email, consentText, formId]],
      },
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        status: "success",
        message: "Email sent and data saved.",
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ status: "error", message: err.message }),
    };
  }
};
