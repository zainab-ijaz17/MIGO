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

// Ignore SSL certificate errors (for dev/self-signed SSL)
// Enable keepAlive for connection reuse - faster subsequent requests
const httpsAgent = new https.Agent({ 
  rejectUnauthorized: false,
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 30000 // Match Render's 30s limit
});

// GET batch info by batch number
router.get("/BatchInfo/:batchNumber", async (req, res) => {
  const { batchNumber } = req.params;
  if (!batchNumber) return res.status(400).json({ error: "Batch number is required" });

  console.log(`Fetching batch info for: ${batchNumber}`);
  console.log(`SAP_BASE_URL: ${SAP_BASE_URL}`);
  console.log(`BSP_SERVICE_PATH: ${BSP_SERVICE_PATH}`);
  console.log(`SAP_USER configured: ${!!SAP_USER}`);
  console.log(`SAP_PASS configured: ${!!SAP_PASS}`);

  try {
    const url = `${SAP_BASE_URL}${BSP_SERVICE_PATH}/BatchInfoSet?$filter=Charg eq '${batchNumber}'&$format=json&sap-client=110`;
    console.log(`Full URL: ${url}`);
    console.log(`Starting request at: ${new Date().toISOString()}`);

    // Retry mechanism for SAP API calls
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Attempt ${attempt} of 3`);

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
          timeout: 90000 // 90 second timeout
        });

        console.log(`Response received at: ${new Date().toISOString()}`);
        console.log(`Response status: ${response.status}`);
        console.log(`Response data keys: ${Object.keys(response.data || {})}`);

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
        console.log(`Successfully fetched batch on attempt ${attempt}`);
        return res.json(batchData[0]);

      } catch (err) {
        lastError = err;
        console.log(`Attempt ${attempt} failed: ${err.message}`);

        if (attempt < 3 && err.code === 'ECONNABORTED') {
          console.log(`Retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          throw err;
        }
      }
    }

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
      return res.status(408).json({ 
        error: "Request timeout - SAP server is not responding within 30 seconds", 
        details: err.message,
        note: "Render free tier has a 30-second timeout limit. Ensure SAP server whitelists Render outbound IPs (74.220.51.0/24, 74.220.59.0/24) and is accessible from Render's network."
      });
    }
    
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

module.exports = router;
