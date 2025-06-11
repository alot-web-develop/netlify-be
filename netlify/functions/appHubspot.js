const { Handler } = require("@netlify/functions");
const fetch = require("node-fetch");
const Busboy = require("busboy");
const FormData = require("form-data");

const HUBSPOT_API_BASE = "https://api.hubapi.com";
const HUBSPOT_TOKEN = process.env.HUBSPOT_APP_KEY;

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Credentials": "true",
};

exports.handler = async (event) => {
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
    const fields = {};
    let fileBuffer = null;
    let fileName = "";
    let mimeType = "";

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (_fieldname, file, filename, _encoding, mimetype) => {
      const chunks = [];
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
            firstname: fields.name,
            phone: fields.phone || "",
            company: fields.practice || "",
            message: fields.message || "", // Se hai la property custom "message"
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

        // 2. Crea il ticket
        const ticketPayload = {
          properties: {
            subject: fields.name, // usa il nome come subject
            content: fields.message || "", // il messaggio
            hs_pipeline: "0", // default pipeline (modifica se usi un’altra)
            hs_pipeline_stage: "1", // default stage (modifica se serve)
          },
        };

        const ticketRes = await fetch(
          `${HUBSPOT_API_BASE}/crm/v3/objects/tickets`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${HUBSPOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(ticketPayload),
          }
        );

        if (!ticketRes.ok) {
          const error = await ticketRes.text();
          throw new Error(`Errore creazione ticket: ${error}`);
        }

        const ticket = await ticketRes.json();

        // 3. Se c'è un file, caricalo su HubSpot
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
            message: "Contatto e ticket creati con successo",
            contactId: contact.id,
            ticketId: ticket.id,
            file: fileInfo,
          }),
        });
      } catch (err) {
        resolve({
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: err.message }),
        });
      }
    });

    busboy.end(Buffer.from(event.body || "", "base64"));
  });
};
