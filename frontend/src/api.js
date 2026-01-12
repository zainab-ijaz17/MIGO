import axios from "axios";
import { requestWithFallback } from "./utils/apiHelper";

export const loginUser = async (username, password, environment) => {
  return requestWithFallback(async (endpoints) => {
    const response = await axios.post(`${endpoints.auth}/Login`, {
      username,
      password,
      environment
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 30000, // 30 second timeout
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
  }).catch(error => {
    console.error("Login failed:", error);
    console.error("Error details:", {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
    });
    
    const errorMessage = error.response?.data?.["ns0:Z_WM_HANDHELD_LOGINResponse"]?.E_MESSAGE || 
                        error.message || 
                        "Authentication failed";
    throw new Error(errorMessage);
  });
};