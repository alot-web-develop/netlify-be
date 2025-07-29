const allowedOrigins = [
  "http://localhost:3000",
  "https://olamide.alotwebstudio.com",
  "https://olamidedentaltechnology.co.uk",
];

const targetFolderId = "1hdgSl9KMTTOYkcsYsppC4QGojE6FYY7W";

// Google Drive folder for case images
const casesFolderId = process.env.DRIVE_CASEFOLDER_ID;

// Google Sheets ID for GDPR consents
const gdprSheetsId = process.env.GDPR_CONSENTS_SHEET_ID;

// Email configuration
const emailConfig = {
  recipientEmail: 'olamidedentaltechnology@gmail.com',
  defaultSender: process.env.GMAIL_USER,
  host: process.env.GMAIL_HOST,
  port: 587,
  secure: false // Use STARTTLS
};

module.exports = {
  allowedOrigins,
  targetFolderId,
  casesFolderId,
  gdprSheetsId,
  emailConfig,
};