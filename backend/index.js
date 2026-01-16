// index.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const sapRoutes = require("./routes/sapRoutes");
const migoRoutes = require("./routes/migoRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

/**
 * CORS
 * Allow frontend + Zebra devices
 * (Can be restricted later if needed)
 */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    credentials: false
  })
);

// Middleware
app.use(express.json());

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.json({ message: "SAP Integration Backend is running" });
});

/**
 * Routes
 */
app.use("/api/auth", authRoutes);
app.use("/api", sapRoutes);
app.use("/api/migo", migoRoutes);

/**
 * Error handling (must be last)
 */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong" });
});

/**
 * Start server
 * IMPORTANT:
 * - Do NOT log IPs
 * - Do NOT assume network interfaces
 */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Login endpoint: POST /api/auth/Login");
  console.log("MIGO Check endpoint: POST /api/migo/check");
  console.log("MIGO Post endpoint: POST /api/migo/post");
});