const UserModel = require("../models/users");
const ErrorHandler = require("../utils/errorHandler");

const catchAsyncError = require("./catchAsyncError");
const jwt = require("jsonwebtoken");

exports.isAuthenticatedUser = catchAsyncError(async (req, res, next) => {
  let token = req.cookies.token;

  console.log("=== Authentication Debug ===");
  console.log("Cookies received:", req.cookies);
  console.log("Token from cookies:", token);
  console.log("Authorization header:", req.headers.authorization);

  // If no token in cookies, check Authorization header
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      token = authHeader.substring(7); // Remove 'Bearer ' prefix
      console.log("Token from Authorization header:", token);
    }
  }

  if (!token) {
    console.log("No token found - returning 401");
    return next(
      new ErrorHandler("Please login to participate in any events", 401)
    );
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Token decoded successfully:", decoded);

    // Make sure we have the user ID from the token
    if (!decoded.id) {
      console.log("No user ID in token");
      return next(new ErrorHandler("Invalid token format", 401));
    }

    req.user = await UserModel.findById(decoded.id);
    if (!req.user) {
      console.log("User not found in database");
      return next(new ErrorHandler("User not found", 404));
    }

    // Check token version for session invalidation
    const userTokenVersion = req.user.tokenVersion || 0;
    const tokenVersion = decoded.tokenVersion || 0;
    
    if (tokenVersion < userTokenVersion) {
      console.log("Token version outdated - session invalidated");
      return next(new ErrorHandler("Session expired. Please login again.", 401));
    }

    console.log(
      "User found:",
      req.user.email,
      "Verified:",
      req.user.isVerified
    );

    // REMOVE EMAIL VERIFICATION CHECK FOR PROTOTYPE
    // if (req.user.isVerified === false) {
    //   return next(new ErrorHandler("Please verify your email", 401));
    // }

    console.log("Authentication successful for:", req.user.email);
    next();
  } catch (error) {
    console.log("JWT verification error:", error.message);
    // Handle JWT verification error
    return next(new ErrorHandler("Invalid token", 401));
  }
});

exports.authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new ErrorHandler(`Role ${req.user.role} is not allowed`, 403)
      );
    }
    next();
  };
};
