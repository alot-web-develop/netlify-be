const allowedOrigins = [
  "http://localhost:3000",
  "https://olamide.alotwebstudio.com",
  "https://olamidedentaltechnology.co.uk",
];

const uploadFolderId = process.env.UPLOAD_FOLDER_ID;

const casesFolderId = process.env.DRIVE_CASEFOLDER_ID;

const gdprSheetsId = process.env.GDPR_CONSENTS_SHEET_ID;

// Email configuration
const emailConfig = {
  recipientEmail: "olamidedentaltechnology@gmail.com",
  //recipientEmail: "alot.webstudio@gmail.com",
  defaultSender: process.env.GMAIL_USER,
  host: process.env.GMAIL_HOST,
  port: 587,
  secure: "STARTTLS", // Use STARTTLS for secure connection
};

module.exports = {
  allowedOrigins,
  uploadFolderId,
  casesFolderId,
  gdprSheetsId,
  emailConfig,
};
