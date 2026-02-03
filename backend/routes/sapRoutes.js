// utils/sapRoutes.js
const express = require("express");
const axios = require("axios");
const https = require("https");

const router = express.Router();

// SAP API Management gateway configuration (primary)
const SAP_API_MGMT_URL = process.env.SAP_API_MGMT_URL; // e.g., https://devspace.test.apimanagement.eu10.hana.ondemand.com
const SAP_API_MGMT_BATCH_URL = process.env.SAP_API_MGMT_BATCH_URL; // e.g., https://devspace.test.apimanagement.eu10.hana.ondemand.com/bsp/batch
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

  if (!SAP_API_MGMT_URL) {
    return res.status(500).json({ error: "SAP API Management URL not configured" });
  }

  console.log(`Fetching batch info from gateway for: ${batchNumber}`);
  console.log(`SAP_API_MGMT_URL: ${SAP_API_MGMT_URL}`);

  try {
    const url = `${SAP_API_MGMT_BATCH_URL}/BatchInfoSet?$filter=Charg eq '${batchNumber}'&$format=json`;
    console.log(`Full Gateway URL: ${url}`);

    const response = await axios.get(url, {
      auth: {
        username: SAP_USER,
        password: SAP_PASS
      }, // Basic Auth for SAP API Management
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest"
      },
      validateStatus: () => true, // handle status manually
      timeout: 30000 // 30 second timeout
    });

    if (response.status === 401) {
      return res.status(401).json({ error: "Unauthorized. Check SAP API Management credentials." });
    }

    if (response.status !== 200) {
      return res.status(response.status).json({
        error: "Error fetching batch info from SAP API Management",
        data: response.data
      });
    }

    // Handle OData filter response - check if we have results
    const batchData = response.data?.d?.results;
    if (!batchData || batchData.length === 0) {
      return res.status(404).json({ error: "Batch not found" });
    }

    // Return the first batch from the filtered results
    res.json(batchData[0]);

  } catch (err) {
    console.error("SAP API Management batch fetch error:", err.message);
    console.error("Error details:", {
      message: err.message,
      code: err.code,
      status: err.response?.status,
      statusText: err.response?.statusText,
      isTimeout: err.code === 'ECONNABORTED'
    });
    
    if (err.code === 'ECONNABORTED') {
      return res.status(408).json({ error: "Request timeout - SAP API Management server is not responding", details: err.message });
    }
    
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

module.exports = router;