const axios = require('axios');
const https = require('https');
const { parseStringPromise } = require('xml2js');
require('dotenv').config();

const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // Only for development
  keepAlive: true
});

class MigoClient {
  constructor() {
    this.csrfToken = null;
    this.cookies = null;
    
    // Use same approach as BSP - direct axios calls
    this.baseUrl = process.env.SAP_BASE_URL;
    this.servicePath = process.env.SAP_SERVICE_PATH;
    
    const username = process.env.SAP_USER;
    const password = process.env.SAP_PASS;

    if (!username || !password) {
      throw new Error('Missing SAP credentials: set SAP_USER/SAP_PASS in backend/.env');
    }

    this.auth = {
      username: username,
      password: password
    };
    
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: false, // Only for development
      keepAlive: true
    });
  }

  async getCsrfToken() {
    try {
      // Fetch CSRF from same entity as POST - using same approach as BSP
      const response = await axios.get(`${this.baseUrl}${this.servicePath}/TransferHeaderSet`, {
        httpsAgent: this.httpsAgent,
        auth: this.auth,
        params: { 'sap-client': '110' },
        headers: {
          'X-CSRF-Token': 'Fetch',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        validateStatus: () => true // handle status manually
      });

      const token = response.headers['x-csrf-token'];
      const setCookie = response.headers['set-cookie'];

      if (!token) {
        throw new Error('No X-CSRF-Token returned by SAP');
      }

      this.csrfToken = token;
      this.cookies = Array.isArray(setCookie) ? setCookie.map(c => c.split(';')[0]).join('; ') : setCookie;

      console.log('CSRF token fetched successfully:', token);
      return { success: true, csrfToken: token };
    } catch (error) {
      console.error('CSRF Token Error:', {
        message: error.message,
        status: error.response?.status,
        contentType: error.response?.headers?.['content-type'],
        preview: typeof error.response?.data === 'string' ? error.response.data.slice(0, 300) : error.response?.data
      });
      return { success: false, error: 'Failed to retrieve CSRF token' };
    }
  }

  async executeTransfer(transferData, isTestRun = false) {
    try {
      // Always fetch fresh CSRF token for each request
      const tokenResult = await this.getCsrfToken();
      if (!tokenResult.success) {
        throw new Error('Failed to get CSRF token');
      }

      const payload = this.formatPayload(transferData, isTestRun);
      console.log('Sending to SAP OData:', JSON.stringify(payload, null, 2));

      const response = await axios.post(`${this.baseUrl}${this.servicePath}/TransferHeaderSet`, payload, {
        httpsAgent: this.httpsAgent,
        auth: this.auth,
        params: { 'sap-client': '110' },
        headers: {
          'X-CSRF-Token': this.csrfToken,
          'Cookie': this.cookies,
          'Accept': 'application/xml',
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        responseType: 'text',
        validateStatus: (status) => {
          // Accept 2xx, 4xx, and 5xx responses - we'll handle them manually
          return status < 600;
        }
      });

      console.log('Raw SAP OData Response:', response.data);
      console.log('Response Status:', response.status);
      console.log('Response Headers:', response.headers);

      // Check if response is HTML (error page) instead of XML
      if (response.data && typeof response.data === 'string') {
        if (response.data.trim().startsWith('<!DOCTYPE') || response.data.trim().startsWith('<html')) {
          return { success: false, error: 'SAP returned HTML error page - possible authentication or configuration issue' };
        }
        
        // Check if response starts with plain text error (like "CSRF token validation failed")
        if (!response.data.trim().startsWith('<?xml')) {
          return { success: false, error: response.data.trim() };
        }
      }

      return await this.parseSapResponse(response.data);

    } catch (error) {
      // Reset CSRF if 401/403 to allow refetch next time
      if (error.response?.status === 401 || error.response?.status === 403) {
        this.csrfToken = null;
        this.cookies = null;
      }

      console.error('MIGO OData Error:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });

      // Try to parse SAP error XML
      if (error.response?.data) {
        try {
          const errorResult = await parseStringPromise(error.response.data, {
            explicitArray: false,
            mergeAttrs: true
          });
          const errorMessage = errorResult?.['m:error']?.['m:message']?.['_'] ||
                               errorResult?.['error']?.['message']?.['_'] ||
                               'Unknown error from SAP';
          return { success: false, error: errorMessage };
        } catch (_) {}
      }

      return { success: false, error: error.message || 'Failed SAP request' };
    }
  }

  async parseSapResponse(xmlText) {
    try {
      const result = await parseStringPromise(xmlText, {
        explicitArray: false,
        mergeAttrs: true
      });

      console.log('Parsed XML Response:', JSON.stringify(result, null, 2));

      // Check for error response first
      if (result.error) {
        // Handle nested error message format
        const errorMessage = result.error.message?._ || 
                           result.error.message || 
                           result.error['message'] || 
                           'Unknown SAP error';
        return { success: false, error: errorMessage };
      }

      // Check for success response
      const properties = result?.entry?.content?.['m:properties'] || result?.content?.['m:properties'] || result?.['m:properties'];
      if (!properties) {
        // If no properties, check if it's a success response without data
        return { 
          success: true, 
          message: 'Operation completed successfully', 
          data: { materialDocument: null, documentYear: null } 
        };
      }

      const rawSuccess = properties['d:Success'] ?? properties['d:EvSuccess'];
      const success = rawSuccess === 'true' || rawSuccess === true;
      const message = properties['d:Message'] || properties['d:EvMessage'] || (success ? 'Operation completed successfully' : 'Operation failed');
      const matDoc = properties['d:MatDoc'] || properties['d:EvMatDoc'];
      const matDocYear = properties['d:MatDocYear'] || properties['d:EvMatDocYear'];

      return { success, message, data: { materialDocument: matDoc, documentYear: matDocYear } };
    } catch (error) {
      console.error('XML Parsing Error:', error.message);
      return { success: false, error: 'Failed to parse SAP response' };
    }
  }

  formatPayload(transferData, isTestRun) {
    const docDateMs = transferData.docDate ? new Date(transferData.docDate).getTime() : Date.now();
    const postingDateMs = transferData.postingDate ? new Date(transferData.postingDate).getTime() : Date.now();

    const salesOrder = transferData.salesOrder || '';
    const soItem = String(transferData.salesOrderItem || '').padStart(6, '0');
    const moveType = transferData.movementType; // Remove hardcoded fallback
    const specStock = transferData.specialStock || transferData.SOBKZ || 'E';
    const stgeLocTo = transferData.storageLocationTo || '';

    // Handle SalesOrderTo and SoItemTo - default to from values if not provided
    const salesOrderTo = transferData.salesOrderTo || salesOrder;
    const soItemTo = String(transferData.salesOrderItemTo || transferData.salesOrderItem || '').padStart(6, '0');

    const normalizeMaterial = mat => String(mat || '').padStart(18, '0');
    const normalizeItemNo = i => String(i + 1).padStart(6, '0');

    const itemsSource = Array.isArray(transferData.TransferItemSet) && transferData.TransferItemSet.length > 0
      ? transferData.TransferItemSet
      : Array.isArray(transferData.items) && transferData.items.length > 0
        ? transferData.items
        : [transferData]; // Single item fallback

    const TransferItemSet = itemsSource.map((item, index) => ({
      HeaderId: "1",
      ItemNo: normalizeItemNo(index),
      Material: normalizeMaterial(item.MATNR || item.Material),
      Plant: item.Werks || item.Plant || '',
      StgeLoc: item.LGORT || item.StgeLoc || '',
      Quantity: String(item.QTY || item.Quantity || '0'),
      EntryUom: item.MEINS || item.EntryUom || '',
      Batch: item.Charg || item.Batch || '',
      SalesOrder: salesOrder,
      SoItem: soItem,
      SpecStock: specStock,
      StgeLocTo: stgeLocTo,
      BatchTo: item.Charg || item.Batch || '',
      MoveType: moveType,
      SalesOrderTo: salesOrderTo,
      SoItemTo: soItemTo
    }));

    return {
      HeaderId: "1",
      DocDate: `/Date(${docDateMs})/`,
      PstngDate: `/Date(${postingDateMs})/`,
      TestRun: isTestRun,
      TransferItemSet
    };
  }
}

module.exports = new MigoClient();