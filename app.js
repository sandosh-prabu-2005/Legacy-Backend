const express = require("express");
const app = express();
const dotenv = require("dotenv");
const path = require("path");
const cors = require("cors");
dotenv.config({ path: path.join(__dirname, "config/config.env") });
const errorMiddleware = require("./middlewares/error");

const user = require("./routes/users_routes");
const events = require("./routes/events_routes");
const registration = require("./routes/registration_routes");
const team = require("./routes/team_routes");
const cookieParser = require("cookie-parser");
const admin = require("./routes/admin_routes");
const adminInvite = require("./routes/adminInvite_routes");
const payment = require("./routes/payment_routes");
const coordinators = require("./routes/coordinators_routes");

const corsOptions = {
  origin: function (origin, callback) {
    // Allow all origins
    console.log("CORS origin:", origin);
    callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "Access-Control-Request-Method",
    "Access-Control-Request-Headers",
    "Cookie",
  ],
  exposedHeaders: ["Authorization", "Set-Cookie"],
  optionsSuccessStatus: 200,
  preflightContinue: false,
};

app.use(cors(corsOptions));

// Add debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  console.log("Request headers:", req.headers);
  console.log("Request cookies:", req.cookies);
  next();
});

app.use(express.json());
app.use(cookieParser());

// Health check route for Railway
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Legacy 2025 Backend API is running!",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

app.use("/api/v1", user);
app.use("/api/v1", events);
app.use("/api/v1", admin);
app.use("/api/v1/admin", adminInvite);
// Registration routes mounted at both /api/v1 and /api/v1/registration for compatibility
app.use("/api/v1", registration);
app.use("/api/v1/registration", registration);
app.use("/api/v1/teams", team);
app.use("/api/v1", payment);
app.use("/api/v1", coordinators);

app.use(errorMiddleware);
module.exports = app;
