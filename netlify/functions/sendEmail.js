const { google } = require("googleapis");
const nodemailer = require("nodemailer");

require("dotenv").config();

//----DECLARATION ALLOWED ORIGINS

const allowedOrigins = [
  "http://localhost:3000",
  "https://olamide.alotwebstudio.com",
  "https://olamidedentaltechnology.co.uk/",
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
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
  ],
});

// const drive = google.drive({ version: "v3", auth });
const sheets = google.sheets({ version: "v4", auth });

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
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  ///// ---- AVVIO HANDLER ----

  console.log("Lambda triggered");

  ///// ---- CONTROLLO METODO HTTP ----

  if (event.httpMethod === "OPTIONS") {
    console.log("Handling OPTIONS preflight request");
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: "OK (CORS preflight)",
    };
  }

  if (event.httpMethod !== "POST") {
    console.log("Invalid method:", event.httpMethod);
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: "Method Not Allowed",
    };
  }

  try {
    ///// ---- ESTRAZIONE CAMPI DAL FORM ----

    const body = JSON.parse(event.body);
    const {
      name,
      email,
      message,
      phone,
      practice,
      consentText,
      formId,
      fileLinks,
    } = body;

    console.log("fields:", {
      name,
      email,
      message,
      phone,
      practice,
      consentText,
      formId,
      fileLinks,
    });

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
      to: "olamidedentaltechnology@gmail.com",
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
