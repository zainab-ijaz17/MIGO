// utils/sapRoutes.js
const express = require("express");
const axios = require("axios");
const https = require("https");

const router = express.Router();

// SAP API Management gateway configuration (primary)
const SAP_API_MGMT_URL = process.env.SAP_API_MGMT_URL; // e.g., https://devspace.test.apimanagement.eu10.hana.ondemand.com
const SAP_API_MGMT_BATCH_URL = process.env.SAP_API_MGMT_BATCH_URL || 'https://devspace.test.apimanagement.eu10.hana.ondemand.com/bsp/batch';
const SAP_API_MGMT_KEY = process.env.SAP_API_MGMT_KEY; // API key for SAP API Management

// Direct SAP server configuration (fallback)
const SAP_USER = process.env.SAP_USER;
const SAP_PASS = process.env.SAP_PASS;
const ENVIRONMENT_BASE_URLS = {
  dev: process.env.SAP_BASE_URL || "https://10.200.11.37:44300",
  prd: "https://10.200.10.115:44300"  // Specific URL for environment 300
};
const BSP_SERVICE_PATH = process.env.BSP_SERVICE_PATH; // e.g., /sap/opu/odata/sap/ZUM_BSP_BATCH_INFORMATION_SRV

// Ignore SSL certificate errors (for dev/self-signed SSL)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// OPTIONS preflight for BatchInfo
router.options("/BatchInfo/:batchNumber", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-User-Auth, X-User-Environment");
  res.status(200).send();
});

// OPTIONS preflight for 300 Level BatchInfo
router.options("/batch/300/:batchNumber", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-User-Auth, X-User-Environment");
  res.status(200).send();
});

// GET 300 level batch info by batch number
router.get("/batch/300/:batchNumber", async (req, res) => {
  const { batchNumber } = req.params;
  if (!batchNumber) return res.status(400).json({ error: "Batch number is required" });

  // Get user credentials from headers
  const userAuthHeader = req.headers['x-user-auth'];
  console.log("X-User-Auth header for 300 level:", userAuthHeader ? 'Present' : 'Missing');
  
  if (!userAuthHeader) {
    console.error("Missing X-User-Auth header for 300 level batch request");
    return res.status(401).json({ error: "User credentials required" });
  }

  // Get the base URL from environment variables
  const baseUrl = process.env.PRD_300_BATCH_URL || 'https://prdspace.prod01.apimanagement.eu10.hana.ondemand.com/bsp/prd/batch/BatchInfoSet';

  // Construct the full URL with the batch number
  const url = `${baseUrl}?$filter=BatchNumber eq '${batchNumber}'`;
  console.log("300 Level Batch API URL:", url);

  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Basic ${userAuthHeader}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      validateStatus: () => true // Always resolve the promise regardless of the status code
    });

    // Forward the status code and response from the SAP API
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error("Error calling 300 Level Batch API:", error.message);
    return res.status(500).json({ 
      error: "Failed to fetch batch information",
      details: error.message 
    });
  }
});

// GET batch info by batch number (uses per-request user credentials)
router.get("/BatchInfo/:batchNumber", async (req, res) => {
  const { batchNumber } = req.params;
  if (!batchNumber) return res.status(400).json({ error: "Batch number is required" });

  // Debug: log all incoming headers
  console.log("Incoming headers:", req.headers);

  // Get user credentials from headers
  const userAuthHeader = req.headers['x-user-auth'];
  const userEnvironment = req.headers['x-user-environment'] || 'dev';
  console.log("X-User-Auth header:", userAuthHeader);
  console.log("X-User-Environment header:", userEnvironment);
  if (!userAuthHeader) {
    console.error("Missing X-User-Auth header");
    return res.status(401).json({ error: "User credentials required" });
  }

  // Map environment to numeric SAP client
  const clientMap = { dev: '110', prd: '300' };
  const sapClient = clientMap[userEnvironment] || userEnvironment;
  console.log("Mapped sap-client:", sapClient);

  let username, password;
  try {
    const decoded = Buffer.from(userAuthHeader, 'base64').toString();
    console.log("Decoded auth string:", decoded);
    [username, password] = decoded.split(':');
    console.log("Extracted username:", username);
    if (!username || !password) throw new Error();
  } catch (e) {
    console.error("Failed to decode user credentials:", e);
    return res.status(401).json({ error: "Invalid user credentials" });
  }

  console.log(`Fetching batch info for: ${batchNumber} (user: ${username})`);
  const baseUrl = ENVIRONMENT_BASE_URLS[userEnvironment] || ENVIRONMENT_BASE_URLS.dev;
  console.log(`Using base URL for environment ${userEnvironment}: ${baseUrl}`);
  console.log(`BSP_SERVICE_PATH: ${BSP_SERVICE_PATH}`);

  try {
    const url = `${baseUrl}${BSP_SERVICE_PATH}/BatchInfoSet?$filter=Charg eq '${batchNumber}'&$format=json&sap-client=${sapClient}`;
    console.log(`Full URL: ${url}`);

    const response = await axios.get(url, {
      httpsAgent,
      auth: { username, password },
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest"
      },
      validateStatus: () => true,
      timeout: 30000
    });

    if (response.status === 401) {
      return res.status(401).json({ error: "Unauthorized. Check SAP credentials." });
    }

    if (response.status !== 200) {
      return res.status(response.status).json({
        error: "Error fetching batch info from SAP",
        data: response.data
      });
    }

    const batchData = response.data?.d?.results;
    if (!batchData || batchData.length === 0) {
      return res.status(404).json({ error: "Batch not found" });
    }

    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-User-Auth, X-User-Environment");
    res.json(batchData[0]);

  } catch (err) {
    console.error("SAP batch fetch error:", err.message);
    console.error("Error details:", {
      message: err.message,
      code: err.code,
      status: err.response?.status,
      statusText: err.response?.statusText,
      isTimeout: err.code === 'ECONNABORTED'
    });
    
    if (err.code === 'ECONNABORTED') {
      return res.status(408).json({ error: "Request timeout - SAP server is not responding", details: err.message });
    }
    
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// GET batch info from SAP API Management gateway
router.get("/BatchInfoGateway/:batchNumber", async (req, res) => {
  const { batchNumber } = req.params;
  if (!batchNumber) return res.status(400).json({ error: "Batch number is required" });

  // Get environment from headers (default to 'dev' if not specified)
  const userEnvironment = req.headers['x-user-environment'] || '110';
  const isProduction = userEnvironment === '300' || userEnvironment === 'prd';
  
  if (isProduction) {
    // Use production endpoint for 300/prd environment
    const baseUrl = process.env.PRD_300_BATCH_URL || 'https://prdspace.prod01.apimanagement.eu10.hana.ondemand.com/bsp/prd/batch/BatchInfoSet';
    // Use the full endpoint URL directly
    // OData filter syntax: $filter=FieldName eq 'value'
    let url = `${baseUrl}?$filter=BatchNumber eq '${batchNumber}'`;
    console.log('Trying URL format 1:', url);
    console.log(`[${new Date().toISOString()}] PRODUCTION: Fetching batch ${batchNumber} from ${url}`);
    
    try {
      // Get user credentials from headers
      const userAuthHeader = req.headers['x-user-auth'];
      console.log('X-User-Auth header:', userAuthHeader ? 'Present' : 'Missing');
      
      if (!userAuthHeader) {
        console.error('Missing X-User-Auth header');
        return res.status(401).json({ error: 'User credentials required' });
      }
      
      // Decode the credentials
      let username, password;
      try {
        const decoded = Buffer.from(userAuthHeader, 'base64').toString();
        [username, password] = decoded.split(':');
        console.log(`Using credentials for user: ${username}`);
      } catch (e) {
        console.error('Failed to decode user credentials');
        return res.status(401).json({ error: 'Invalid user credentials format' });
      }
      
      // First, get CSRF token from the service root
      // Extract service root by removing the entity set path (BatchInfoSet)
      // baseUrl format: https://...domain.../bsp/prd/batch/BatchInfoSet
      // Service root should be: https://...domain.../bsp/prd/batch
      let baseUrlForCsrf = baseUrl;
      if (baseUrl.includes('/BatchInfoSet')) {
        baseUrlForCsrf = baseUrl.replace('/BatchInfoSet', '');
      } else {
        // If no BatchInfoSet in URL, use base URL without query params
        baseUrlForCsrf = baseUrl.split('?')[0];
      }
      let csrfToken = '';
      let cookies = [];
      
      try {
        // Try HEAD request first (preferred for CSRF token fetch)
        let csrfResponse;
        try {
          csrfResponse = await axios.head(baseUrlForCsrf, {
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
            auth: {
              username: username,
              password: password
            },
            headers: {
              'X-CSRF-Token': 'Fetch',
              'Accept': 'application/json'
            },
            validateStatus: () => true
          });
        } catch (headError) {
          // If HEAD fails, try GET request to the entity set URL
          console.log('HEAD request failed, trying GET for CSRF token');
          const entitySetUrl = baseUrl.split('?')[0]; // Use full entity set URL without query
          csrfResponse = await axios.get(entitySetUrl, {
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
            auth: {
              username: username,
              password: password
            },
            headers: {
              'X-CSRF-Token': 'Fetch',
              'Accept': 'application/json'
            },
            validateStatus: () => true
          });
        }
        
        csrfToken = csrfResponse.headers['x-csrf-token'];
        // Extract cookies from response
        const setCookieHeaders = csrfResponse.headers['set-cookie'];
        if (setCookieHeaders) {
          cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
        }
        console.log('CSRF Token:', csrfToken);
        console.log('Cookies received:', cookies.length);
      } catch (csrfError) {
        console.error('Error fetching CSRF token:', csrfError.message);
        // Continue without CSRF token if we can't get one
      }
      
      // Prepare headers for the actual request
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      };
      
      // Add CSRF token if available
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
      
      // Add cookies if available
      if (cookies.length > 0) {
        const cookieString = cookies.map(cookie => {
          // Extract cookie name and value (handle full cookie string)
          const parts = cookie.split(';');
          return parts[0];
        }).join('; ');
        headers['Cookie'] = cookieString;
      }
      
      console.log('Making request to:', url);
      console.log('Request headers:', JSON.stringify({
        ...headers,
        'Cookie': headers['Cookie'] ? '[COOKIES SET]' : undefined
      }, null, 2));
      
      const startTime = Date.now();
      const response = await axios.get(url, {
        httpsAgent: new https.Agent({ 
          rejectUnauthorized: false,
          requestCert: false
        }),
        auth: {
          username: username,
          password: password
        },
        headers: headers,
        validateStatus: () => true, // handle status manually
        timeout: 30000, // 30 second timeout
        maxRedirects: 0 // Don't follow redirects
      });
      
      const responseTime = Date.now() - startTime;
      console.log(`Response status: ${response.status} (${response.statusText}) - ${responseTime}ms`);
      console.log('Response headers:', JSON.stringify(response.headers, null, 2));
      console.log('Response data:', JSON.stringify(response.data, null, 2));
      
      if (response.status === 403) {
        console.error('403 Forbidden - Possible issues:');
        console.error('- User may not have permission to access this resource');
        console.error('- Required SAP roles may be missing');
        console.error('- IP address may be restricted');
        console.error('Response data:', response.data);
      }
      
      if (response.status === 400) {
        console.error('400 Bad Request - Possible issues:');
        console.error('- Invalid URL format or query parameters');
        console.error('- Missing or incorrect filter syntax');
        console.error('- Entity set name mismatch');
        console.error('Request URL:', url);
        console.error('Response data:', response.data);
      }

      // Handle the response
      if (response.status === 200) {
        const batchData = response.data?.d?.results || [response.data];
        if (batchData && batchData.length > 0) {
          return res.json(Array.isArray(batchData) ? batchData[0] : batchData);
        }
        return res.status(404).json({ error: "Batch not found" });
      }
      
      // If 400 error, try with Charg field name instead of BatchNumber (some SAP services use different field names)
      if (response.status === 400) {
        console.log('Trying alternative filter with Charg field name');
        const altUrl = `${baseUrl}?$filter=Charg eq '${batchNumber}'`;
        try {
          const altResponse = await axios.get(altUrl, {
            httpsAgent: new https.Agent({ 
              rejectUnauthorized: false,
              requestCert: false
            }),
            auth: {
              username: username,
              password: password
            },
            headers: headers,
            validateStatus: () => true,
            timeout: 30000,
            maxRedirects: 0
          });
          
          if (altResponse.status === 200) {
            const batchData = altResponse.data?.d?.results || [altResponse.data];
            if (batchData && batchData.length > 0) {
              return res.json(Array.isArray(batchData) ? batchData[0] : batchData);
            }
            return res.status(404).json({ error: "Batch not found" });
          }
          console.log('Alternative URL also failed with status:', altResponse.status);
        } catch (altError) {
          console.error('Error with alternative URL:', altError.message);
        }
      }
      
      return res.status(response.status || 500).json({
        error: "Error from SAP API",
        status: response.status,
        data: response.data,
        message: response.data?.error?.message?.value || response.data?.error?.message || response.data
      });
      
    } catch (error) {
      console.error("Error calling production SAP API:", error.message);
      return res.status(500).json({
        error: "Failed to connect to SAP API",
        details: error.message
      });
    }
  } else {
    // Use development endpoint for other environments
    const baseUrl = process.env.SAP_API_MGMT_BATCH_URL || 'https://devspace.test.apimanagement.eu10.hana.ondemand.com/bsp/batch';
    const url = `${baseUrl}/BatchInfoSet?$filter=Charg eq '${batchNumber}'&$format=json`;
    console.log(`[${new Date().toISOString()}] DEVELOPMENT: Fetching batch ${batchNumber} from ${url}`);
    
    try {
      const response = await axios.get(url, {
        auth: {
          username: SAP_USER,
          password: SAP_PASS
        },
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        validateStatus: () => true, // handle status manually
        timeout: 30000 // 30 second timeout
      });

      if (response.status === 200) {
        const batchData = response.data?.d?.results;
        if (batchData && batchData.length > 0) {
          return res.json(batchData[0]);
        }
        return res.status(404).json({ error: "Batch not found" });
      }
      
      return res.status(response.status || 500).json({
        error: "Error from SAP API Management",
        status: response.status,
        data: response.data
      });
      
    } catch (error) {
      console.error("Error calling development SAP API:", error.message);
      return res.status(500).json({
        error: "Failed to connect to SAP API Management",
        details: error.message
      });
    }
  }
});

module.exports = router;