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
    // Check if event exists (support event_id string like 'L002')
    const event = await Event.findOne({ event_id: eventId });
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
        eventId: event._id, // Use ObjectId, not event_id string
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

  // Determine if user is coordinator or super admin
  // According to requirements: ALL registered users are coordinators
  const isCoordinator = user.isVerified; // Any verified/registered user is a coordinator
  const isSuperAdmin = user.role === "admin" && user.isSuperAdmin;

  console.log(`[DEBUG] User role detection:`, {
    userId: userId.toString(),
    userEmail: user.email,
    userCollege: user.college,
    isVerified: user.isVerified,
    userRole: user.role,
    isSuperAdmin,
    isCoordinator,
    finalRole: isSuperAdmin ? "admin" : isCoordinator ? "coordinator" : "user",
  });

  if (isCoordinator || isSuperAdmin) {
    // Find all verified users (coordinators) from the same college, excluding admins and super admins
    const coordinatorQuery = {
      college: user.college,
      isVerified: true, // Only verified users are coordinators
      role: { $ne: "admin" }, // Exclude users with admin role
      isSuperAdmin: { $ne: true }, // Exclude super admins
    };

    // Get all coordinators from the same college
    coordinators = await User.find(coordinatorQuery).select(
      "_id name email club assignedEvent role"
    );

    console.log(
      `[DEBUG] Found ${coordinators.length} coordinators for college ${user.college}:`,
      coordinators.map((c) => ({
        id: c._id.toString(),
        name: c.name,
        email: c.email,
      }))
    );

    const coordinatorIds = coordinators.map((coord) => coord._id);

    // Fetch registrations created by any coordinator from this college
    registrations = await EventRegistration.find({
      collegeName: user.college,
      registrantId: { $in: coordinatorIds },
      isActive: true,
    })
      .populate("registrantId", "name email")
      .sort({ registrationDate: -1 });

    console.log(
      `[DEBUG] Found ${registrations.length} total registrations for college ${user.college}`
    );
  } else {
    // For regular users: Only show registrations for the user's college (existing behavior)
    registrations = await EventRegistration.find({
      collegeName: user.college,
      isActive: true,
    })
      .populate("registrantId", "name email")
      .sort({ registrationDate: -1 });
  }

  // Separate solo and team registrations
  const soloRegistrations = registrations.filter(
    (reg) => reg.eventType === "solo"
  );

  // Log sample to verify population
  if (soloRegistrations.length > 0) {
    console.log(
      "Sample solo registration registrant:",
      soloRegistrations[0].registrantId
    );
  }
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
        registrantId: reg.registrantId._id, // Store the ID
        registrantName: reg.registrantId.name, // Store the name
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
      registrantId: reg.registrantId._id,
      registrantEmail: reg.registrantEmail,
    });
  });

  // Convert grouped teams to array
  const teamRegistrationsList = Object.values(groupedTeamRegistrations);

  // Log first few registrations to debug
  console.log("=== College Registrations Debug ===");
  console.log("User:", user.name, "College:", user.college);
  console.log("User Role:", user.role, "isSuperAdmin:", user.isSuperAdmin);
  console.log(
    "Determined role - isCoordinator:",
    isCoordinator,
    "isSuperAdmin:",
    isSuperAdmin
  );
  console.log("Total coordinators found:", coordinators.length);
  console.log("Solo registrations sample:", soloRegistrations.slice(0, 1));
  console.log("Team registrations sample:", teamRegistrationsList.slice(0, 1));
  console.log(
    "Final userRole being sent:",
    isSuperAdmin ? "admin" : isCoordinator ? "coordinator" : "user"
  );
  console.log("===================================");

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

  console.log(`[DEBUG] Response summary:`, {
    totalRegistrations: registrations.length,
    soloCount: soloRegistrations.length,
    teamCount: teamRegistrations.length,
    userRole: isSuperAdmin ? "admin" : isCoordinator ? "coordinator" : "user",
    coordinatorsCount: coordinators.length,
    currentUserId: userId.toString(),
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
        registrantId: reg.registrantId._id,
        registrantName: reg.registrantId.name,
        registrantEmail: reg.registrantEmail,
      })),
      teamRegistrations: teamRegistrationsList,
    },
    stats,
    college: user.college,
    total: registrations.length,
    userRole: isSuperAdmin ? "admin" : isCoordinator ? "coordinator" : "user",
    currentUserId: userId.toString(),
    coordinators:
      isCoordinator || isSuperAdmin
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

// Update solo registration participant details
exports.updateSoloRegistration = catchAsyncError(async (req, res, next) => {
  const { registrationId } = req.params;
  const userId = req.user._id;
  const {
    participantName,
    participantEmail,
    department,
    degree,
    year,
    level,
    gender,
    mobile,
    eventId,
  } = req.body;

  // Find the registration
  const registration = await EventRegistration.findById(registrationId);
  if (!registration) {
    return next(new ErrorHandler("Registration not found", 404));
  }

  // Check if the current user is the one who registered this participant
  if (registration.registrantId.toString() !== userId.toString()) {
    return next(
      new ErrorHandler("You can only edit participants you registered", 403)
    );
  }

  const originalEventId = registration.eventId;

  // If event is being changed, validate the new event
  if (eventId && eventId !== originalEventId.toString()) {
    // Find the new event
    const newEvent = await Event.findById(eventId);
    if (!newEvent) {
      return next(new ErrorHandler("New event not found", 404));
    }

    // Check if event is active and not archived
    if (!newEvent.isActive || newEvent.isArchived) {
      return next(
        new ErrorHandler(
          "Selected event is not available for registration",
          400
        )
      );
    }

    // Check if user is already registered for the new event
    const existingRegistration = await isUserRegisteredForEvent(
      userId,
      eventId
    );
    if (existingRegistration) {
      return next(
        new ErrorHandler("You are already registered for this event", 400)
      );
    }

    // Update event-related fields
    registration.eventId = eventId;
    registration.eventName = newEvent.event_name;
    registration.eventType = newEvent.event_type;

    // Remove from old event's applications if it exists
    if (originalEventId) {
      const oldEvent = await Event.findById(originalEventId);
      if (oldEvent) {
        oldEvent.applications = oldEvent.applications.filter(
          (app) =>
            !(
              app.userId &&
              app.userId.toString() === userId.toString() &&
              !app.teamId
            )
        );
        await oldEvent.save();
      }
    }

    // Add to new event's applications
    newEvent.applications.push({
      userId,
      appliedAt: new Date(),
    });
    await newEvent.save();
  }

  // Update the registration
  registration.participantName =
    participantName || registration.participantName;
  registration.participantEmail =
    participantEmail || registration.participantEmail;
  registration.department = department || registration.department;
  registration.degree = degree || registration.degree;
  registration.year = year || registration.year;
  registration.level = level || registration.level;
  registration.gender = gender || registration.gender;
  registration.mobile = mobile || registration.mobile;

  await registration.save();

  res.status(200).json({
    success: true,
    message: "Participant details updated successfully",
    registration,
    eventChanged: eventId && eventId !== originalEventId.toString(),
  });
});

// Update team registration member details
exports.updateTeamRegistrationMember = catchAsyncError(
  async (req, res, next) => {
    const { teamId, memberId } = req.params;
    const userId = req.user._id;
    const {
      participantName,
      participantEmail,
      department,
      degree,
      year,
      level,
      gender,
      mobile,
    } = req.body;

    // Find the team
    const team = await Teams.findById(teamId);
    if (!team) {
      return next(new ErrorHandler("Team not found", 404));
    }

    // Check if the current user is the one who registered this team
    if (team.registrantId.toString() !== userId.toString()) {
      return next(
        new ErrorHandler("You can only edit teams you registered", 403)
      );
    }

    // Find the member in the team
    const member = team.members.find((m) => m._id.toString() === memberId);
    if (!member) {
      return next(new ErrorHandler("Member not found in team", 404));
    }

    // Update the member details
    member.participantName = participantName || member.participantName;
    member.participantEmail = participantEmail || member.participantEmail;
    member.department = department || member.department;
    member.degree = degree || member.degree;
    member.year = year || member.year;
    member.level = level || member.level;
    member.gender = gender || member.gender;
    member.mobile = mobile || member.mobile;

    await team.save();

    res.status(200).json({
      success: true,
      message: "Team member details updated successfully",
      team,
    });
  }
);

// Get events available for college editing (all events the college has registrations for + available events)
exports.getCollegeEventsForEdit = catchAsyncError(async (req, res, next) => {
  const userId = req.user._id;

  // Get user details to find their college
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorHandler("User not found", 404));
  }

  try {
    // Get all active events
    const allEvents = await Event.find({
      isActive: true,
      isArchived: false,
    }).select("_id event_name event_type description");

    // Get all events that the college has registrations for
    const collegeRegistrations = await EventRegistration.find({
      collegeName: user.college,
      isActive: true,
    }).distinct("eventId");

    // Also get team events from Teams collection
    const collegeTeamEvents = await Teams.find({
      collegeName: user.college,
      isRegistered: true,
    }).distinct("eventId");

    // Combine all event IDs that the college has registered for
    const registeredEventIds = [
      ...new Set([
        ...collegeRegistrations.map((id) => id.toString()),
        ...collegeTeamEvents.map((id) => id.toString()),
      ]),
    ];

    // Format events with additional info
    const formattedEvents = allEvents.map((event) => ({
      _id: event._id,
      name: event.event_name,
      event_name: event.event_name,
      event_type: event.event_type,
      description: event.description,
      isRegisteredByCollege: registeredEventIds.includes(event._id.toString()),
      displayName: `${event.event_name} (${event.event_type.toUpperCase()})`,
    }));

    // Sort events: college registered events first, then available events
    formattedEvents.sort((a, b) => {
      if (a.isRegisteredByCollege && !b.isRegisteredByCollege) return -1;
      if (!a.isRegisteredByCollege && b.isRegisteredByCollege) return 1;
      return a.name.localeCompare(b.name);
    });

    res.status(200).json({
      success: true,
      events: formattedEvents,
      message: "College events fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching college events:", error);
    return next(new ErrorHandler("Failed to fetch events", 500));
  }
});

// Get detailed registration info for editing (including all participant fields)
exports.getRegistrationDetails = catchAsyncError(async (req, res, next) => {
  const { registrationId } = req.params;
  const userId = req.user._id;

  try {
    // First check if it's a solo registration
    const soloRegistration = await EventRegistration.findById(registrationId)
      .populate("registrantId", "name email college mobile")
      .populate("eventId", "event_name event_type");

    if (soloRegistration) {
      // Check if user has permission to view this registration
      const user = await User.findById(userId);
      if (
        soloRegistration.collegeName !== user.college &&
        user.role !== "admin"
      ) {
        return next(
          new ErrorHandler(
            "You don't have permission to view this registration",
            403
          )
        );
      }

      return res.status(200).json({
        success: true,
        registration: soloRegistration,
        type: "solo",
      });
    }

    // If not found as solo, check if it's a team registration
    const teamRegistration = await Teams.findById(registrationId)
      .populate("registrantId", "name email college mobile")
      .populate("eventId", "event_name event_type")
      .populate("members.userId", "name email mobile");

    if (teamRegistration) {
      // Check if user has permission to view this team
      const user = await User.findById(userId);
      if (
        teamRegistration.collegeName !== user.college &&
        user.role !== "admin"
      ) {
        return next(
          new ErrorHandler("You don't have permission to view this team", 403)
        );
      }

      return res.status(200).json({
        success: true,
        registration: teamRegistration,
        type: "team",
      });
    }

    return next(new ErrorHandler("Registration not found", 404));
  } catch (error) {
    console.error("Error fetching registration details:", error);
    return next(new ErrorHandler("Failed to fetch registration details", 500));
  }
});
