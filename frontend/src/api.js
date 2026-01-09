import axios from "axios";

// Use local backend with updated CORS
const API_BASE = "https://sap-app-maoe.onrender.com/api/auth";

// Create axios instance with CORS configuration
const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  withCredentials: false, // Set to true if server supports credentials
});

export const loginUser = async (username, password, environment) => {
  try {
    const response = await apiClient.post('/Login', {
      username,
      password,
      environment
    });

    const result = response.data?.["ns0:Z_WM_HANDHELD_LOGINResponse"];
    
    if (result?.E_TYPE === "S") {
      return {
        success: true,
        username,
        environment,
        token: btoa(`${username}:${password}`)  // Changed from Buffer to btoa
      };
    } else {
      throw new Error(result?.E_MESSAGE || "Authentication failed");
    }
  } catch (error) {
    console.error("Login failed:", error);
    console.error("Error details:", {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      headers: error.response?.headers
    });
    
    const errorMessage = error.response?.data?.["ns0:Z_WM_HANDHELD_LOGINResponse"]?.E_MESSAGE || 
                        error.message || 
                        "Authentication failed";
    throw new Error(errorMessage);
  }
};