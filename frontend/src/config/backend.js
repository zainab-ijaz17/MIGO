// Backend API configuration with fallback mechanism
// Primary: Render backend (tries first)
// Fallback: Local backend (used if primary fails)

export const PRIMARY_BACKEND_URL = "https://sap-app-maoe.onrender.com";
export const FALLBACK_BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";
// For specific local IP, set environment variable or change above:
// export const FALLBACK_BACKEND_URL = "http://192.168.60.97:5000";

// Helper function to get endpoints for a given base URL
const getEndpoints = (baseUrl) => ({
  auth: `${baseUrl}/api/auth`,
  batchInfo: `${baseUrl}/api/BatchInfo`,
  migo: {
    check: `${baseUrl}/api/migo/check`,
    post: `${baseUrl}/api/migo/post`
  }
});

// Primary endpoints (Render)
export const PRIMARY_ENDPOINTS = getEndpoints(PRIMARY_BACKEND_URL);

// Fallback endpoints (Local)
export const FALLBACK_ENDPOINTS = getEndpoints(FALLBACK_BACKEND_URL);

// Default to primary (will fallback automatically on failure)
export const API_ENDPOINTS = PRIMARY_ENDPOINTS;