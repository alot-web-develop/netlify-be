const { handleCorsAndMethod } = require("../../lib/cors-handler");
const { gdprSheetsId, emailConfig } = require("../../lib/config");
const {
  EmailValidationError,
  EmailSendError,
  validateEmailRequest,
  processEmailWorkflow,
  createEmailSuccessResponse,
  createEmailErrorResponse,
} = require("../../lib/utils/email-utils");
const { GoogleAPIError } = require("../../lib/utils/google-api-client");

/**
 * Main email handler - processes contact form submissions
 * Sends notification email and saves consent to Google Sheets
 * @param {Object} event - Lambda event object
 * @returns {Promise<Object>} HTTP response
 */
exports.handler = async (event) => {
  const corsCheck = handleCorsAndMethod(event, "POST", "Content-Type");
  if (corsCheck.statusCode) {
    return corsCheck;
  }
  const { corsHeaders } = corsCheck;

  try {
    let requestBody;
    try {
      requestBody = JSON.parse(event.body);
    } catch (parseError) {
      return createEmailErrorResponse(
        400,
        "Invalid JSON in request body",
        corsHeaders
      );
    }

    const validatedData = validateEmailRequest(requestBody);

    const workflowResult = await processEmailWorkflow(
      validatedData,
      gdprSheetsId,
      emailConfig.recipientEmail
    );

    if (workflowResult.errors.length === 0) {
      console.log("Email sent and consent saved successfully");
      return createEmailSuccessResponse(corsHeaders, {
        emailId: workflowResult.emailResult?.messageId,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.warn("Workflow completed with errors:", workflowResult.errors);
      return workflowErrorsHandler(workflowResult, corsHeaders);
    }
  } catch (error) {
    return errorsHandler(error, corsHeaders);
  }
};

function workflowErrorsHandler(workflowResult, corsHeaders) {
  const emailFailed = !workflowResult.emailSent;
  const consentFailed = !workflowResult.consentSaved;

  if (emailFailed && consentFailed) {
    console.error("Both email and consent failed:", workflowResult.errors);
    return createEmailErrorResponse(
      500,
      "Failed to send email and save consent",
      corsHeaders,
      workflowResult.errors.map((e) => e.error).join("; ")
    );
  } else if (emailFailed) {
    console.error("Email failed but consent saved:", workflowResult.errors);
    return createEmailErrorResponse(
      207, // Multi-status
      "Consent saved but email sending failed",
      corsHeaders,
      workflowResult.errors.find((e) => e.type === "email")?.error
    );
  } else {
    console.error("Email sent but consent failed:", workflowResult.errors);
    return createEmailErrorResponse(
      207, // Multi-status
      "Email sent but consent saving failed",
      corsHeaders,
      workflowResult.errors.find((e) => e.type === "consent")?.error
    );
  }
}

function errorsHandler(error, corsHeaders) {
  // Handle specific error types
  if (error instanceof EmailValidationError) {
    console.warn("Email validation failed:", error.message);
    return createEmailErrorResponse(400, error.message, corsHeaders);
  }

  if (error instanceof EmailSendError) {
    console.error("Email sending failed:", error.message);
    return createEmailErrorResponse(
      500,
      "Failed to send notification email",
      corsHeaders,
      error.message
    );
  }

  if (error instanceof GoogleAPIError) {
    console.error("Google API error:", error.message);
    const statusCode =
      error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 502;
    return createEmailErrorResponse(
      statusCode,
      "Failed to save consent data",
      corsHeaders,
      error.message
    );
  }

  console.error("Unexpected error in email handler:", error);
  return createEmailErrorResponse(
    500,
    "An unexpected error occurred",
    corsHeaders,
    error.message
  );
}
