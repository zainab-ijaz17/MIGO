import axios from "axios";

export const loginUser = async (username, password, environment) => {
  const response = await axios.post(`https://sap-app-maoe.onrender.com/api/auth/Login`, {
    username,
    password,
    environment
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    timeout: typeof window !== 'undefined' && window.Capacitor ? 60000 : 30000, // 60s for mobile, 30s for web
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
};