const catchAsyncError = require("../middlewares/catchAsyncError");
const ErrorHandler = require("../utils/errorHandler");
const EventRegistration = require("../models/eventRegistrations");
const User = require("../models/users");

// Public endpoint to get all coordinators (no authentication required)
exports.getAllCoordinatorsPublic = catchAsyncError(async (req, res, next) => {
  console.log("Fetching all coordinators publicly (no auth)");

  try {
    // Fetch all verified users from all colleges
    const coordinators = await User.find({
      isVerified: true,
    })
      .select("name college dept year level degree role")
      .sort({ college: 1, name: 1 }); // Sort by college first, then by name

    console.log(
      "Public query executed, found coordinators:",
      coordinators.length
    );

    // Transform data to match the frontend structure but without sensitive info
    const formattedCoordinators = coordinators.map((coordinator) => ({
      _id: coordinator._id,
      name: coordinator.name,
      college: coordinator.college,
      degree: coordinator.degree || "Not specified",
      department: coordinator.dept || "Not specified",
      year: coordinator.year || "Not specified",
      level: coordinator.level || "Not specified",
      role: coordinator.role || "user",
    }));

    // Remove duplicates based on name and college combination
    const uniqueCoordinators = formattedCoordinators.filter(
      (coordinator, index, self) => {
        return (
          index ===
          self.findIndex(
            (p) =>
              p.name === coordinator.name && p.college === coordinator.college
          )
        );
      }
    );

    console.log(
      `Found ${uniqueCoordinators.length} unique coordinators from all colleges`
    );

    // Get list of unique colleges for filtering
    const colleges = [
      ...new Set(uniqueCoordinators.map((c) => c.college)),
    ].sort();

    res.status(200).json({
      success: true,
      message: `Found ${uniqueCoordinators.length} coordinators from all colleges`,
      coordinators: uniqueCoordinators,
      colleges: colleges,
      totalCount: uniqueCoordinators.length,
    });
  } catch (error) {
    console.error("Error fetching public coordinators:", error);
    return next(new ErrorHandler("Failed to fetch coordinators data", 500));
  }
});

// Get all coordinators from all colleges
exports.getCollegeParticipants = catchAsyncError(async (req, res, next) => {
  const userId = req.user._id;

  // Get user details for logging purposes
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorHandler("User not found", 404));
  }

  console.log(`Fetching all coordinators (User: ${user.name})`);

  try {
    // Fetch all verified users from all colleges
    console.log("Querying all colleges for verified users");
    const coordinators = await User.find({
      isVerified: true,
    })
      .select("name college dept year level degree phoneNumber email role")
      .sort({ college: 1, name: 1 }); // Sort by college first, then by name

    console.log("Query executed, found coordinators:", coordinators.length);

    // Transform data to match the frontend structure expected by CoordinatorsPage
    const formattedCoordinators = coordinators.map((coordinator) => {
      const coordinatorData = {
        _id: coordinator._id,
        name: coordinator.name,
        college: coordinator.college,
        mobile: coordinator.phoneNumber || "Not provided",
        event: "N/A", // Users don't have specific events, so we'll show N/A
        degree: coordinator.degree || "Not specified", // degree field contains BTech/BE/etc
        department: coordinator.dept || "Not specified",
        year: coordinator.year || "Not specified",
        level: coordinator.level || "Not specified", // level field contains UG/PG
        email: coordinator.email,
        role: coordinator.role,
      };

      // Debug individual coordinator data (first few only)
      if (coordinators.indexOf(coordinator) < 3) {
        console.log("Sample coordinator data:", coordinatorData);
      }

      return coordinatorData;
    });

    console.log(
      `Raw coordinators count: ${coordinators.length}, after formatting: ${formattedCoordinators.length}`
    );

    // Debug: Log sample coordinator data
    if (coordinators.length > 0) {
      console.log(
        "Sample coordinator data:",
        JSON.stringify(coordinators[0], null, 2)
      );
      console.log(
        "Sample formatted data:",
        JSON.stringify(formattedCoordinators[0], null, 2)
      );
    }

    // Remove duplicates based on name and email combination (users should be unique by email)
    const uniqueCoordinators = formattedCoordinators.filter(
      (coordinator, index, self) => {
        return (
          index ===
          self.findIndex(
            (p) => p.name === coordinator.name && p.email === coordinator.email
          )
        );
      }
    );

    console.log(
      `Found ${uniqueCoordinators.length} unique coordinators from all colleges`
    );

    // Get list of unique colleges for filtering
    const colleges = [
      ...new Set(uniqueCoordinators.map((c) => c.college)),
    ].sort();

    res.status(200).json({
      success: true,
      message: `Found ${uniqueCoordinators.length} coordinators from all colleges`,
      coordinators: uniqueCoordinators, // Using 'coordinators' key to match frontend expectation
      colleges: colleges, // List of all colleges for filter dropdown
      userCollege: user.college, // User's college for default filtering
      totalCount: uniqueCoordinators.length,
    });
  } catch (error) {
    console.error("Error fetching college coordinators:", error);
    return next(new ErrorHandler("Failed to fetch coordinators data", 500));
  }
});

// Alternative endpoint for getting actual coordinators (users with coordinator roles)
exports.getCollegeCoordinators = catchAsyncError(async (req, res, next) => {
  const userId = req.user._id;

  // Get user details to find their college
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorHandler("User not found", 404));
  }

  try {
    // Find coordinators from the same college using multiple criteria
    const coordinatorQuery1 = {
      college: user.college,
      role: "user",
      isVerified: true,
      assignedEvent: { $exists: true },
      club: { $exists: true },
    };

    const coordinatorQuery2 = {
      college: user.college,
      role: "admin",
      isSuperAdmin: false,
      isVerified: true,
    };

    // Find coordinators using both criteria
    const coordinators1 = await User.find(coordinatorQuery1).select(
      "_id name email phoneNumber college club assignedEvent"
    );
    const coordinators2 = await User.find(coordinatorQuery2).select(
      "_id name email phoneNumber college club assignedEvent"
    );

    // Combine and deduplicate coordinators
    const allCoordinators = [...coordinators1, ...coordinators2];
    const uniqueCoordinators = allCoordinators.filter(
      (coord, index, self) =>
        index ===
        self.findIndex((c) => c._id.toString() === coord._id.toString())
    );

    // Format coordinators data for frontend
    const formattedCoordinators = uniqueCoordinators.map((coord) => ({
      _id: coord._id,
      name: coord.name,
      college: coord.college,
      mobile: coord.phoneNumber,
      email: coord.email,
      club: coord.club,
    }));

    res.status(200).json({
      success: true,
      message: `Found ${formattedCoordinators.length} coordinators from ${user.college}`,
      coordinators: formattedCoordinators,
      collegeName: user.college,
      totalCount: formattedCoordinators.length,
    });
  } catch (error) {
    console.error("Error fetching college coordinators:", error);
    return next(new ErrorHandler("Failed to fetch coordinators data", 500));
  }
});
