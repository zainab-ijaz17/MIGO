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
const SAP_USER = process.env.SAP_USER;
const SAP_PASS = process.env.SAP_PASS;

// Ignore SSL certificate errors (for dev/self-signed SSL)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

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

// Validate transfer (test run)
router.post('/check', async (req, res) => {
  try {
    console.log('Raw request body headers:', Object.keys(req.headers));
    console.log('Raw request body:', req.body);
    console.log('Received check request with body:', JSON.stringify(req.body, null, 2));

    const { username, password, environment } = getUserFromHeaders(req);

    // Use SAP API Management Gateway for MIGO
    const clientMap = { dev: '110', prd: '300' };
    const sapClient = clientMap[environment] || environment;
    console.log('MIGO check - mapped sap-client:', sapClient);

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

    // Fetch CSRF token from SAP API Management Gateway
    const csrfResponse = await axios.get(`${SAP_API_MGMT_MIGO_URL}/`, {
      auth: {
        username,
        password
      },
      headers: {
        'X-CSRF-Token': 'Fetch',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      params: { 'sap-client': sapClient },
      timeout: 30000
    });

    const csrfToken = csrfResponse.headers['x-csrf-token'];
    const cookies = Array.isArray(csrfResponse.headers['set-cookie']) 
      ? csrfResponse.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') 
      : csrfResponse.headers['set-cookie'];

    if (!csrfToken) {
      return res.status(400).json({ success: false, error: "No CSRF token returned by SAP API Management" });
    }

    // Use SAP API Management Gateway with CSRF token
    const response = await axios.post(`${SAP_API_MGMT_MIGO_POST_URL}`, req.body, {
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
      params: { 'sap-client': sapClient },
      timeout: 30000
    });

    console.log('SAP API Management MIGO check response:', response.data);
    // Normalize response for frontend
    const normalized = {
      success: response.data?.d?.Success === true,
      message: response.data?.d?.Message || 'Check completed',
      data: {
        materialDocument: response.data?.d?.MatDoc || null,
        documentYear: response.data?.d?.MatDocYear || null,
        raw: response.data
      }
    };
    res.json(normalized);
  } catch (error) {
    console.error('Check error:', error);
    if (error.message.includes('User credentials required') || error.message.includes('Invalid user credentials')) {
      return res.status(401).json({ success: false, error: error.message });
    }
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Execute transfer
router.post('/post', async (req, res) => {
  try {
    console.log('Received post request with body:', JSON.stringify(req.body, null, 2));

    const { username, password, environment } = getUserFromHeaders(req);

    // Use SAP API Management Gateway for MIGO if available, otherwise use direct connection
    const clientMap = { dev: '110', prd: '300' };
    const sapClient = clientMap[environment] || environment;
    console.log('MIGO post - mapped sap-client:', sapClient);

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
    
    // Force direct connection for environment 300 with CSRF, use gateway for others
    if (environment === '300' || environment === 'prd') {
      // Use direct SAP connection with MigoClient for environment 300 with CSRF
      const migoClient = new MigoClient({ username, password, environment });
      
      // Get CSRF token first
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

      // Post with CSRF token
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
        timeout: 30000
      });
    } else if (SAP_API_MGMT_URL) {
      // Use SAP API Management Gateway for other environments
      const csrfResponse = await axios.get(`${SAP_API_MGMT_MIGO_URL}/`, {
        auth: {
          username,
          password
        },
        headers: {
          'X-CSRF-Token': 'Fetch',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        params: { 'sap-client': sapClient },
        timeout: 30000
      });

      const csrfToken = csrfResponse.headers['x-csrf-token'];
      const cookies = Array.isArray(csrfResponse.headers['set-cookie']) 
        ? csrfResponse.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') 
        : csrfResponse.headers['set-cookie'];

      if (!csrfToken) {
        return res.status(400).json({ success: false, error: "No CSRF token returned by SAP API Management" });
      }

      // Use SAP API Management Gateway with CSRF token
      response = await axios.post(`${SAP_API_MGMT_MIGO_POST_URL}`, req.body, {
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
        params: { 'sap-client': sapClient },
        timeout: 30000,
        responseType: 'json' // Add responseType: 'json' to the axios options
      });
    } else {
      // Fallback to direct connection if no gateway configured
      const migoClient = new MigoClient({ username, password, environment });
      response = await axios.post(`${migoClient.baseUrl}${migoClient.servicePath}/TransferHeaderSet`, req.body, {
        httpsAgent: migoClient.httpsAgent,
        auth: migoClient.auth,
        params: { 'sap-client': migoClient.sapClient },
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        timeout: 30000
      });
    }

    console.log('MIGO post response:', response.data);
    // Normalize response for frontend
    const normalized = {
      success: response.data?.d?.Success === true,
      message: response.data?.d?.Message || 'Post completed',
      data: {
        materialDocument: response.data?.d?.MatDoc || null,
        documentYear: response.data?.d?.MatDocYear || null,
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