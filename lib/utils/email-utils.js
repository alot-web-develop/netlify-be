const nodemailer = require("nodemailer");
const { googleAPIClient, GoogleAPIError } = require("./google-api-client");

/**
 * Email validation errors
 */
class EmailValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "EmailValidationError";
    this.field = field;
  }
}

/**
 * Email sending errors
 */
class EmailSendError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = "EmailSendError";
    this.originalError = originalError;
  }
}

/**
 * Validate email request data
 * @param {Object} requestBody - The request body to validate
 * @returns {Object} Validated data
 * @throws {EmailValidationError} If validation fails
 */
function validateEmailRequest(requestBody) {
  console.log("=== EMAIL VALIDATION DEBUG ===");
  console.log("Raw requestBody:", JSON.stringify(requestBody, null, 2));

  const {
    name,
    email,
    message,
    phone,
    practice,
    consentText,
    formId,
    fileLinks = [],
  } = requestBody;

  console.log("Extracted fileLinks:", JSON.stringify(fileLinks, null, 2));

  // Required fields validation
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new EmailValidationError(
      "Name is required and must be a non-empty string",
      "name"
    );
  }

  if (!email || typeof email !== "string" || !isValidEmail(email)) {
    throw new EmailValidationError("Valid email address is required", "email");
  }

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    throw new EmailValidationError(
      "Message is required and must be a non-empty string",
      "message"
    );
  }

  if (!consentText || typeof consentText !== "string") {
    throw new EmailValidationError("Consent text is required", "consentText");
  }

  if (!formId || typeof formId !== "string") {
    throw new EmailValidationError("Form ID is required", "formId");
  }

  // Optional fields validation
  if (phone && typeof phone !== "string") {
    throw new EmailValidationError("Phone must be a string", "phone");
  }

  if (practice && typeof practice !== "string") {
    throw new EmailValidationError("Practice must be a string", "practice");
  }

  if (!Array.isArray(fileLinks)) {
    throw new EmailValidationError("File links must be an array", "fileLinks");
  }

  // Validate file links structure
  for (const [index, fileLink] of fileLinks.entries()) {
    console.log(
      `Validating fileLink at index ${index}:`,
      JSON.stringify(fileLink, null, 2)
    );

    // Support multiple formats:
    // 1. Legacy: {filename, link}
    // 2. Images: {fileName, imgSrc}
    // 3. Files: {fileName, downloadUrl/viewUrl, fileId}
    const hasLegacyFormat = fileLink.filename && fileLink.link;
    const hasImageFormat = fileLink.fileName && fileLink.imgSrc;
    const hasFileFormat =
      fileLink.fileName && (fileLink.downloadUrl || fileLink.viewUrl);

    console.log(`Has legacy format (filename, link): ${hasLegacyFormat}`);
    console.log(`Has image format (fileName, imgSrc): ${hasImageFormat}`);
    console.log(
      `Has file format (fileName, downloadUrl/viewUrl): ${hasFileFormat}`
    );

    if (!hasLegacyFormat && !hasImageFormat && !hasFileFormat) {
      console.error(`Invalid fileLink structure at index ${index}:`, fileLink);
      throw new EmailValidationError(
        `File link at index ${index} must have either (filename, link), (fileName, imgSrc), or (fileName, downloadUrl/viewUrl) properties. Received: ${JSON.stringify(
          fileLink
        )}`,
        "fileLinks"
      );
    }
  }

  return {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    message: message.trim(),
    phone: phone?.trim() || null,
    practice: practice?.trim() || null,
    consentText: consentText.trim(),
    formId: formId.trim(),
    fileLinks,
  };
}

/**
 * Simple email validation
 * @param {string} email - Email to validate
 * @returns {boolean} True if email format is valid
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Format email content from form data
 * @param {Object} formData - Validated form data
 * @returns {string} Formatted email text
 */
function formatEmailContent(formData) {
  const { name, email, message, phone, practice, fileLinks } = formData;

  let text = `Name: ${name}\nEmail: ${email}\nMessage: ${message}`;
  text += `\nPhone: ${phone || "not provided"}`;
  text += `\nPractice name: ${practice || "not provided"}`;

  if (fileLinks.length > 0) {
    text += "\n\nFiles:\n";
    fileLinks.forEach((fileLink) => {
      // Support multiple formats:
      // 1. Legacy: {filename, link}
      // 2. Images: {fileName, imgSrc}
      // 3. Files: {fileName, downloadUrl/viewUrl, fileId}
      const filename = fileLink.filename || fileLink.fileName;
      const link =
        fileLink.link ||
        fileLink.imgSrc ||
        fileLink.downloadUrl ||
        fileLink.viewUrl;
      text += `- ${filename}: ${link}\n`;
    });
  }

  return text;
}

/**
 * Create and configure nodemailer transporter
 * @returns {Object} Configured nodemailer transporter
 * @throws {EmailSendError} If configuration is invalid
 */
function createEmailTransporter() {
  const { GMAIL_HOST, GMAIL_USER, GMAIL_PASS } = process.env;

  if (!GMAIL_HOST || !GMAIL_USER || !GMAIL_PASS) {
    throw new EmailSendError(
      "Email configuration is incomplete. Check GMAIL_HOST, GMAIL_USER, and GMAIL_PASS environment variables."
    );
  }

  return nodemailer.createTransport({
    host: GMAIL_HOST,
    port: 587,
    // secure: "STARTTLS",
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_PASS,
    },
  });
}

/**
 * Send notification email
 * @param {Object} formData - Validated form data
 * @param {string} recipientEmail - Email address to send to
 * @returns {Promise<Object>} Email send result
 * @throws {EmailSendError} If email sending fails
 */
async function sendNotificationEmail(
  formData,
  recipientEmail = "olamidedentaltechnology@gmail.com"
) {
  try {
    const transporter = createEmailTransporter();
    const emailContent = formatEmailContent(formData);

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: recipientEmail,
      subject: `New message from ${formData.name}`,
      text: emailContent,
    };

    const result = await transporter.sendMail(mailOptions);
    return result;
  } catch (error) {
    throw new EmailSendError(
      `Failed to send notification email: ${error.message}`,
      error
    );
  }
}

/**
 * Save consent data to Google Sheets
 * @param {Object} consentData - Consent data to save
 * @param {string} consentData.name - User's name
 * @param {string} consentData.email - User's email
 * @param {string} consentData.consentText - Consent text
 * @param {string} consentData.formId - Form ID
 * @param {string} spreadsheetId - Google Sheets ID
 * @returns {Promise<Object>} Sheets append result
 * @throws {GoogleAPIError} If sheets operation fails
 */
async function saveConsentToSheets(consentData, spreadsheetId) {
  const { name, email, consentText, formId } = consentData;

  const timestamp = new Date().toISOString();
  const values = [[timestamp, name, email, consentText, formId]];

  try {
    const result = await googleAPIClient.appendToSheet(
      spreadsheetId,
      "A1",
      values,
      "RAW"
    );

    return result;
  } catch (error) {
    // Re-throw GoogleAPIError as-is, wrap others
    if (error instanceof GoogleAPIError) {
      throw error;
    }
    throw new GoogleAPIError(
      `Failed to save consent to sheets: ${error.message}`
    );
  }
}

/**
 * Create successful email response
 * @param {Object} corsHeaders - CORS headers
 * @param {Object} additionalData - Additional data to include in response
 * @returns {Object} Formatted success response
 */
function createEmailSuccessResponse(corsHeaders, additionalData = {}) {
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      status: "success",
      message: "Email sent and data saved.",
      ...additionalData,
    }),
  };
}

/**
 * Create email error response
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Object} corsHeaders - CORS headers
 * @param {string} [details] - Additional error details
 * @returns {Object} Formatted error response
 */
function createEmailErrorResponse(
  statusCode,
  message,
  corsHeaders,
  details = null
) {
  const body = {
    status: "error",
    message,
  };

  if (details) {
    body.details = details;
  }

  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
  };
}

/**
 * Process complete email workflow
 * @param {Object} formData - Validated form data
 * @param {string} spreadsheetId - Google Sheets ID for consent storage
 * @param {string} recipientEmail - Email recipient
 * @returns {Promise<Object>} Workflow result with email and sheets data
 */
async function processEmailWorkflow(formData, spreadsheetId, recipientEmail) {
  const results = {
    emailSent: false,
    consentSaved: false,
    emailResult: null,
    consentResult: null,
    errors: [],
  };

  // Send email
  try {
    results.emailResult = await sendNotificationEmail(formData, recipientEmail);
    results.emailSent = true;
  } catch (error) {
    results.errors.push({ type: "email", error: error.message });
  }

  // Save consent
  try {
    results.consentResult = await saveConsentToSheets(formData, spreadsheetId);
    results.consentSaved = true;
  } catch (error) {
    results.errors.push({ type: "consent", error: error.message });
  }

  return results;
}

module.exports = {
  EmailValidationError,
  EmailSendError,
  validateEmailRequest,
  formatEmailContent,
  sendNotificationEmail,
  saveConsentToSheets,
  createEmailSuccessResponse,
  createEmailErrorResponse,
  processEmailWorkflow,
};
