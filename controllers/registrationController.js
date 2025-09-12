const Event = require("../models/events");
const Teams = require("../models/teams");
const User = require("../models/users");
const EventRegistration = require("../models/eventRegistrations");
const catchAsyncError = require("../middlewares/catchAsyncError");
const ErrorHandler = require("../utils/errorHandler");

// Helper function to check if user is already registered for an event
const isUserRegisteredForEvent = async (userId, eventId) => {
  // Check if user is in any registered team for this event
  const registeredTeam = await Teams.findOne({
    eventId,
    isRegistered: true,
    $or: [{ leader: userId }, { "members.userId": userId }],
  });

  if (registeredTeam) {
    return true;
  }

  // Check if user is registered for solo event
  const event = await Event.findById(eventId);
  if (event) {
    const soloRegistration = event.applications.find(
      (app) => app.userId.toString() === userId.toString() && !app.teamId
    );

    if (soloRegistration) {
      return true;
    }
  }

  return false;
};

// Handle solo event registration
exports.registerSoloEvent = catchAsyncError(async (req, res, next) => {
  const { eventId } = req.body;
  const userId = req.user._id;

  // Check if event exists
  const event = await Event.findById(eventId);
  if (!event) {
    return next(new ErrorHandler("Event not found", 404));
  }

  // Check if event is solo type
  if (event.event_type !== "solo") {
    return next(new ErrorHandler("This is not a solo event", 400));
  }

  // Check if user is already registered for this event (team or solo)
  const isAlreadyRegistered = await isUserRegisteredForEvent(userId, eventId);
  if (isAlreadyRegistered) {
    return next(
      new ErrorHandler("You are already registered for this event", 400)
    );
  }

  // Check event capacity for solo events
  if (event.maxApplications) {
    const soloApplications = event.applications.filter((app) => !app.teamId);
    if (soloApplications.length >= event.maxApplications) {
      return next(new ErrorHandler("Event is full", 400));
    }
  }

  // Check registration deadline
  if (
    event.applicationDeadline &&
    new Date() > new Date(event.applicationDeadline)
  ) {
    return next(new ErrorHandler("Registration deadline has passed", 400));
  }

  // Add application to event
  event.applications.push({
    userId,
    appliedAt: new Date(),
  });

  await event.save();

  res.status(200).json({
    success: true,
    message: "Successfully registered for the event",
    event,
  });
});

// Handle group event registration - now requires team creation first
exports.registerGroupEvent = catchAsyncError(async (req, res, next) => {
  const { eventId, teamName } = req.body;
  const userId = req.user._id;

  // Check if event exists
  const event = await Event.findById(eventId);
  if (!event) {
    return next(new ErrorHandler("Event not found", 404));
  }

  // Check if event is group type
  if (event.event_type !== "group") {
    return next(new ErrorHandler("This is not a group event", 400));
  }

  // Check if user is already registered for this event (team or solo)
  const isAlreadyRegistered = await isUserRegisteredForEvent(userId, eventId);
  if (isAlreadyRegistered) {
    return next(
      new ErrorHandler(
        "You are already registered for this event and cannot create a new team",
        400
      )
    );
  }

  // Check if user already has a team for this event (including unregistered teams)
  const existingTeam = await Teams.findOne({
    eventId,
    $or: [{ leader: userId }, { "members.userId": userId }],
  });

  if (existingTeam) {
    return next(
      new ErrorHandler("You are already part of a team for this event", 400)
    );
  }

  // Check event capacity for group events (count registered teams, not applications)
  if (event.maxApplications) {
    const registeredTeamsCount = await Teams.countDocuments({
      eventId,
      isRegistered: true,
    });
    if (registeredTeamsCount >= event.maxApplications) {
      return next(new ErrorHandler("Event is full", 400));
    }
  }

  // Check registration deadline
  if (
    event.applicationDeadline &&
    new Date() > new Date(event.applicationDeadline)
  ) {
    return next(new ErrorHandler("Registration deadline has passed", 400));
  }

  // Create a new team
  const team = await Teams.create({
    eventId,
    teamName,
    leader: userId,
    members: [{ userId }],
    maxMembers: event.maxTeamSize || 6,
  });

  res.status(201).json({
    success: true,
    message: "Team created successfully. You can now invite other members.",
    team,
    note: "To register the team for the event, complete your team and use the registerTeam endpoint",
  });
});

// Handle direct event registration with participants (new functionality)
exports.registerEventWithParticipants = catchAsyncError(
  async (req, res, next) => {
    const { eventId, teamName, participants } = req.body;
    const registrantId = req.user._id;

    console.log("[DEBUG] Registration request:", {
      eventId,
      teamName,
      participantsCount: participants?.length,
      registrantId: registrantId.toString(),
    });

    // Validate required fields
    if (
      !eventId ||
      !participants ||
      !Array.isArray(participants) ||
      participants.length === 0
    ) {
      return next(
        new ErrorHandler("Event ID and participants are required", 400)
      );
    }

    console.log("varudhu bha=============");
    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return next(new ErrorHandler("Event not found", 404));
    }
    console.log("==============debug======================");
    console.table(event);
    // Get registrant (user who is registering) details for college inheritance
    const registrant = await User.findById(registrantId);
    if (!registrant) {
      return next(new ErrorHandler("Registrant not found", 404));
    }

    // Validate participant count against event requirements
    if (event.event_type === "solo" && participants.length > 1) {
      return next(
        new ErrorHandler("Solo events can only have one participant", 400)
      );
    }

    if (event.event_type === "group") {
      if (participants.length < event.minTeamSize) {
        return next(
          new ErrorHandler(
            `Minimum ${event.minTeamSize} participants required for this event`,
            400
          )
        );
      }
      if (participants.length > event.maxTeamSize) {
        return next(
          new ErrorHandler(
            `Maximum ${event.maxTeamSize} participants allowed for this event`,
            400
          )
        );
      }
      if (!teamName || teamName.trim() === "") {
        return next(
          new ErrorHandler("Team name is required for group events", 400)
        );
      }
    }

    // Validate each participant
    for (let i = 0; i < participants.length; i++) {
      const participant = participants[i];

      // Validate required fields
      if (
        !participant.name ||
        !participant.level ||
        !participant.degree ||
        !participant.dept ||
        !participant.year ||
        !participant.gender
      ) {
        return next(
          new ErrorHandler(
            `Missing required fields for participant ${i + 1}`,
            400
          )
        );
      }

      // Validate custom department if "Other" is selected
      if (
        participant.dept === "Other" &&
        (!participant.customDept || participant.customDept.trim() === "")
      ) {
        return next(
          new ErrorHandler(
            `Custom department is required for participant ${i + 1}`,
            400
          )
        );
      }
    }

    let teamId = null;
    // For group events, create a team record using existing team functionality
    if (event.event_type === "group") {
      // Check if user already has a team for this event
      const existingTeam = await Teams.findOne({
        eventId,
        leader: registrantId,
        isRegistered: true,
      });

      if (existingTeam) {
        return next(
          new ErrorHandler(
            "You already have a registered team for this event",
            400
          )
        );
      }

      // Create team with direct members (using our existing team model)
      const team = await Teams.create({
        eventId,
        teamName: teamName.trim(),
        leader: registrantId,
        members: participants.map((participant) => ({
          // No userId for direct participants
          userId: null,
          name: participant.name,
          email: participant.email || null,
          mobile: participant.mobile || null,
          dept:
            participant.dept === "Other"
              ? participant.customDept
              : participant.dept,
          year: participant.year,
          degree: participant.degree,
          gender: participant.gender,
          registrationType: "direct",
        })),
        maxMembers: event.maxTeamSize || 6,
        isRegistered: true, // Mark as registered since all members are provided
        registeredAt: new Date(),
        registeredBy: registrantId,
      });

      teamId = team._id;
    }
    // Create individual registration records for statistical analysis
    const registrationPromises = participants.map((participant) => {
      return EventRegistration.create({
        // Event Information
        eventId,
        eventName: event.name,
        eventType: event.event_type,

        // Team Information (if applicable)
        teamId,
        teamName: event.event_type === "group" ? teamName.trim() : null,

        // Registrant Information
        registrantId,
        registrantEmail: registrant.email,

        // Participant Information
        participantName: participant.name,
        participantEmail: participant.email || null,
        participantMobile: participant.mobile || null,

        // Educational Information
        level: participant.level,
        degree: participant.degree,
        department:
          participant.dept === "Other"
            ? participant.customDept || "Other"
            : participant.dept,
        customDepartment:
          participant.dept === "Other" ? participant.customDept : null,
        year: participant.year,

        // Demographic Information
        gender: participant.gender,

        // College Information (inherited from registrant)
        collegeName: registrant.college,
        collegeCity: registrant.city,
        collegeState: registrant.state || "Not Specified", // Default for missing state

        // Registration Metadata
        registrationType: "direct",
      });
    });

    // Execute all registration creations
    const registrations = await Promise.all(registrationPromises);

    console.log("[DEBUG] Created registrations:", {
      count: registrations.length,
      eventType: event.event_type,
      teamId: teamId ? teamId.toString() : null,
      collegeName: registrant.college,
      collegeCity: registrant.city,
    });

    // NOTE: Solo events are now stored ONLY in EventRegistration collection,
    // not in Event.applications for cleaner data architecture

    res.status(201).json({
      success: true,
      message: `Successfully registered ${participants.length} participant${
        participants.length > 1 ? "s" : ""
      } for ${event.name}`,
      data: {
        eventName: event.name,
        eventType: event.event_type,
        teamName: teamName || null,
        participantCount: participants.length,
        registrations: registrations.map((reg) => ({
          participantName: reg.participantName,
          department: reg.fullDepartment,
          year: reg.year,
          registrationId: reg._id,
        })),
      },
    });
  }
);

// Get registrations for user's college (for college registrations view)
// Enhanced for coordinators to see their own + other coordinators' registrations
exports.getCollegeRegistrations = catchAsyncError(async (req, res, next) => {
  const userId = req.user._id;

  // Get user details to find their college and role
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorHandler("User not found", 404));
  }

  let registrations;
  let coordinators = [];

  if (user.role === "admin") {
    // For coordinators: Get registrations from all coordinators of the same college
    // First, find all coordinators from the same college
    coordinators = await User.find({
      college: user.college,
      role: "admin",
      isVerified: true,
    }).select("_id name email club assignedEvent");

    const coordinatorIds = coordinators.map((coord) => coord._id);

    // Fetch registrations created by any coordinator from this college
    registrations = await EventRegistration.find({
      collegeName: user.college,
      registrantId: { $in: coordinatorIds },
      isActive: true,
    }).sort({ registrationDate: -1 });
  } else {
    // For regular users: Only show registrations for the user's college (existing behavior)
    registrations = await EventRegistration.find({
      collegeName: user.college,
      isActive: true,
    }).sort({ registrationDate: -1 });
  }

  // Separate solo and team registrations
  const soloRegistrations = registrations.filter(
    (reg) => reg.eventType === "solo"
  );
  const teamRegistrations = registrations.filter(
    (reg) => reg.eventType === "group"
  );

  // Group team registrations by team and event
  const groupedTeamRegistrations = {};
  teamRegistrations.forEach((reg) => {
    const teamKey = `${reg.teamName}-${reg.eventName}`;
    if (!groupedTeamRegistrations[teamKey]) {
      groupedTeamRegistrations[teamKey] = {
        teamName: reg.teamName,
        eventName: reg.eventName,
        eventId: reg.eventId,
        teamId: reg.teamId,
        eventType: reg.eventType,
        registrantId: reg.registrantId, // Add this for coordinator tracking
        registrantEmail: reg.registrantEmail,
        members: [],
      };
    }
    groupedTeamRegistrations[teamKey].members.push({
      _id: reg._id,
      participantName: reg.participantName,
      participantEmail: reg.participantEmail,
      participantMobile: reg.participantMobile,
      level: reg.level,
      degree: reg.degree,
      department: reg.fullDepartment,
      year: reg.year,
      gender: reg.gender,
      registrationDate: reg.registrationDate,
      registrantId: reg.registrantId,
      registrantEmail: reg.registrantEmail,
    });
  });

  // Convert grouped teams to array
  const teamRegistrationsList = Object.values(groupedTeamRegistrations);

  // Calculate statistics
  const stats = {
    total: registrations.length,
    soloCount: soloRegistrations.length,
    teamCount: teamRegistrations.length,
    totalTeams: teamRegistrationsList.length,
    byGender: { Male: 0, Female: 0, Other: 0 },
    byLevel: { UG: 0, PG: 0, PhD: 0 },
    byEvent: {},
    byEventType: {
      solo: soloRegistrations.length,
      group: teamRegistrations.length,
    },
  };

  // Calculate statistics from all registrations
  registrations.forEach((reg) => {
    // Gender stats
    if (reg.gender in stats.byGender) {
      stats.byGender[reg.gender]++;
    }

    // Level stats
    if (reg.level in stats.byLevel) {
      stats.byLevel[reg.level]++;
    }

    // Event stats
    if (reg.eventName in stats.byEvent) {
      stats.byEvent[reg.eventName]++;
    } else {
      stats.byEvent[reg.eventName] = 1;
    }
  });

  res.status(200).json({
    success: true,
    data: {
      soloRegistrations: soloRegistrations.map((reg) => ({
        _id: reg._id,
        eventName: reg.eventName,
        eventId: reg.eventId,
        eventType: reg.eventType,
        participantName: reg.participantName,
        participantEmail: reg.participantEmail,
        participantMobile: reg.participantMobile,
        level: reg.level,
        degree: reg.degree,
        department: reg.fullDepartment,
        year: reg.year,
        gender: reg.gender,
        registrationDate: reg.registrationDate,
        registrantId: reg.registrantId,
        registrantEmail: reg.registrantEmail,
      })),
      teamRegistrations: teamRegistrationsList,
    },
    stats,
    college: user.college,
    total: registrations.length,
    userRole: user.role,
    currentUserId: userId.toString(),
    coordinators:
      user.role === "admin"
        ? coordinators.map((coord) => ({
            _id: coord._id,
            name: coord.name,
            email: coord.email,
            club: coord.club,
            assignedEvent: coord.assignedEvent,
          }))
        : [],
  });
});
