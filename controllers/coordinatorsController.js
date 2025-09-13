const catchAsyncError = require("../middlewares/catchAsyncError");
const ErrorHandler = require("../utils/errorHandler");
const EventRegistration = require("../models/eventRegistrations");
const User = require("../models/users");

// Get participants from the same college as the logged-in user
exports.getCollegeParticipants = catchAsyncError(async (req, res, next) => {
  const userId = req.user._id;

  // Get user details to find their college
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorHandler("User not found", 404));
  }

  console.log(`Fetching participants for college: ${user.college} (User: ${user.name})`);

  try {
    // Fetch all event registrations from the same college
    console.log('Querying college:', user.college);
    const participants = await EventRegistration.find({
      collegeName: user.college,
      isActive: true,
    })
      .sort({ participantName: 1 });

    console.log('Query executed, found participants:', participants.length);

    // Transform data to match the frontend structure expected by CoordinatorsPage
    const formattedParticipants = participants.map(participant => {
      const participantData = {
        _id: participant._id,
        name: participant.participantName,
        college: participant.collegeName,
        mobile: participant.participantMobile || 'Not provided',
        event: participant.eventName || 'N/A',
        degree: participant.degree || 'Not specified',
        department: participant.department || participant.customDepartment || 'Not specified',
        year: participant.year || 'Not specified',
        level: participant.level || 'Not specified',
        registrationDate: participant.registrationDate
      };
      
      // Debug individual participant data (first few only)
      if (participants.indexOf(participant) < 3) {
        console.log('Sample participant data:', participantData);
      }
      
      return participantData;
    });

    console.log(`Raw participants count: ${participants.length}, after formatting: ${formattedParticipants.length}`);
    
    // Debug: Log sample participant data
    if (participants.length > 0) {
      console.log('Sample participant data:', JSON.stringify(participants[0], null, 2));
      console.log('Sample formatted data:', JSON.stringify(formattedParticipants[0], null, 2));
    }

    // Remove duplicates based on name and mobile combination
    const uniqueParticipants = formattedParticipants.filter((participant, index, self) => {
      return index === self.findIndex(p => 
        p.name === participant.name && 
        p.mobile === participant.mobile
      );
    });

    console.log(`Found ${uniqueParticipants.length} unique participants from ${user.college}`);

    res.status(200).json({
      success: true,
      message: `Found ${uniqueParticipants.length} participants from ${user.college}`,
      coordinators: uniqueParticipants, // Using 'coordinators' key to match frontend expectation
      collegeName: user.college,
      totalCount: uniqueParticipants.length
    });

  } catch (error) {
    console.error("Error fetching college participants:", error);
    return next(new ErrorHandler("Failed to fetch participants data", 500));
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
    const formattedCoordinators = uniqueCoordinators.map(coord => ({
      _id: coord._id,
      name: coord.name,
      college: coord.college,
      mobile: coord.phoneNumber,
      email: coord.email,
      club: coord.club
    }));

    res.status(200).json({
      success: true,
      message: `Found ${formattedCoordinators.length} coordinators from ${user.college}`,
      coordinators: formattedCoordinators,
      collegeName: user.college,
      totalCount: formattedCoordinators.length
    });

  } catch (error) {
    console.error("Error fetching college coordinators:", error);
    return next(new ErrorHandler("Failed to fetch coordinators data", 500));
  }
});