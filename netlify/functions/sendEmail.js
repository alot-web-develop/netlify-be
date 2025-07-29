const { handleCorsAndMethod } = require("../../lib/cors-handler");
const { gdprSheetsId, emailConfig } = require("../../lib/config");
const {
  EmailValidationError,
  EmailSendError,
  validateEmailRequest,
  processEmailWorkflow,
  createEmailSuccessResponse,
  createEmailErrorResponse
} = require("../../lib/utils/email-utils");
const { GoogleAPIError } = require("../../lib/utils/google-api-client");

/**
 * Main email handler - processes contact form submissions
 * Sends notification email and saves consent to Google Sheets
 * @param {Object} event - Lambda event object
 * @returns {Promise<Object>} HTTP response
 */
exports.handler = async (event) => {
  // Handle CORS and validate HTTP method
  const corsCheck = handleCorsAndMethod(event, "POST", "Content-Type");
  if (corsCheck.statusCode) {
    return corsCheck;
  }
  const { corsHeaders } = corsCheck;

  try {
    // Parse and validate request body
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

    // Validate form data
    const validatedData = validateEmailRequest(requestBody);

    // Log the processing start (for debugging)
    console.log(`Processing email for: ${validatedData.name} (${validatedData.email})`);

    // Process the complete email workflow (send email + save consent)
    const workflowResult = await processEmailWorkflow(
      validatedData,
      gdprSheetsId,
      emailConfig.recipientEmail
    );

    // Handle workflow results
    if (workflowResult.errors.length === 0) {
      // Complete success
      console.log("Email sent and consent saved successfully");
      return createEmailSuccessResponse(corsHeaders, {
        emailId: workflowResult.emailResult?.messageId,
        timestamp: new Date().toISOString()
      });
    } else {
      // Partial success or complete failure
      const emailFailed = !workflowResult.emailSent;
      const consentFailed = !workflowResult.consentSaved;

      if (emailFailed && consentFailed) {
        // Complete failure
        console.error("Both email and consent failed:", workflowResult.errors);
        return createEmailErrorResponse(
          500,
          "Failed to send email and save consent",
          corsHeaders,
          workflowResult.errors.map(e => e.error).join('; ')
        );
      } else if (emailFailed) {
        // Email failed but consent saved
        console.error("Email failed but consent saved:", workflowResult.errors);
        return createEmailErrorResponse(
          207, // Multi-status
          "Consent saved but email sending failed",
          corsHeaders,
          workflowResult.errors.find(e => e.type === 'email')?.error
        );
      } else {
        // Email sent but consent failed
        console.error("Email sent but consent failed:", workflowResult.errors);
        return createEmailErrorResponse(
          207, // Multi-status
          "Email sent but consent saving failed",
          corsHeaders,
          workflowResult.errors.find(e => e.type === 'consent')?.error
        );
      }
    }

  } catch (error) {
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
      const statusCode = error.statusCode >= 400 && error.statusCode < 600 
        ? error.statusCode 
        : 502;
      return createEmailErrorResponse(
        statusCode, 
        "Failed to save consent data", 
        corsHeaders, 
        error.message
      );
    }

    // Generic error fallback
    console.error("Unexpected error in email handler:", error);
    return createEmailErrorResponse(
      500, 
      "An unexpected error occurred", 
      corsHeaders, 
      error.message
    );
  }
};