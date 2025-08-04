const { allowedOrigins } = require("./config");

/**
 * Genera headers CORS comuni per tutte le functions
 * @param {string} origin - Origin della richiesta
 * @param {string|string[]} allowedMethods - Metodi HTTP permessi
 * @param {string|string[]} allowedHeaders - Headers permessi (opzionale)
 * @returns {Object} Headers CORS
 */
function getCorsHeaders(
  origin,
  allowedMethods,
  allowedHeaders = "Content-Type, Authorization"
) {
  const methods = Array.isArray(allowedMethods)
    ? allowedMethods.join(", ")
    : allowedMethods;
  const headers = Array.isArray(allowedHeaders)
    ? allowedHeaders.join(", ")
    : allowedHeaders;

  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin)
      ? origin
      : "",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": headers,
    "Access-Control-Allow-Methods": `${methods}, OPTIONS`,
  };
}

/**
 * Gestisce richiesta OPTIONS preflight
 * @param {Object} corsHeaders - Headers CORS
 * @returns {Object} Risposta preflight
 */
function handlePreflight(corsHeaders) {
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: "OK (CORS preflight)",
  };
}

/**
 * Gestisce metodo HTTP non permesso
 * @param {Object} corsHeaders - Headers CORS
 * @param {string} allowedMethod - Metodo permesso
 * @returns {Object} Risposta errore 405
 */
function handleMethodNotAllowed(corsHeaders, allowedMethod) {
  return {
    statusCode: 405,
    headers: corsHeaders,
    body: JSON.stringify({
      error: `Method Not Allowed - Use ${allowedMethod}`,
    }),
  };
}

/**
 * Gestisce tutte le operazioni CORS comuni in una function
 * @param {Object} event - Evento Netlify
 * @param {string} allowedMethod - Metodo HTTP permesso (es: 'POST', 'PUT')
 * @param {string|string[]} allowedHeaders - Headers permessi (opzionale)
 * @returns {Object|null} Risposta se gestita, null se deve continuare
 */
function handleCorsAndMethod(event, allowedMethod, allowedHeaders) {
  const origin = event.headers.origin;
  const corsHeaders = getCorsHeaders(origin, allowedMethod, allowedHeaders);

  // Gestione preflight OPTIONS
  if (event.httpMethod === "OPTIONS") {
    return handlePreflight(corsHeaders);
  }

  // Controllo metodo HTTP
  if (event.httpMethod !== allowedMethod) {
    return handleMethodNotAllowed(corsHeaders, allowedMethod);
  }

  // Ritorna headers per uso nella function
  return { corsHeaders };
}

module.exports = {
  getCorsHeaders,
  handlePreflight,
  handleMethodNotAllowed,
  handleCorsAndMethod,
};
