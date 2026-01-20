// utils/sapRoutes.js
const express = require("express");
const axios = require("axios");
const https = require("https");

const router = express.Router();

// SAP credentials from environment variables
const SAP_USER = process.env.SAP_USER;
const SAP_PASS = process.env.SAP_PASS;
const SAP_BASE_URL = process.env.SAP_BASE_URL; // e.g., https://10.200.11.37:44300
const BSP_SERVICE_PATH = process.env.BSP_SERVICE_PATH; // e.g., /sap/opu/odata/sap/ZUM_BSP_BATCH_INFORMATION_SRV

// SAP API Management gateway configuration
const SAP_API_MGMT_URL = process.env.SAP_API_MGMT_URL; // e.g., https://devspace.test.apimanagement.eu10.hana.ondemand.com
const SAP_API_MGMT_BATCH_URL = process.env.SAP_API_MGMT_BATCH_URL; // e.g., https://devspace.test.apimanagement.eu10.hana.ondemand.com/bsp/batch
const SAP_API_MGMT_KEY = process.env.SAP_API_MGMT_KEY; // API key for SAP API Management

// Ignore SSL certificate errors (for dev/self-signed SSL)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// GET batch info by batch number
router.get("/BatchInfo/:batchNumber", async (req, res) => {
  const { batchNumber } = req.params;
  if (!batchNumber) return res.status(400).json({ error: "Batch number is required" });

  console.log(`Fetching batch info for: ${batchNumber}`);
  console.log(`SAP_BASE_URL: ${SAP_BASE_URL}`);
  console.log(`BSP_SERVICE_PATH: ${BSP_SERVICE_PATH}`);

  try {
    const url = `${SAP_BASE_URL}${BSP_SERVICE_PATH}/BatchInfoSet?$filter=Charg eq '${batchNumber}'&$format=json&sap-client=110`;
    console.log(`Full URL: ${url}`);

    const response = await axios.get(url, {
      httpsAgent,
      auth: {
        username: SAP_USER,
        password: SAP_PASS
      }, // Basic Auth
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest"
      },
      validateStatus: () => true, // handle status manually
      timeout: 30000 // 30 second timeout
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

    // Handle OData filter response - check if we have results
    const batchData = response.data?.d?.results;
    if (!batchData || batchData.length === 0) {
      return res.status(404).json({ error: "Batch not found" });
    }

    // Return the first batch from the filtered results
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