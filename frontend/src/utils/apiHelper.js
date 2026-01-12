// API helper with automatic fallback mechanism
// Tries primary backend (Render) first, falls back to local if it fails

import { PRIMARY_ENDPOINTS, FALLBACK_ENDPOINTS } from '../config/backend';

/**
 * Check if an error should trigger fallback to local backend
 */
const shouldFallback = (error) => {
  // Network errors, timeouts, or 408 status
  if (!error.response) {
    return true; // Network error, connection refused, timeout
  }
  
  const status = error.response?.status;
  // Timeout or server errors that suggest backend is unavailable
  if (status === 408 || status === 504 || status === 503 || status >= 500) {
    return true;
  }
  
  return false;
};

/**
 * Make API request with automatic fallback
 * @param {Function} requestFn - Function that makes the request (receives endpoints object)
 * @param {string} endpointType - Type of endpoint ('auth', 'batchInfo', 'migo.check', 'migo.post')
 * @returns {Promise} - Response from successful request
 */
export const requestWithFallback = async (requestFn, endpointType = 'primary') => {
  let lastError = null;
  
  // Try primary backend first (Render)
  try {
    console.log(`Attempting request with primary backend (Render)...`);
    const result = await requestFn(PRIMARY_ENDPOINTS);
    console.log(`Request successful with primary backend`);
    return result;
  } catch (error) {
    console.warn(`Primary backend failed:`, error.message);
    lastError = error;
    
    // Check if we should fallback
    if (shouldFallback(error)) {
      console.log(`Falling back to local backend...`);
      
      // Try fallback backend (Local)
      try {
        const result = await requestFn(FALLBACK_ENDPOINTS);
        console.log(`Request successful with fallback backend`);
        return result;
      } catch (fallbackError) {
        console.error(`Fallback backend also failed:`, fallbackError.message);
        // Throw the original error if fallback also fails
        throw lastError;
      }
    } else {
      // Don't fallback for client errors (4xx except 408)
      throw error;
    }
  }
};
