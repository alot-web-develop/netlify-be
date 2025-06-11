const { Handler } = require("@netlify/functions");
const fetch = require("node-fetch");
const Busboy = require("busboy");
const FormData = require("form-data");

const HUBSPOT_API_BASE = "https://api.hubapi.com";
const HUBSPOT_TOKEN = process.env.HUBSPOT_APP_KEY;

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Credentials": "true",
};

exports.handler = async (event) => {
  console.log("Evento ricevuto:", event.httpMethod, event.headers);

  if (event.httpMethod === "OPTIONS") {
    console.log("Risposta a richiesta OPTIONS (CORS preflight)");
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    console.warn("Metodo non consentito:", event.httpMethod);
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  return new Promise((resolve, reject) => {
    console.log("Inizio parsing con Busboy");
    const busboy = Busboy({ headers: event.headers });
    const fields = {};
    let fileBuffer = null;
    let fileName = "";
    let mimeType = "";

    busboy.on("field", (name, value) => {
      console.log(`Campo ricevuto: ${name} = ${value}`);
      fields[name] = value;
    });

    busboy.on("file", (_fieldname, file, filename, _encoding, mimetype) => {
      console.log(`File ricevuto: ${filename} (${mimetype})`);
      const chunks = [];
      fileName = filename;
      mimeType = mimetype;

      file.on("data", (data) => {
        console.log(`Ricevuti chunk file: ${data.length} byte`);
        chunks.push(data);
      });

      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
        console.log(
          `File completato. Dimensione totale: ${fileBuffer.length} byte`
        );
      });
    });

    busboy.on("finish", async () => {
      console.log("Parsing completato. Campi:", fields);
      try {
        console.log("1. Creazione contatto su HubSpot");
        const contactPayload = {
          properties: {
            email: fields.email,
            firstname: fields.name,
            phone: fields.phone || "",
            company: fields.practice || "",
            message: fields.message || "",
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
          console.error("Errore creazione contatto:", error);
          throw new Error(`Errore creazione contatto: ${error}`);
        }

        const contact = await contactRes.json();
        console.log("Contatto creato con ID:", contact.id);

        console.log("2. Creazione ticket su HubSpot");
        const ticketPayload = {
          properties: {
            subject: fields.name,
            content: fields.message || "",
            hs_pipeline: "0",
            hs_pipeline_stage: "1",
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
          console.error("Errore creazione ticket:", error);
          throw new Error(`Errore creazione ticket: ${error}`);
        }

        const ticket = await ticketRes.json();
        console.log("Ticket creato con ID:", ticket.id);

        let fileInfo;

        if (fileBuffer) {
          console.log("3. Upload file su HubSpot");
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
            console.error("Errore upload file:", fileErr);
            throw new Error(`Errore upload file: ${fileErr}`);
          }

          const fileData = await fileRes.json();
          fileInfo = {
            fileId: fileData.id,
            fileUrl: fileData.url,
            fileName: fileData.name,
          };
          console.log("File caricato con successo:", fileInfo);
        } else {
          console.log("Nessun file da caricare");
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
        console.error("Errore nella funzione:", err);
        resolve({
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: err.message }),
        });
      }
    });

    try {
      busboy.end(Buffer.from(event.body || "", "base64"));
    } catch (err) {
      console.error("Errore durante busboy.end():", err);
      resolve({
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: err.message }),
      });
    }
  });
};
