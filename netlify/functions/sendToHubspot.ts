import { Handler, HandlerEvent, HandlerResponse } from "@netlify/functions";
import { google } from "googleapis";
import nodemailer from "nodemailer";
const Busboy = require("busboy");
import { Readable } from "stream";

function bufferToStream(buffer: Buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.SECURITY_JSON || "{}"),
  scopes: ["https://www.googleapis.com/auth/drive.file"],
});

const drive = google.drive({ version: "v3", auth });

const FOLDER_ID = process.env.DRIVE_FOLDER_ID ?? "";

async function uploadFileToDrive(
  buffer: Buffer,
  filename: string,
  mimeType: string
) {
  const stream = bufferToStream(buffer);

  const res = await drive.files.create({
    requestBody: { name: filename, mimeType, parents: [FOLDER_ID] },
    media: { mimeType, body: stream },
    fields: "id",
  });

  const fileId = res.data.id;
  if (!fileId) throw new Error("File ID is missing after upload");
  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });

  const meta = await drive.files.get({
    fileId,
    fields: "webViewLink",
  });

  return { link: meta.data.webViewLink, fileId };
}

const transporter = nodemailer.createTransport({
  host: process.env.GMAIL_HOST,
  port: 587,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

// ✅ Funzione per inviare dati a HubSpot
async function sendToHubspot(fields: Record<string, string>) {
  const portalId = process.env.HUBSPOT_PORTAL_ID;
  const formGuid = process.env.HUBSPOT_FORM_GUID;

  const url = `https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formGuid}`;

  const payload = {
    fields: [
      { name: "name", value: fields.name },
      { name: "email", value: fields.email },
      { name: "phone", value: fields.phone },
      { name: "practice", value: fields.practice },
      { name: "message", value: fields.message },
    ],
    context: {
      pageUri: fields.pageUri || "",
      pageName: fields.pageName || "",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Errore HubSpot: ${res.status} ${err}`);
  }

  return await res.json();
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Credentials": "true", // Aggiungi questo
};

// ✅ HANDLER AGGIORNATO CON HEADER CORS SU TUTTE LE RISPOSTE
export const handler: Handler = async (
  event: HandlerEvent
): Promise<HandlerResponse> => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: "Method Not Allowed",
    };
  }

  if (!event.body) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: "Missing body",
    };
  }

  return new Promise((resolve) => {
    const busboy = new Busboy({ headers: event.headers });
    const fields: Record<string, string> = {};
    const attachments: any[] = [];
    const driveLinks: string[] = [];

    busboy.on("field", (fieldname, val) => {
      fields[fieldname] = val;
    });

    busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
      const buffers: Buffer[] = [];
      file.on("data", (data) => buffers.push(data));
      file.on("end", async () => {
        try {
          const buffer = Buffer.concat(buffers);
          const { link } = await uploadFileToDrive(buffer, filename, mimetype);
          driveLinks.push(`${filename}: ${link}`);
          attachments.push({
            filename,
            content: buffer,
            contentType: mimetype,
          });
        } catch (err) {
          console.error("Errore upload:", err);
          resolve({
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: "Errore analisi form" }),
          });
        }
      });
    });

    busboy.on("finish", async () => {
      try {
        const { name, email, message, phone, practice } = fields;

        const textBody = `
Nuovo messaggio da ${name}
Email: ${email}
Telefono: ${phone || "non fornito"}
Studio: ${practice || "non fornito"}

Messaggio:
${message}

File caricati su Google Drive:
${driveLinks.join("\n")}
        `;

        await transporter.sendMail({
          from: process.env.GMAIL_USER,
          to: "alot.webstudio@gmail.com",
          subject: `Nuovo contatto da ${name}`,
          text: textBody,
          attachments,
        });

        await sendToHubspot(fields);

        resolve({
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            status: "success",
            message: "Email e dati inviati con successo",
          }),
        });
      } catch (err: any) {
        console.error("Errore:", err);
        resolve({
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({
            error: "Errore invio dati o email",
            details: err.message,
          }),
        });
      }
    });

    busboy.end(Buffer.from(event.body || "", "base64"));
  });
};
