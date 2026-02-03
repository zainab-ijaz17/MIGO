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
      const token = btoa(`${username}:${password}`);
      // Persist credentials for later API calls
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify({ username, environment }));
      return {
        success: true,
        username,
        environment,
        token
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

// Helper to decode user credentials from token for SAP auth
export const getUserCredentials = () => {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    const decoded = atob(token);
    const [username, password] = decoded.split(':');
    const userStr = localStorage.getItem('user');
    const user = userStr ? JSON.parse(userStr) : {};
    return { username, password, environment: user.environment };
  } catch {
    return null;
  }
};

