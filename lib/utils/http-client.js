const https = require('https');

/**
 * Modern HTTP client for making API requests
 */
class HttpClient {
  /**
   * Make an HTTP request
   * @param {Object} options - Request options
   * @param {string} options.hostname - The hostname
   * @param {number} options.port - The port number
   * @param {string} options.path - The request path
   * @param {string} options.method - HTTP method
   * @param {Object} options.headers - Request headers
   * @param {string|Buffer} [data] - Request body data
   * @returns {Promise<{statusCode: number, headers: Object, data: string}>}
   */
  static async request(options, data = null) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: responseData
          });
        });
      });

      req.on('error', (error) => {
        reject(new Error(`HTTP request failed: ${error.message}`));
      });

      if (data) {
        req.write(data);
      }
      
      req.end();
    });
  }

  /**
   * Make a POST request with JSON data
   * @param {string} url - The full URL
   * @param {Object} jsonData - Data to send as JSON
   * @param {Object} headers - Additional headers
   * @returns {Promise<{statusCode: number, headers: Object, data: string}>}
   */
  static async postJson(url, jsonData, headers = {}) {
    const urlObj = new URL(url);
    const postData = JSON.stringify(jsonData);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers
      }
    };

    return this.request(options, postData);
  }

  /**
   * Parse JSON response and handle errors
   * @param {Object} response - Response from request method
   * @returns {Object} Parsed JSON data
   * @throws {Error} If response is not successful or JSON is invalid
   */
  static parseJsonResponse(response) {
    const { statusCode, data } = response;

    let parsedData;
    try {
      parsedData = JSON.parse(data);
    } catch (error) {
      throw new Error(`Invalid JSON response: ${data}`);
    }

    if (statusCode >= 400) {
      const errorMessage = parsedData.error?.message || parsedData.message || data;
      throw new Error(`HTTP ${statusCode}: ${errorMessage}`);
    }

    return parsedData;
  }
}

module.exports = HttpClient;