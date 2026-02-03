// backend/routes/migoRoutes.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const { MigoClient } = require('../utils/migoClient');

// SAP API Management gateway configuration (primary)
const SAP_API_MGMT_URL = process.env.SAP_API_MGMT_URL;
const SAP_API_MGMT_MIGO_URL = process.env.SAP_API_MGMT_MIGO_URL;
const SAP_API_MGMT_MIGO_POST_URL = process.env.SAP_API_MGMT_MIGO_POST_URL;
// Development (110/dev) MIGO endpoints
const DEV_MIGO_CSRF_URL = process.env.DEV_MIGO_CSRF_URL || process.env.SAP_API_MGMT_MIGO_URL || 'https://devspace.test.apimanagement.eu10.hana.ondemand.com/bsp/migo';
const DEV_MIGO_POST_URL = process.env.DEV_MIGO_POST_URL || process.env.SAP_API_MGMT_MIGO_POST_URL || 'https://devspace.test.apimanagement.eu10.hana.ondemand.com/bsp/migo/TransferHeaderSet';
// Production (300/prd) MIGO endpoints
const PRD_MIGO_CSRF_URL = process.env.PRD_MIGO_CSRF_URL || 'https://prdspace.prod01.apimanagement.eu10.hana.ondemand.com/bsp/prd/migo';
const PRD_MIGO_POST_URL = process.env.PRD_MIGO_POST_URL || 'https://prdspace.prod01.apimanagement.eu10.hana.ondemand.com/bsp/prd/migo/TransferHeaderSet';
const SAP_USER = process.env.SAP_USER;
const SAP_PASS = process.env.SAP_PASS;

// Helper to normalize environment (dev/110 are same, prd/300 are same)
const normalizeEnvironment = (env) => {
  if (env === '110' || env === 'dev') return 'dev';
  if (env === '300' || env === 'prd') return 'prd';
  return env;
};

// Ignore SSL certificate errors (for dev/self-signed SSL)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Middleware to log all MIGO route requests
router.use((req, res, next) => {
  console.log(`[MIGO ROUTE] ${req.method} ${req.path} - Headers:`, Object.keys(req.headers));
  next();
});

// Helper to extract user credentials from headers
const getUserFromHeaders = (req) => {
  const userAuthHeader = req.headers['x-user-auth'];
  const userEnvironment = req.headers['x-user-environment'] || '110';
  if (!userAuthHeader) throw new Error('User credentials required');

  let username, password;
  try {
    const decoded = Buffer.from(userAuthHeader, 'base64').toString();
    [username, password] = decoded.split(':');
    if (!username || !password) throw new Error();
  } catch {
    throw new Error('Invalid user credentials');
  }
  return { username, password, environment: userEnvironment };
};

router.get('/metadata', async (req, res) => {
  try {
    const { username, password, environment } = getUserFromHeaders(req);
    const migoClient = new MigoClient(username, password, environment);
    const response = await migoClient.client.get('/$metadata', {
      params: { 'sap-client': environment },
      headers: { 'Accept': 'application/xml' },
      responseType: 'text',
      httpsAgent: httpsAgent
    });
    res.type('application/xml').send(response.data);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// OPTIONS preflight for MIGO check
router.options('/check', (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-User-Auth, X-User-Environment");
  res.status(200).send();
});

// Validate transfer (test run)
router.post('/check', async (req, res) => {
  console.log('=== MIGO CHECK ROUTE CALLED ===');
  try {
    console.log('Raw request body headers:', Object.keys(req.headers));
    console.log('Raw request body:', req.body);
    console.log('Received check request with body:', JSON.stringify(req.body, null, 2));

    console.log('Calling getUserFromHeaders...');
    const { username, password, environment } = getUserFromHeaders(req);
    console.log('Got credentials for user:', username, 'environment:', environment);

    // Normalize environment (dev/110 are same, prd/300 are same)
    const normalizedEnv = normalizeEnvironment(environment);
    const clientMap = { dev: '110', prd: '300' };
    const sapClient = clientMap[normalizedEnv] || normalizedEnv;
    console.log('MIGO check - environment:', environment, 'normalized:', normalizedEnv, 'sap-client:', sapClient);

    const hasTransferItemSet = Array.isArray(req.body.TransferItemSet) && req.body.TransferItemSet.length > 0;

    if (hasTransferItemSet) {
      const invalidItems = req.body.TransferItemSet
        .map((item, index) => {
          const itemRequiredFields = [
            'Material',
            'Plant',
            'StgeLoc',
            'Quantity',
            'EntryUom',
            'Batch',
            'SalesOrder',
            'SoItem',
            'SpecStock',
            'StgeLocTo',
            'BatchTo',
            'MoveType'
          ];
          const missing = itemRequiredFields.filter(field => !item[field]);
          return missing.length > 0 ? `Item ${index + 1} missing: ${missing.join(', ')}` : null;
        })
        .filter(Boolean);

      if (invalidItems.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Invalid items: ${invalidItems.join('; ')}`
        });
      }
    } else {
      const requiredFields = [
        'salesOrder',
        'salesOrderItem',
        'movementType',
        'storageLocationTo',
        'specialStock',
        'MATNR',
        'Werks',
        'LGORT',
        'QTY',
        'MEINS',
        'Charg'
      ];

      const missingFields = requiredFields.filter(field => !req.body[field]);

      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Missing required fields: ${missingFields.join(', ')}`
        });
      }
    }

    // Use different endpoints based on environment (normalized: dev/110 use dev, prd/300 use prd)
    const isProduction = normalizedEnv === 'prd';
    let response;
    
    if (isProduction) {
      // Production: Use API Management endpoints
      const csrfUrl = PRD_MIGO_CSRF_URL;
      const postUrl = PRD_MIGO_POST_URL;
      
      console.log('Using production MIGO endpoints - CSRF:', csrfUrl, 'POST:', postUrl);
      
      // Fetch CSRF token from SAP API Management Gateway
      let csrfResponse;
      try {
        console.log('Attempting HEAD request to fetch CSRF token from:', csrfUrl);
        csrfResponse = await axios.head(csrfUrl, {
          httpsAgent: httpsAgent,
          auth: { username, password },
          headers: {
            'X-CSRF-Token': 'Fetch',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          validateStatus: () => true,
          timeout: 30000
        });
        console.log('HEAD request successful, status:', csrfResponse.status);
      } catch (headError) {
        console.log('HEAD request failed, trying GET for CSRF token. Error:', headError.message);
        csrfResponse = await axios.get(csrfUrl, {
          httpsAgent: httpsAgent,
          auth: { username, password },
          headers: {
            'X-CSRF-Token': 'Fetch',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          validateStatus: () => true,
          timeout: 30000
        });
        console.log('GET request successful, status:', csrfResponse.status);
      }

      const csrfToken = csrfResponse.headers['x-csrf-token'];
      const setCookieHeaders = csrfResponse.headers['set-cookie'];
      let cookies = '';
      if (setCookieHeaders) {
        const cookieArray = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
        cookies = cookieArray.map(c => c.split(';')[0]).join('; ');
      }

      if (!csrfToken) {
        console.error('CSRF token fetch failed. Status:', csrfResponse.status);
        return res.status(400).json({ 
          success: false, 
          error: "No CSRF token returned by SAP API Management",
          details: `Status: ${csrfResponse.status}`
        });
      }
      
      console.log('CSRF token retrieved successfully');

      // Use SAP API Management Gateway with CSRF token
      response = await axios.post(postUrl, req.body, {
        httpsAgent: httpsAgent,
        auth: { username, password },
        headers: {
          'X-CSRF-Token': csrfToken,
          'Cookie': cookies,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        validateStatus: () => true,
        timeout: 30000
      });
    } else {
      // Development: Try API Management first, fallback to direct SAP connection
      console.log('Using development environment - trying API Management first');
      const csrfUrl = DEV_MIGO_CSRF_URL;
      const postUrl = DEV_MIGO_POST_URL;
      
      console.log('Attempting API Management endpoints - CSRF:', csrfUrl, 'POST:', postUrl);
      
      try {
        // Try to fetch CSRF token from API Management
        let csrfResponse;
        try {
          csrfResponse = await axios.head(csrfUrl, {
            httpsAgent: httpsAgent,
            auth: { username, password },
            headers: {
              'X-CSRF-Token': 'Fetch',
              'Accept': 'application/json',
              'X-Requested-With': 'XMLHttpRequest'
            },
            validateStatus: () => true,
            timeout: 10000 // Shorter timeout for dev
          });
        } catch (headError) {
          csrfResponse = await axios.get(csrfUrl, {
            httpsAgent: httpsAgent,
            auth: { username, password },
            headers: {
              'X-CSRF-Token': 'Fetch',
              'Accept': 'application/json',
              'X-Requested-With': 'XMLHttpRequest'
            },
            validateStatus: () => true,
            timeout: 10000
          });
        }

        const csrfToken = csrfResponse.headers['x-csrf-token'];
        if (csrfToken && csrfResponse.status < 400) {
          // API Management works, use it
          console.log('API Management CSRF token retrieved, using API Management');
          const setCookieHeaders = csrfResponse.headers['set-cookie'];
          let cookies = '';
          if (setCookieHeaders) {
            const cookieArray = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
            cookies = cookieArray.map(c => c.split(';')[0]).join('; ');
          }

          response = await axios.post(postUrl, req.body, {
            httpsAgent: httpsAgent,
            auth: { username, password },
            headers: {
              'X-CSRF-Token': csrfToken,
              'Cookie': cookies,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'X-Requested-With': 'XMLHttpRequest'
            },
            validateStatus: () => true,
            timeout: 30000
          });
        } else {
          throw new Error('API Management CSRF token not available');
        }
      } catch (apiMgmtError) {
        // Fallback to direct SAP connection using MigoClient
        console.log('API Management failed, falling back to direct SAP connection');
        console.log('API Management error:', apiMgmtError.message);
        
        const migoClient = new MigoClient({ username, password, environment });
        
        // Get CSRF token from direct SAP
        const csrfResponse = await axios.get(`${migoClient.baseUrl}${migoClient.servicePath}/TransferHeaderSet`, {
          httpsAgent: migoClient.httpsAgent,
          auth: migoClient.auth,
          params: { 'sap-client': migoClient.sapClient },
          headers: {
            'X-CSRF-Token': 'Fetch',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          validateStatus: () => true
        });

        const csrfToken = csrfResponse.headers['x-csrf-token'];
        const setCookie = csrfResponse.headers['set-cookie'];
        if (!csrfToken) {
          return res.status(400).json({ success: false, error: "No CSRF token returned by SAP" });
        }

        const cookies = Array.isArray(setCookie) ? setCookie.map(c => c.split(';')[0]).join('; ') : setCookie;

        // Post with CSRF token to direct SAP
        response = await axios.post(`${migoClient.baseUrl}${migoClient.servicePath}/TransferHeaderSet`, req.body, {
          httpsAgent: migoClient.httpsAgent,
          auth: migoClient.auth,
          params: { 'sap-client': migoClient.sapClient },
          headers: {
            'X-CSRF-Token': csrfToken,
            'Cookie': cookies,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          validateStatus: () => true,
          timeout: 30000
        });
      }
    }

    console.log('SAP API Management MIGO check response status:', response.status);
    console.log('SAP API Management MIGO check response data:', JSON.stringify(response.data, null, 2));
    
    // Set CORS headers
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-User-Auth, X-User-Environment");
    
    // Handle error responses
    if (response.status >= 400) {
      const errorMessage = response.data?.error?.message?.value || 
                          response.data?.error?.message || 
                          response.data?.message ||
                          `SAP API returned status ${response.status}`;
      return res.status(response.status).json({ 
        success: false, 
        error: errorMessage,
        raw: response.data
      });
    }
    
    // Normalize response for frontend - handle different response formats
    const normalized = {
      success: response.data?.d?.Success === true || response.data?.Success === true || response.status === 200,
      message: response.data?.d?.Message || response.data?.Message || 'Check completed',
      data: {
        materialDocument: response.data?.d?.MatDoc || response.data?.MatDoc || null,
        documentYear: response.data?.d?.MatDocYear || response.data?.MatDocYear || null,
        raw: response.data
      }
    };
    res.json(normalized);
  } catch (error) {
    console.error('=== MIGO CHECK ERROR CAUGHT ===');
    console.error('Check error:', error);
    console.error('Error name:', error?.name);
    console.error('Error message:', error?.message);
    console.error('Error stack:', error?.stack);
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      response: error?.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        headers: error.response.headers
      } : null
    });
    
    // Set CORS headers even on error
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-User-Auth, X-User-Environment");
    
    if (error?.message?.includes('User credentials required') || error?.message?.includes('Invalid user credentials')) {
      console.error('Returning 401 for authentication error');
      return res.status(401).json({ success: false, error: error.message });
    }
    
    // Return more detailed error information
    const errorMessage = error?.response?.data?.error?.message || 
                         error?.response?.data?.message || 
                         error?.message || 
                         'Unknown error occurred';
    console.error('Returning 500 error with message:', errorMessage);
    res.status(error?.response?.status || 500).json({ 
      success: false, 
      error: errorMessage,
      details: error?.response?.data || error?.message,
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    });
  }
});

// OPTIONS preflight for MIGO post
router.options('/post', (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-User-Auth, X-User-Environment");
  res.status(200).send();
});

// Execute transfer
router.post('/post', async (req, res) => {
  try {
    console.log('Received post request with body:', JSON.stringify(req.body, null, 2));

    const { username, password, environment } = getUserFromHeaders(req);

    // Normalize environment (dev/110 are same, prd/300 are same)
    const normalizedEnv = normalizeEnvironment(environment);
    const clientMap = { dev: '110', prd: '300' };
    const sapClient = clientMap[normalizedEnv] || normalizedEnv;
    console.log('MIGO post - environment:', environment, 'normalized:', normalizedEnv, 'sap-client:', sapClient);

    const hasTransferItemSet = Array.isArray(req.body.TransferItemSet) && req.body.TransferItemSet.length > 0;

    if (hasTransferItemSet) {
      const invalidItems = req.body.TransferItemSet
        .map((item, index) => {
          const itemRequiredFields = [
            'Material',
            'Plant',
            'StgeLoc',
            'Quantity',
            'EntryUom',
            'Batch',
            'SalesOrder',
            'SoItem',
            'SpecStock',
            'StgeLocTo',
            'BatchTo',
            'MoveType'
          ];
          const missing = itemRequiredFields.filter(field => !item[field]);
          return missing.length > 0 ? `Item ${index + 1} missing: ${missing.join(', ')}` : null;
        })
        .filter(Boolean);

      if (invalidItems.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Invalid items: ${invalidItems.join('; ')}`
        });
      }
    } else {
      const requiredFields = [
        'salesOrder',
        'salesOrderItem',
        'movementType',
        'storageLocationTo',
        'specialStock',
        'MATNR',
        'Werks',
        'LGORT',
        'QTY',
        'MEINS',
        'Charg'
      ];

      const missingFields = requiredFields.filter(field => !req.body[field]);

      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Missing required fields: ${missingFields.join(', ')}`
        });
      }
    }

    let response;
    
    // Use API Management endpoints (normalized: dev/110 use dev, prd/300 use prd)
    const isProduction = normalizedEnv === 'prd';
    
    if (isProduction) {
      // Use production API Management endpoints
      const csrfUrl = PRD_MIGO_CSRF_URL;
      const postUrl = PRD_MIGO_POST_URL;
      
      console.log('Using production MIGO endpoints - CSRF:', csrfUrl, 'POST:', postUrl);
      
      // Get CSRF token first - Try HEAD first, then GET if HEAD fails
      let csrfResponse;
      try {
        csrfResponse = await axios.head(csrfUrl, {
          httpsAgent: httpsAgent,
          auth: {
            username,
            password
          },
          headers: {
            'X-CSRF-Token': 'Fetch',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          validateStatus: () => true,
          timeout: 30000
        });
      } catch (headError) {
        console.log('HEAD request failed, trying GET for CSRF token');
        csrfResponse = await axios.get(csrfUrl, {
          httpsAgent: httpsAgent,
          auth: {
            username,
            password
          },
          headers: {
            'X-CSRF-Token': 'Fetch',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          validateStatus: () => true,
          timeout: 30000
        });
      }

      const csrfToken = csrfResponse.headers['x-csrf-token'];
      const setCookieHeaders = csrfResponse.headers['set-cookie'];
      let cookies = '';
      if (setCookieHeaders) {
        const cookieArray = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
        cookies = cookieArray.map(c => c.split(';')[0]).join('; ');
      }

      if (!csrfToken) {
        console.error('CSRF token fetch failed. Status:', csrfResponse.status);
        console.error('Response status text:', csrfResponse.statusText);
        console.error('Response headers:', JSON.stringify(csrfResponse.headers, null, 2));
        console.error('Response data:', csrfResponse.data);
        return res.status(400).json({ 
          success: false, 
          error: "No CSRF token returned by SAP API Management",
          details: `Status: ${csrfResponse.status}, Response: ${JSON.stringify(csrfResponse.data)}`
        });
      }
      
      console.log('CSRF token retrieved successfully:', csrfToken.substring(0, 20) + '...');

      // Post with CSRF token
      response = await axios.post(postUrl, req.body, {
        httpsAgent: httpsAgent,
        auth: {
          username,
          password
        },
        headers: {
          'X-CSRF-Token': csrfToken,
          'Cookie': cookies,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        validateStatus: () => true,
        timeout: 30000
      });
    } else {
      // Use development API Management endpoints
      const csrfUrl = DEV_MIGO_CSRF_URL;
      const postUrl = DEV_MIGO_POST_URL;
      
      console.log('Using development MIGO endpoints - CSRF:', csrfUrl, 'POST:', postUrl);
      
      // Get CSRF token first - Try HEAD first, then GET if HEAD fails
      let csrfResponse;
      try {
        csrfResponse = await axios.head(csrfUrl, {
          httpsAgent: httpsAgent,
          auth: {
            username,
            password
          },
          headers: {
            'X-CSRF-Token': 'Fetch',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          validateStatus: () => true,
          timeout: 30000
        });
      } catch (headError) {
        console.log('HEAD request failed, trying GET for CSRF token');
        csrfResponse = await axios.get(csrfUrl, {
          httpsAgent: httpsAgent,
          auth: {
            username,
            password
          },
          headers: {
            'X-CSRF-Token': 'Fetch',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          validateStatus: () => true,
          timeout: 30000
        });
      }

      const csrfToken = csrfResponse.headers['x-csrf-token'];
      const setCookieHeaders = csrfResponse.headers['set-cookie'];
      let cookies = '';
      if (setCookieHeaders) {
        const cookieArray = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
        cookies = cookieArray.map(c => c.split(';')[0]).join('; ');
      }

      if (!csrfToken) {
        console.error('CSRF token fetch failed. Status:', csrfResponse.status);
        console.error('Response status text:', csrfResponse.statusText);
        console.error('Response headers:', JSON.stringify(csrfResponse.headers, null, 2));
        console.error('Response data:', csrfResponse.data);
        return res.status(400).json({ 
          success: false, 
          error: "No CSRF token returned by SAP API Management",
          details: `Status: ${csrfResponse.status}, Response: ${JSON.stringify(csrfResponse.data)}`
        });
      }
      
      console.log('CSRF token retrieved successfully:', csrfToken.substring(0, 20) + '...');

      // Use SAP API Management Gateway with CSRF token
      response = await axios.post(postUrl, req.body, {
        httpsAgent: httpsAgent,
        auth: {
          username,
          password
        },
        headers: {
          'X-CSRF-Token': csrfToken,
          'Cookie': cookies,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        validateStatus: () => true,
        timeout: 30000
      });
    }

    console.log('MIGO post response status:', response.status);
    console.log('MIGO post response data:', JSON.stringify(response.data, null, 2));
    
    // Set CORS headers
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-User-Auth, X-User-Environment");
    
    // Handle error responses
    if (response.status >= 400) {
      const errorMessage = response.data?.error?.message?.value || 
                          response.data?.error?.message || 
                          response.data?.message ||
                          `SAP API returned status ${response.status}`;
      return res.status(response.status).json({ 
        success: false, 
        error: errorMessage,
        raw: response.data
      });
    }
    
    // Normalize response for frontend - handle different response formats
    const normalized = {
      success: response.data?.d?.Success === true || response.data?.Success === true || response.status === 200,
      message: response.data?.d?.Message || response.data?.Message || 'Post completed',
      data: {
        materialDocument: response.data?.d?.MatDoc || response.data?.MatDoc || null,
        documentYear: response.data?.d?.MatDocYear || response.data?.MatDocYear || null,
        raw: response.data
      }
    };
    res.json(normalized);
  } catch (error) {
    console.error('Post error:', error);
    if (error.message.includes('User credentials required') || error.message.includes('Invalid user credentials')) {
      return res.status(401).json({ success: false, error: error.message });
    }
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// SAP API Management Gateway MIGO Routes

// Get CSRF token from SAP API Management gateway
router.get('/gateway/csrf', async (req, res) => {
  if (!SAP_API_MGMT_URL) {
    return res.status(500).json({ success: false, error: "SAP API Management URL not configured" });
  }

  try {
    const { username, password, environment } = getUserFromHeaders(req);
    const response = await axios.get(`${SAP_API_MGMT_MIGO_URL}/`, {
      auth: {
        username,
        password
      },
      headers: {
        'X-CSRF-Token': 'Fetch',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      validateStatus: () => true,
      timeout: 30000
    });

    const token = response.headers['x-csrf-token'];
    const setCookie = response.headers['set-cookie'];

    if (!token) {
      return res.status(400).json({ success: false, error: "No X-CSRF-Token returned by SAP API Management" });
    }

    const cookies = Array.isArray(setCookie) ? setCookie.map(c => c.split(';')[0]).join('; ') : setCookie;

    res.json({ 
      success: true, 
      csrfToken: token,
      cookies: cookies
    });

  } catch (err) {
    console.error("SAP API Management CSRF fetch error:", err.message);
    res.status(500).json({ 
      success: false, 
      error: "Failed to retrieve CSRF token from SAP API Management" 
    });
  }
});

// Post transfer to SAP API Management gateway
router.post('/gateway/post', async (req, res) => {
  if (!SAP_API_MGMT_URL) {
    return res.status(500).json({ success: false, error: "SAP API Management URL not configured" });
  }

  try {
    const { csrfToken, cookies, transferData, isTestRun = false } = req.body;
    const { username, password, environment } = getUserFromHeaders(req);

    if (!csrfToken) {
      return res.status(400).json({ success: false, error: "CSRF token is required" });
    }

    if (!transferData) {
      return res.status(400).json({ success: false, error: "Transfer data is required" });
    }

    console.log('Posting to SAP API Management gateway:', JSON.stringify(transferData, null, 2));

    const response = await axios.post(`${SAP_API_MGMT_MIGO_POST_URL}`, transferData, {
      auth: {
        username,
        password
      },
      headers: {
        'X-CSRF-Token': csrfToken,
        'Cookie': cookies,
        'Accept': 'application/xml',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      responseType: 'text',
      validateStatus: (status) => status < 600,
      timeout: 30000
    });

    console.log('SAP API Management Response Status:', response.status);
    console.log('Raw Response:', response.data);

    // Check if response is HTML (error page) instead of XML
    if (response.data && typeof response.data === 'string') {
      if (response.data.trim().startsWith('<!DOCTYPE') || response.data.trim().startsWith('<html')) {
        return res.json({ success: false, error: 'SAP API Management returned HTML error page' });
      }
      
      if (!response.data.trim().startsWith('<?xml')) {
        return res.json({ success: false, error: response.data.trim() });
      }
    }

    // Parse XML response (reuse existing logic from migoClient)
    const { parseStringPromise } = require('xml2js');
    const result = await parseStringPromise(response.data, {
      explicitArray: false,
      mergeAttrs: true
    });

    console.log('Parsed XML Response:', JSON.stringify(result, null, 2));

    // Check for error response
    if (result.error) {
      const errorMessage = result.error.message?._ || 
                         result.error.message || 
                         result.error['message'] || 
                         'Unknown SAP error';
      return res.json({ success: false, error: errorMessage });
    }

    // Check for success response
    const properties = result?.entry?.content?.['m:properties'] || result?.content?.['m:properties'] || result?.['m:properties'];
    if (!properties) {
      return res.json({ 
        success: true, 
        message: 'Operation completed successfully', 
        data: { materialDocument: null, documentYear: null } 
      });
    }

    const rawSuccess = properties['d:Success'] ?? properties['d:EvSuccess'];
    const success = rawSuccess === 'true' || rawSuccess === true;
    const message = properties['d:Message'] || properties['d:EvMessage'] || (success ? 'Operation completed successfully' : 'Operation failed');
    const matDoc = properties['d:MatDoc'] || properties['d:EvMatDoc'];
    const matDocYear = properties['d:MatDocYear'] || properties['d:EvMatDocYear'];

    res.json({ success, message, data: { materialDocument: matDoc, documentYear: matDocYear } });

  } catch (err) {
    console.error("SAP API Management post error:", err.message);
    console.error("Error details:", {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data
    });
    
    res.status(500).json({ 
      success: false, 
      error: err.message || "Failed to post to SAP API Management" 
    });
  }
});

module.exports = router;