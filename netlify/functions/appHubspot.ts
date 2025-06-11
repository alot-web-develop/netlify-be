import { Handler, HandlerEvent, HandlerResponse } from "@netlify/functions";
import fetch from "node-fetch";
import Busboy from "busboy";
import FormData from "form-data";

const HUBSPOT_API_BASE = "https://api.hubapi.com";
const HUBSPOT_TOKEN = process.env.HUBSPOT_APP_KEY!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Credentials": "true",
};

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
      body: "Method not allowed",
    };
  }

  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: event.headers });
    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;
    let fileName = "";
    let mimeType = "";

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (_fieldname, file, filename, _encoding, mimetype) => {
      const chunks: Buffer[] = [];
      fileName = filename;
      mimeType = mimetype;

      file.on("data", (data) => chunks.push(data));
      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    busboy.on("finish", async () => {
      try {
        // 1. Crea il contatto
        const contactPayload = {
          properties: {
            email: fields.email,
            subject: fields.name,
            phone: fields.phone || "",
            company: fields.practice || "",
          },
        };

        const contactRes = await fetch(
          `${HUBSPOT_API_BASE}/crm/v3/objects/contacts`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${HUBSPOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(contactPayload),
          }
        );

        if (!contactRes.ok) {
          const error = await contactRes.text();
          throw new Error(`Errore creazione contatto: ${error}`);
        }

        const contact = await contactRes.json();

        // 2. Se c'è un file, caricalo su HubSpot
        let fileInfo;

        if (fileBuffer) {
          const form = new FormData();
          form.append("file", fileBuffer, {
            filename: fileName,
            contentType: mimeType,
          });
          form.append(
            "options",
            JSON.stringify({
              access: "PUBLIC_NOT_INDEXABLE",
              ttl: "P3M",
            })
          );

          const fileRes = await fetch(`${HUBSPOT_API_BASE}/files/v3/files`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${HUBSPOT_TOKEN}`,
              ...form.getHeaders(),
            },
            body: form,
          });

          if (!fileRes.ok) {
            const fileErr = await fileRes.text();
            throw new Error(`Errore upload file: ${fileErr}`);
          }

          const fileData = await fileRes.json();
          fileInfo = {
            fileId: fileData.id,
            fileUrl: fileData.url,
            fileName: fileData.name,
          };
        }

        resolve({
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            message: "Contatto creato con successo",
            contactId: contact.id,
            file: fileInfo,
          }),
        });
      } catch (err: any) {
        resolve({
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: err.message }),
        });
      }
    });

    // `body` is base64-encoded in Netlify functions when using multipart/form-data
    busboy.end(Buffer.from(event.body || "", "base64"));
  });
};
