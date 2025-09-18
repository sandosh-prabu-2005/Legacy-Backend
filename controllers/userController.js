const catchAsyncError = require("../middlewares/catchAsyncError");
const UserModel = require("../models/users");
const sendEmail = require("../utils/email");
const crypto = require("crypto");
const ErrorHandler = require("../utils/errorHandler");
const EventModel = require("../models/events");
const sendToken = require("../utils/jwt");
const signUpUser = catchAsyncError(async (req, res, next) => {
  // Debug: Log incoming signup data
  console.log("Signup request body:", req.body);

  const {
    name,
    level,
    degree,
    dept,
    year,
    gender,
    phoneNumber,
    email,
    password,
    role,
    college,
    city,
  } = req.body;

  let existingUser = await UserModel.findOne({ email });
  if (existingUser) {
    if (existingUser.isVerified) {
      console.log("Verified user already exists with email:", email);
      return res.status(400).json({
        success: false,
        message: "Email already registered and verified. Please login instead.",
      });
    } else {
      // Remove unverified user to allow re-registration
      console.log("Removing unverified user with email:", email);
      await UserModel.findOneAndDelete({ email, isVerified: false });
    }
  }

  // Check if this is the first user in the database
  const userCount = await UserModel.countDocuments();
  const isFirstUser = userCount === 0;

  const user = new UserModel({
    name,
    level: isFirstUser ? "UG" : level, // Default level for first user (admin)
    degree: isFirstUser ? "BE" : degree, // Default degree for first user (admin)
    dept,
    year: isFirstUser ? "0" : year, // Default year for first user (admin)
    gender: isFirstUser ? "Male" : gender, // Default gender for first user (admin)
    phoneNumber: isFirstUser ? "9999999999" : phoneNumber, // Default phone for first user (admin)
    email,
    password,
    role: isFirstUser ? "admin" : role || "user",
    isSuperAdmin: isFirstUser,
    club: isFirstUser ? "FINE ARTS" : undefined,
    college,
    city,
  });

  if (isFirstUser) {
    console.log(`🎉 First user (${email}) is being created as Super Admin`);
  }

  // Save user first, handle validation errors
  try {
    await user.save();
    console.log(`✅ User ${email} created and saved to database successfully`);
  } catch (err) {
    console.error(`❌ Failed to save user ${email}:`, err);
    let errorMessage =
      "Failed to create user. Please check your details and try again.";
    if (err.name === "ValidationError") {
      errorMessage = Object.values(err.errors)
        .map((e) => e.message)
        .join(" ");
    } else if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
      errorMessage = "Email already registered.";
    }
    return res.status(400).json({
      success: false,
      message: errorMessage,
    });
  }

  // Generate verification OTP and send email after user is saved
  const verificationOTP = user.generateVerificationOTP();
  await user.save({ validateBeforeSave: false });

  try {
    console.log(`📧 Attempting to send verification OTP to ${email}...`);
    await sendEmail({
      email: user.email,
      subject: "Verify Your Email - OTP Code",
      message: `Your verification code is: ${verificationOTP}\n\nThis code is valid for 10 minutes.\n\nPlease enter this code on the verification page to complete your registration.`,
    });
    console.log(`✅ Verification OTP sent successfully to ${email}`);
  } catch (err) {
    console.error(`❌ Failed to send verification OTP to ${email}:`, err);
    let errorMessage =
      "Failed to send verification email. Please try again later.";
    if (err.code === "EAUTH" || err.responseCode === 535) {
      errorMessage = "Email configuration error. Please contact support.";
    } else if (err.code === "ECONNECTION" || err.code === "ETIMEDOUT") {
      errorMessage =
        "Email service temporarily unavailable. Please try again later.";
    } else if (err.code === "EMESSAGE" || err.responseCode === 550) {
      errorMessage = "Invalid email address. Please check and try again.";
    }
    return res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }

  res.status(201).json({
    success: true,
    message: isFirstUser
      ? "🎉 Welcome! You have been automatically made a Super Admin. Please check your email for the verification code."
      : "User registered successfully. Please check your email for the verification code.",
    isFirstUser,
    role: user.role,
    isSuperAdmin: user.isSuperAdmin,
    email: user.email, // Include email for OTP verification
  });
});

const verifyEmail = catchAsyncError(async (req, res, next) => {
  const { token } = req.params;

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const user = await UserModel.findOne({
    verificationToken: hashedToken,
    verificationTokenExpire: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired verification token",
    });
  }

  user.isVerified = true;
  user.verificationToken = undefined;
  user.verificationTokenExpire = undefined;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: "Email verified successfully! You can now log in.",
  });
});

const verifyOTP = catchAsyncError(async (req, res, next) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({
      success: false,
      message: "Email and OTP are required",
    });
  }

  const user = await UserModel.findOne({
    email,
    verificationOTP: otp,
    verificationOTPExpire: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired OTP",
    });
  }

  user.isVerified = true;
  user.verificationOTP = undefined;
  user.verificationOTPExpire = undefined;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: "Email verified successfully! You can now log in.",
  });
});

const resendOTP = catchAsyncError(async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  const user = await UserModel.findOne({ email, isVerified: false });

  if (!user) {
    return res.status(400).json({
      success: false,
      message: "User not found or already verified",
    });
  }

  const verificationOTP = user.generateVerificationOTP();
  await user.save({ validateBeforeSave: false });

  try {
    await sendEmail({
      email: user.email,
      subject: "Verify Your Email - New OTP Code",
      message: `Your new verification code is: ${verificationOTP}\n\nThis code is valid for 10 minutes.\n\nPlease enter this code on the verification page to complete your registration.`,
    });

    res.status(200).json({
      success: true,
      message: "New OTP sent successfully!",
    });
  } catch (err) {
    console.error("Failed to send OTP:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send OTP. Please try again later.",
    });
  }
});

const forgotPassword = catchAsyncError(async (req, res, next) => {
  const { email } = req.body;

  const user = await UserModel.findOne({ email });
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const resetToken = user.getResetToken();
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${
    process.env.FRONTEND_URL || "http://localhost:5173"
  }/auth/reset-password/${resetToken}`;

  const message = `You requested a password reset.\n\n
  Please click the link below to reset your password:\n\n
  ${resetUrl}\n\n
  This link is valid for 30 minutes.`;

  try {
    await sendEmail({
      email: user.email,
      subject: "Password Reset Request",
      message,
    });

    res.status(200).json({
      success: true,
      message: `Password reset email sent to ${user.email}`,
    });
  } catch (err) {
    user.resetPasswordToken = undefined;
    user.resetPasswordTokenExpire = undefined;
    await user.save({ validateBeforeSave: false });
    return res
      .status(500)
      .json({ success: false, message: "Email could not be sent" });
  }
});

const resetPassword = catchAsyncError(async (req, res, next) => {
  const { token } = req.params;
  const { password } = req.body;

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
  const user = await UserModel.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordTokenExpire: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired reset token",
    });
  }

  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordTokenExpire = undefined;

  await user.save();

  res.status(200).json({
    success: true,
    message: "Password reset successful",
  });
});

const signinUser = catchAsyncError(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return next(new ErrorHandler("Please enter email & password", 400));
  }

  const user = await UserModel.findOne({ email }).select("+password");
  if (!user) {
    return next(new ErrorHandler("Invalid Email or password", 401));
  }
  if (!(await user.isValidPassword(password))) {
    return next(new ErrorHandler("Invalid Email or password", 401));
  }
  if (!(await user.isVerified))
    return next(new ErrorHandler("Unverified Email", 401));
  sendToken(user, 201, res);
});
const signOutUser = (req, res, next) => {
  res
    .cookie("token", null, {
      expires: new Date(Date.now()),
      httpOnly: false, // Allow JavaScript access for debugging
      secure: false, // Allow HTTP and HTTPS (less strict)
      sameSite: "none", // Most permissive for cross-origin
    })
    .status(200)
    .json({
      success: true,
      message: "Logged Out Successfully",
    });
};

const findUser = catchAsyncError(async (req, res, next) => {
  const { email, fuid } = req.body;

  if (!email && !fuid) {
    return res.status(400).json({
      success: false,
      message: "Please provide either email or fuid",
    });
  }

  const query = email ? { email } : { fuid };

  const user = await UserModel.findOne(query).select("-password");
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  res.status(200).json({
    success: true,
    user,
    message: "User found",
  });
});

const loadUser = catchAsyncError(async (req, res, next) => {
  const userId = req.user._id;
  console.log("Loading user with ID:", userId);
  console.log("User from token:", req.user.email);

  const user = await UserModel.findById(userId).select("-password");
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  console.log("Found user:", user.email, user.name);

  // Find events where the logged-in user has applied
  const events = await EventModel.find({
    "applications.userId": userId,
  })
    .populate({
      path: "applications.userId", // Populate the userId field inside applications
      match: { _id: userId }, // Only match the current user
      select: "name email",
    })
    .select("name createdAt applications");

  res.status(200).json({
    success: true,
    user,
    events,
  });
});

const getYears = catchAsyncError(async (req, res) => {
  const years = await UserModel.distinct("year");
  res.status(200).json({
    success: true,
    years: years.sort(),
    message: "Years fetched successfully",
  });
});

// Search users by email or name
const searchUsers = catchAsyncError(async (req, res, next) => {
  const { q } = req.query;
  const currentUserId = req.user._id;

  if (!q || q.length < 2) {
    return res.status(400).json({
      success: false,
      message: "Search query must be at least 2 characters long",
    });
  }

  const users = await UserModel.find({
    $and: [
      { isVerified: true },
      { role: { $ne: "admin" } }, // Exclude admins
      { _id: { $ne: currentUserId } }, // Exclude current user
      {
        $or: [
          { email: { $regex: q, $options: "i" } },
          { name: { $regex: q, $options: "i" } },
        ],
      },
    ],
  })
    .select("name email dept year gender")
    .limit(20);

  res.status(200).json({
    success: true,
    users,
  });
});

// Get user registrations
const getUserRegistrations = catchAsyncError(async (req, res, next) => {
  const userId = req.user._id;

  // Find all events where the user has registered
  const events = await EventModel.find({
    "applications.userId": userId,
  })
    .populate("applications.userId", "name email")
    .populate({
      path: "applications.teamId",
      select: "teamName members leader",
      populate: [
        {
          path: "leader",
          select: "name email phoneNumber dept",
        },
        {
          path: "members.userId",
          select: "name email phoneNumber dept",
        },
      ],
    });

  const registrations = events.map((event) => {
    const userApplication = event.applications.find(
      (app) =>
        app.userId &&
        app.userId._id &&
        app.userId._id.toString() === userId.toString()
    );

    let teamDetails = null;
    if (userApplication.teamId) {
      const team = userApplication.teamId;
      teamDetails = {
        teamId: team._id,
        teamName: team.teamName,
        leader: {
          _id: team.leader._id,
          name: team.leader.name,
          email: team.leader.email,
          phoneNumber: team.leader.phoneNumber,
          dept: team.leader.dept,
        },
        members: team.members.map((member) => ({
          _id: member.userId._id,
          name: member.userId.name,
          email: member.userId.email,
          phoneNumber: member.userId.phoneNumber,
          dept: member.userId.dept,
          joinedAt: member.joinedAt,
        })),
      };
    }

    return {
      eventId: event._id,
      eventName: event.name,
      eventType: event.event_type,
      clubInCharge: event.clubInCharge,
      appliedAt: userApplication.appliedAt,
      status: userApplication.status,
      teamId: userApplication.teamId?._id || null,
      teamDetails,
    };
  });

  res.status(200).json({
    success: true,
    registrations,
  });
});

// Get all users (for team invitations)
const getAllUsers = catchAsyncError(async (req, res, next) => {
  const currentUserId = req.user._id;

  const users = await UserModel.find(
    {
      isVerified: true,
      role: { $ne: "admin" }, // Exclude admins
      _id: { $ne: currentUserId }, // Exclude current user
    },
    "name email _id"
  )
    .sort({ name: 1 })
    .limit(1000); // Limit for performance

  res.status(200).json({
    success: true,
    users,
  });
});

const changePassword = catchAsyncError(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return next(
      new ErrorHandler("Please provide both current and new password", 400)
    );
  }

  if (newPassword.length < 6) {
    return next(
      new ErrorHandler("New password must be at least 6 characters long", 400)
    );
  }

  const user = await UserModel.findById(req.user._id).select("+password");

  const isCurrentPasswordMatched = await user.isValidPassword(currentPassword);

  if (!isCurrentPasswordMatched) {
    return next(new ErrorHandler("Current password is incorrect", 400));
  }

  if (currentPassword === newPassword) {
    return next(
      new ErrorHandler(
        "New password must be different from current password",
        400
      )
    );
  }

  user.password = newPassword;
  await user.save();

  res.status(200).json({
    success: true,
    message: "Password changed successfully",
  });
});

// Get user by ID - for populating edit forms
const getUserById = catchAsyncError(async (req, res, next) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "User ID is required",
    });
  }

  const user = await UserModel.findById(userId).select("-password");
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  res.status(200).json({
    success: true,
    user,
    message: "User found",
  });
});

module.exports = {
  signUpUser,
  verifyEmail,
  verifyOTP,
  resendOTP,
  forgotPassword,
  resetPassword,
  signinUser,
  signOutUser,
  findUser,
  loadUser,
  getUserById,
  getYears,
  searchUsers,
  getUserRegistrations,
  getAllUsers,
  changePassword,
};
