const Teams = require("../models/teams");
const Events = require("../models/events");
const Users = require("../models/users");
const Invites = require("../models/invites");
const mongoose = require("mongoose");
const catchAsyncError = require("../middlewares/catchAsyncError");

// Helper function to check if user is already registered for an event
const isUserRegisteredForEvent = async (userId, eventId) => {
  // Check if user is in any registered team for this event
  console.log("[USER ID DEBUG]User id within function call: ", userId);
  const registeredTeam = await Teams.findOne({
    eventId,
    isRegistered: true,
    $or: [{ leader: userId }, { "members.userId": userId }],
  });

  if (registeredTeam) {
    return true;
  }

  // Check if user is registered for solo event
  const event = await Events.findById(eventId);
  if (event) {
    const soloRegistration = event.applications.find(
      (app) =>
        app.userId && app.userId.toString() === userId.toString() && !app.teamId
    );

    if (soloRegistration) {
      return true;
    }
  }

  return false;
};

// Helper function to determine team gender based on leader
const determineTeamGender = (leaderGender) => {
  if (leaderGender === "Male") return "Male";
  if (leaderGender === "Female") return "Female";
  return "Mixed";
};

// Helper function to check if adding a user would violate gender restrictions
const checkGenderCompatibility = async (eventId, teamId, userId) => {
  const event = await Events.findById(eventId);
  if (!event || !event.hasGenderBasedTeams) {
    return { compatible: true };
  }

  const team = await Teams.findById(teamId);
  if (!team) {
    return { compatible: false, message: "Team not found" };
  }

  const user = await Users.findById(userId);
  if (!user) {
    return { compatible: false, message: "User not found" };
  }

  // If team already has a gender assigned, check compatibility
  if (team.teamGender && team.teamGender !== "Mixed") {
    if (team.teamGender === "Male" && user.gender !== "Male") {
      return {
        compatible: false,
        message: "Boys can only be added to boy teams in this event",
      };
    }
    if (team.teamGender === "Female" && user.gender !== "Female") {
      return {
        compatible: false,
        message: "Girls can only be added to girl teams in this event",
      };
    }
  }

  return { compatible: true };
};

// Helper function to check gender-based team limits
const checkGenderBasedTeamLimits = async (eventId, teamGender) => {
  const event = await Events.findById(eventId);
  if (!event || !event.hasGenderBasedTeams) {
    return { withinLimits: true };
  }

  const registeredTeamsCount = await Teams.countDocuments({
    eventId,
    teamGender,
    isRegistered: true,
  });

  if (teamGender === "Male" && event.maxBoyTeams) {
    if (registeredTeamsCount >= event.maxBoyTeams) {
      return {
        withinLimits: false,
        message: `Maximum limit of ${event.maxBoyTeams} boy teams reached for this event`,
      };
    }
  }

  if (teamGender === "Female" && event.maxGirlTeams) {
    if (registeredTeamsCount >= event.maxGirlTeams) {
      return {
        withinLimits: false,
        message: `Maximum limit of ${event.maxGirlTeams} girl teams reached for this event`,
      };
    }
  }

  return { withinLimits: true };
};

// Create a team for group events
const createTeam = catchAsyncError(async (req, res) => {
  const { eventId, teamName } = req.body;
  const userId = req.user._id;

  // Check if event exists and is a group event
  const event = await Events.findById(eventId);
  if (!event) {
    return res.status(404).json({ success: false, message: "Event not found" });
  }

  if (event.event_type !== "group") {
    return res.status(400).json({
      success: false,
      message: "Teams can only be created for group events",
    });
  }

  // Check if user is already registered for this event
  const isAlreadyRegistered = await isUserRegisteredForEvent(userId, eventId);
  if (isAlreadyRegistered) {
    return res.status(400).json({
      success: false,
      message:
        "You are already registered for this event and cannot create a new team",
    });
  }

  // Check if user already has a team for this event (including unregistered teams)
  const existingTeam = await Teams.findOne({
    eventId,
    $or: [{ leader: userId }, { "members.userId": userId }],
  });

  if (existingTeam) {
    return res.status(400).json({
      success: false,
      message: "You are already part of a team for this event",
    });
  }

  // Get leader information to determine team gender
  const leader = await Users.findById(userId);
  if (!leader) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  // Determine team gender for gender-based events
  let teamGender = null;
  if (event.hasGenderBasedTeams) {
    teamGender = determineTeamGender(leader.gender);
  }

  const team = await Teams.create({
    eventId,
    teamName,
    leader: userId,
    members: [{ userId }],
    maxMembers: event.maxTeamSize,
    teamGender,
  });

  await team.populate([
    { path: "leader", select: "name email" },
    { path: "members.userId", select: "name email" },
    { path: "eventId", select: "name event_type maxTeamSize" },
  ]);

  res.status(201).json({
    success: true,
    message: "Team created successfully",
    team,
  });
});

// Create team and send invites in one call
const createTeamWithInvites = catchAsyncError(async (req, res) => {
  const { eventId, teamName, userIds } = req.body;
  const userId = req.user._id;

  // Validate event
  const event = await Events.findById(eventId);
  if (!event) {
    return res.status(404).json({ success: false, message: "Event not found" });
  }

  if (event.event_type !== "group") {
    return res.status(400).json({
      success: false,
      message: "This event is not a group event",
    });
  }

  // Check registration deadline
  if (event.registrationDeadline && new Date() > event.registrationDeadline) {
    return res.status(400).json({
      success: false,
      message: "Registration deadline has passed",
    });
  }

  // Check if user is already in a team for this event
  const existingTeam = await Teams.findOne({
    eventId,
    $or: [{ leader: userId }, { "members.userId": userId }],
    isInvalidated: { $ne: true }, // Exclude invalidated teams
  });

  if (existingTeam) {
    return res.status(400).json({
      success: false,
      message:
        "You are already part of a team for this event. Please leave your current team first.",
    });
  }

  // Create the team
  const team = new Teams({
    teamName,
    eventId,
    leader: userId,
    members: [{ userId, role: "leader" }],
    isRegistered: false,
    maxMembers: event.maxTeamSize,
  });

  await team.save();

  // Send invites if userIds provided
  const inviteResults = [];
  const errors = [];

  if (userIds && userIds.length > 0) {
    for (const inviteeId of userIds) {
      try {
        // Check if user exists
        const invitee = await Users.findById(inviteeId);
        if (!invitee) {
          errors.push(`User not found for ID: ${inviteeId}`);
          continue;
        }

        // Prevent inviting admins
        if (invitee.role === "admin") {
          errors.push(
            `Cannot invite ${invitee.name} - admins cannot be invited to teams`
          );
          continue;
        }

        // Prevent self-invitation
        if (inviteeId.toString() === userId.toString()) {
          errors.push(`You cannot invite yourself`);
          continue;
        }

        // Check if user is already in a team for this event
        const userExistingTeam = await Teams.findOne({
          eventId,
          $or: [{ leader: inviteeId }, { "members.userId": inviteeId }],
        });

        if (userExistingTeam) {
          errors.push(
            `${invitee.name} is already part of a team for this event`
          );
          continue;
        }

        // Check if invite already exists
        const existingInvite = await Invites.findOne({
          teamId: team._id,
          inviteeId,
          status: "pending",
        });

        if (existingInvite) {
          errors.push(`${invitee.name} has already been invited to this team`);
          continue;
        }

        // Create invite
        const invite = new Invites({
          teamId: team._id,
          inviterId: userId,
          inviteeId,
          eventId,
          status: "pending",
        });

        await invite.save();
        inviteResults.push({
          inviteeId,
          inviteeName: invitee.name,
          status: "sent",
        });
      } catch (error) {
        errors.push(`Error inviting user ${inviteeId}: ${error.message}`);
      }
    }
  }

  const populatedTeam = await Teams.findById(team._id)
    .populate("eventId", "eventName eventType")
    .populate("leader", "name email")
    .populate("members.userId", "name email");

  res.status(201).json({
    success: true,
    message: "Team created successfully",
    team: populatedTeam,
    invites: {
      sent: inviteResults,
      errors: errors.length > 0 ? errors : undefined,
    },
  });
});

// Send in-app invite to users
const inviteToTeam = catchAsyncError(async (req, res) => {
  console.log("[inviteToTeam] Raw request data:", {
    body: req.body,
    user: req.user ? { _id: req.user._id, email: req.user.email } : "No user",
  });

  const { teamId, userIds } = req.body; // userIds instead of emails
  const userId = req.user._id;

  console.log("[inviteToTeam] Starting invite process:", {
    teamId,
    userIds,
    userId: userId ? userId.toString() : "undefined",
    userIdsType: typeof userIds,
    userIdsLength: userIds?.length,
  });

  const team = await Teams.findById(teamId).populate("eventId");
  if (!team) {
    return res.status(404).json({ success: false, message: "Team not found" });
  }

  // Check if user is team leader or member
  const isLeaderOrMember =
    team.leader.toString() === userId.toString() ||
    team.members.some(
      (member) => member.userId.toString() === userId.toString()
    );

  if (!isLeaderOrMember) {
    return res.status(403).json({
      success: false,
      message: "Only team members can invite others",
    });
  }

  if (team.isRegistered) {
    return res.status(400).json({
      success: false,
      message: "Cannot invite to a registered team",
    });
  }

  const invites = [];
  const errors = [];

  for (const inviteeId of userIds) {
    try {
      console.log(
        `[inviteToTeam] Processing invitation for user ID: ${inviteeId}`
      );

      // Validate user ID format
      if (!mongoose.Types.ObjectId.isValid(inviteeId)) {
        console.log(`[inviteToTeam] Invalid user ID format: ${inviteeId}`);
        errors.push(`Invalid user ID format: ${inviteeId}`);
        continue;
      }

      // Check if user exists
      const invitee = await Users.findById(inviteeId);
      console.log(
        `[inviteToTeam] User lookup result for ${inviteeId}:`,
        invitee ? `Found: ${invitee.name}` : "Not found"
      );

      if (!invitee) {
        errors.push(`User with ID ${inviteeId} not found`);
        continue;
      }

      // Prevent inviting admins
      if (invitee.role === "admin") {
        errors.push(
          `Cannot invite ${invitee.name} - admins cannot be invited to teams`
        );
        continue;
      }

      // Prevent self-invitation
      if (inviteeId.toString() === userId.toString()) {
        errors.push(`You cannot invite yourself`);
        continue;
      }

      // Check if user is already registered for this event
      const isAlreadyRegistered = await isUserRegisteredForEvent(
        inviteeId,
        team.eventId._id
      );
      if (isAlreadyRegistered) {
        errors.push(
          `Cannot invite ${invitee.name} - they are already registered for this event`
        );
        continue;
      }

      // Check if already in team
      const alreadyInTeam = team.members.some(
        (member) => member.userId.toString() === inviteeId.toString()
      );

      if (alreadyInTeam) {
        errors.push(`${invitee.name} is already in the team`);
        continue;
      }

      // Check if already invited
      const existingInvite = await Invites.findOne({
        teamId,
        inviteeId: inviteeId,
        status: "pending",
      });

      if (existingInvite) {
        errors.push(`${invitee.name} already has a pending invite`);
        continue;
      }

      // Check team capacity
      const currentMembers = team.members.length;
      const pendingInvites = await Invites.countDocuments({
        teamId,
        status: "pending",
      });

      if (currentMembers + pendingInvites >= team.maxMembers) {
        errors.push(`Team is full or has too many pending invites`);
        break;
      }

      // Check gender compatibility for gender-based events
      const genderCheck = await checkGenderCompatibility(
        team.eventId._id,
        teamId,
        inviteeId
      );
      if (!genderCheck.compatible) {
        errors.push(`Cannot invite ${invitee.name} - ${genderCheck.message}`);
        continue;
      }

      // Create invite
      console.log("[inviteToTeam] Creating invite with data:", {
        eventId: team.eventId._id,
        teamId,
        inviterId: userId,
        inviteeId: inviteeId,
        userIdType: typeof userId,
        inviteeIdType: typeof inviteeId,
        userIdString: userId?.toString(),
        inviteeIdString: inviteeId?.toString(),
      });

      const invite = await Invites.create({
        eventId: team.eventId._id,
        teamId,
        inviterId: userId,
        inviteeId: inviteeId,
        message: `wants to invite you to join their team "${team.teamName}" for ${team.eventId.name}`,
      });

      console.log(
        "[inviteToTeam] Created invite:",
        invite._id,
        "for user:",
        inviteeId
      );

      invites.push(invite);
    } catch (error) {
      console.error(
        `[inviteToTeam] Error processing invite for user ${inviteeId}:`,
        error
      );
      errors.push(`Failed to invite user ${inviteeId}: ${error.message}`);
    }
  }

  console.log(
    `[inviteToTeam] Summary - Successful invites: ${invites.length}, Errors: ${errors.length}`
  );
  if (errors.length > 0) {
    console.log(`[inviteToTeam] Errors encountered:`, errors);
  }

  res.status(200).json({
    success: true,
    message: `Sent ${invites.length} invites`,
    invites: invites.length,
    errors,
  });
});

// Accept/Decline invite
const respondToInvite = catchAsyncError(async (req, res) => {
  const { inviteId } = req.params;
  const { response } = req.body; // "accept" or "decline"
  const userId = req.user._id;

  const invite = await Invites.findById(inviteId).populate([
    {
      path: "teamId",
      populate: { path: "eventId", select: "name event_type" },
    },
    { path: "inviterId", select: "name email" },
  ]);

  if (!invite) {
    return res
      .status(404)
      .json({ success: false, message: "Invite not found" });
  }

  if (invite.inviteeId.toString() !== userId.toString()) {
    return res.status(403).json({
      success: false,
      message: "This invite is not for you",
    });
  }

  if (invite.status !== "pending") {
    return res.status(400).json({
      success: false,
      message: "Invite has already been responded to",
    });
  }

  if (response === "accept") {
    // Check if user is already registered for this event
    const isAlreadyRegistered = await isUserRegisteredForEvent(
      userId,
      invite.teamId.eventId._id
    );
    if (isAlreadyRegistered) {
      return res.status(400).json({
        success: false,
        message:
          "You are already registered for this event and cannot accept new invitations",
      });
    }

    // Check if team still has space
    const team = await Teams.findById(invite.teamId._id);
    const currentMembers = team.members.length;
    const event = await Events.findById(team.eventId);
    console.log("[Max members]", event.maxTeamSize);
    if (currentMembers >= event.maxTeamSize) {
      return res.status(400).json({
        success: false,
        message: "Team is already full",
      });
    }

    // Check if user is already in another team for this event
    const existingTeam = await Teams.findOne({
      eventId: invite.eventId,
      $or: [{ leader: userId }, { "members.userId": userId }],
    });

    if (existingTeam && existingTeam._id.toString() !== team._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "You are already part of another team for this event",
      });
    }

    // Add user to team
    await Teams.findByIdAndUpdate(invite.teamId._id, {
      $push: {
        members: {
          userId,
          joinedAt: new Date(),
        },
      },
    });

    // Update invite
    await Invites.findByIdAndUpdate(invite._id, {
      status: "accepted",
      respondedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      message: "Successfully joined the team",
      team: invite.teamId,
    });
  } else if (response === "decline") {
    await Invites.findByIdAndUpdate(invite._id, {
      status: "declined",
      respondedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      message: "Invite declined",
    });
  } else {
    res.status(400).json({
      success: false,
      message: "Invalid response. Use 'accept' or 'decline'",
    });
  }
});

// Register team for event (simplified - no status checks)
const registerTeam = catchAsyncError(async (req, res) => {
  const { teamId } = req.body;
  const userId = req.user._id;

  console.log(
    `[registerTeam] User ${userId} attempting to register team ${teamId}`
  );

  const team = await Teams.findById(teamId).populate([
    {
      path: "eventId",
      select:
        "name event_type maxApplications applications applicationDeadline minTeamSize maxTeamSize",
    },
    { path: "leader", select: "name email" },
    { path: "members.userId", select: "name email" },
  ]);

  if (!team) {
    return res.status(404).json({ success: false, message: "Team not found" });
  }

  // Check if user is team member
  const isMember = team.members.some(
    (member) => member.userId._id.toString() === userId.toString()
  );

  if (!isMember) {
    return res.status(403).json({
      success: false,
      message: "Only team members can register the team",
    });
  }

  if (team.isRegistered) {
    return res.status(400).json({
      success: false,
      message: "Team is already registered",
    });
  }

  // Check if event has space (count registered teams, not applications)
  const event = team.eventId;
  if (event.maxApplications) {
    const registeredTeamsCount = await Teams.countDocuments({
      eventId: event._id,
      isRegistered: true,
    });
    if (registeredTeamsCount >= event.maxApplications) {
      return res.status(400).json({
        success: false,
        message: "Event is full",
      });
    }
  }

  // Check gender-based team limits for specific events
  if (event.hasGenderBasedTeams && team.teamGender) {
    const genderLimitCheck = await checkGenderBasedTeamLimits(
      event._id,
      team.teamGender
    );
    if (!genderLimitCheck.withinLimits) {
      return res.status(400).json({
        success: false,
        message: genderLimitCheck.message,
      });
    }
  }

  // Check registration deadline
  if (
    event.applicationDeadline &&
    new Date() > new Date(event.applicationDeadline)
  ) {
    return res.status(400).json({
      success: false,
      message: "Registration deadline has passed",
    });
  }

  // Check if team meets minimum size requirement
  const minMembers = event.minTeamSize || 2;
  console.log(
    `[registerTeam] Team ${teamId} has ${team.members.length} members, minimum required: ${minMembers}`
  );

  if (team.members.length < minMembers) {
    console.log(
      `[registerTeam] Team ${teamId} registration failed - insufficient members`
    );
    return res.status(400).json({
      success: false,
      message: `Team needs at least ${minMembers} members to register`,
    });
  }

  // Register all team members in the event
  const memberIds = team.members.map((m) => m.userId._id);

  await Events.findByIdAndUpdate(event._id, {
    $push: {
      applications: {
        $each: memberIds.map((userId) => ({
          userId,
          teamId: team._id,
          appliedAt: new Date(),
        })),
      },
    },
  });

  // Mark team as registered
  await Teams.findByIdAndUpdate(teamId, {
    isRegistered: true,
    registeredAt: new Date(),
    registeredBy: userId,
  });

  // Invalidate all other teams for this event that contain any of the registered members
  await Teams.updateMany(
    {
      eventId: event._id,
      _id: { $ne: teamId }, // Exclude the current team
      $or: [
        { leader: { $in: memberIds } },
        { "members.userId": { $in: memberIds } },
      ],
      isRegistered: false, // Only update teams that haven't been registered yet
    },
    {
      $set: {
        isInvalidated: true,
        invalidatedAt: new Date(),
        invalidatedReason: "Member registered with another team",
      },
    }
  );

  res.status(200).json({
    success: true,
    message: "Team registered successfully",
    team,
  });
});

// Get user's teams
const getUserTeams = catchAsyncError(async (req, res) => {
  const userId = req.user._id;

  const teams = await Teams.find({
    $or: [{ leader: userId }, { "members.userId": userId }],
    isInvalidated: { $ne: true }, // Exclude invalidated teams
  }).populate([
    { path: "eventId", select: "name event_type applicationDeadline" },
    { path: "leader", select: "name email" },
    { path: "members.userId", select: "name email" },
  ]);

  res.status(200).json({
    success: true,
    teams,
  });
});

// Get user's teams for a specific event
const getUserTeamsForEvent = catchAsyncError(async (req, res) => {
  const userId = req.user._id;
  const { eventId } = req.params;

  const teams = await Teams.find({
    eventId,
    $or: [{ leader: userId }, { "members.userId": userId }],
    isInvalidated: { $ne: true }, // Exclude invalidated teams
  }).populate([
    {
      path: "eventId",
      select: "name event_type applicationDeadline minTeamSize maxTeamSize",
    },
    { path: "leader", select: "name email" },
    { path: "members.userId", select: "name email" },
  ]);

  res.status(200).json({
    success: true,
    teams,
  });
});

// Get team details
const getTeam = catchAsyncError(async (req, res) => {
  const { teamId } = req.params;
  const userId = req.user._id;
  console.log("[TEAM]:Asking for team");
  const team = await Teams.findById(teamId).populate([
    {
      path: "eventId",
      select: "name event_type maxTeamSize minTeamSize applicationDeadline",
    },
    { path: "leader", select: "name email" },
    { path: "members.userId", select: "name email" },
  ]);

  if (!team) {
    return res.status(404).json({ success: false, message: "Team not found" });
  }

  // Check if user has access to view this team
  const hasAccess =
    team.leader._id.toString() === userId.toString() ||
    team.members.some((m) => m.userId._id.toString() === userId.toString());

  if (!hasAccess) {
    return res.status(403).json({
      success: false,
      message: "Access denied",
    });
  }

  res.status(200).json({
    success: true,
    team,
  });
});

// Get user's notifications (pending invites)
const getUserNotifications = catchAsyncError(async (req, res) => {
  const userId = req.user._id;

  console.log("[getUserNotifications] Called for user:", userId);

  const invites = await Invites.find({
    inviteeId: userId,
    status: "pending",
  })
    .populate([
      {
        path: "teamId",
        select: "teamName",
        populate: {
          path: "eventId",
          select: "name event_type",
        },
      },
      { path: "inviterId", select: "name email" },
    ])
    .sort({ createdAt: -1 });

  console.log(
    "[getUserNotifications] Found",
    invites.length,
    "invites for user:",
    userId
  );

  res.status(200).json({
    success: true,
    invites,
    count: invites.length,
  });
});

// Mark notification as read
const markNotificationAsRead = catchAsyncError(async (req, res) => {
  const { inviteId } = req.params;
  const userId = req.user._id;

  const invite = await Invites.findOne({
    _id: inviteId,
    inviteeId: userId,
  });

  if (!invite) {
    return res
      .status(404)
      .json({ success: false, message: "Invite not found" });
  }

  await Invites.findByIdAndUpdate(inviteId, { isRead: true });

  res.status(200).json({
    success: true,
    message: "Notification marked as read",
  });
});

// Delete/Discard a team
const deleteTeam = catchAsyncError(async (req, res) => {
  const { teamId } = req.params;
  const userId = req.user._id;

  const team = await Teams.findById(teamId).populate("eventId");

  if (!team) {
    return res.status(404).json({ success: false, message: "Team not found" });
  }

  // Only team leader can delete the team
  if (team.leader.toString() !== userId.toString()) {
    return res.status(403).json({
      success: false,
      message: "Only team leader can delete the team",
    });
  }

  // Cannot delete registered teams
  if (team.isRegistered) {
    return res.status(400).json({
      success: false,
      message: "Cannot delete a registered team",
    });
  }

  // Delete all pending invites for this team
  await Invites.deleteMany({ teamId: team._id });

  // Delete the team
  await Teams.findByIdAndDelete(teamId);

  res.status(200).json({
    success: true,
    message: "Team deleted successfully",
  });
});

// Leave a team (remove specific user from team)
const leaveTeam = catchAsyncError(async (req, res) => {
  const { teamId } = req.params;
  const userId = req.user._id;

  const team = await Teams.findById(teamId).populate("eventId");

  if (!team) {
    return res.status(404).json({ success: false, message: "Team not found" });
  }

  // Check if user is a member of the team
  const isMember = team.members.some(
    (member) => member.userId.toString() === userId.toString()
  );

  if (!isMember) {
    return res.status(403).json({
      success: false,
      message: "You are not a member of this team",
    });
  }

  // Cannot leave registered teams
  if (team.isRegistered) {
    return res.status(400).json({
      success: false,
      message: "Cannot leave a registered team",
    });
  }

  // If the user is the team leader and there are other members, transfer leadership
  if (team.leader.toString() === userId.toString() && team.members.length > 1) {
    // Find the first non-leader member to make the new leader
    const newLeader = team.members.find(
      (member) => member.userId.toString() !== userId.toString()
    );

    if (newLeader) {
      await Teams.findByIdAndUpdate(teamId, {
        leader: newLeader.userId,
      });
    }
  }

  // Remove the user from the team
  await Teams.findByIdAndUpdate(teamId, {
    $pull: {
      members: { userId: userId },
    },
  });

  // If this was the last member, delete the team and its invites
  const updatedTeam = await Teams.findById(teamId);
  if (updatedTeam.members.length === 0) {
    await Invites.deleteMany({ teamId: team._id });
    await Teams.findByIdAndDelete(teamId);

    return res.status(200).json({
      success: true,
      message:
        "Left team successfully. Team was deleted as you were the last member.",
    });
  }

  res.status(200).json({
    success: true,
    message: "Left team successfully",
  });
});

// Add members to existing team
const addMembersToTeam = catchAsyncError(async (req, res) => {
  const { teamId } = req.params;
  const { userIds } = req.body;
  const currentUserId = req.user._id;

  // Find the team
  const team = await Teams.findById(teamId)
    .populate("leader", "name email")
    .populate("members.userId", "name email");
  if (!team) {
    return res.status(404).json({ success: false, message: "Team not found" });
  }

  // Check if current user is the team leader
  if (team.leader._id.toString() !== currentUserId.toString()) {
    return res.status(403).json({
      success: false,
      message: "Only team leaders can add members",
    });
  }

  // Check if team is already registered
  if (team.isRegistered) {
    return res.status(400).json({
      success: false,
      message: "Cannot add members to a registered team",
    });
  }

  // Get event details for team size limits
  const event = await Events.findById(team.eventId);
  if (!event) {
    return res.status(404).json({ success: false, message: "Event not found" });
  }

  // Check if adding new members would exceed team limit
  const currentMemberCount = team.members.length;
  const newMemberCount = userIds.length;
  const totalAfterAddition = currentMemberCount + newMemberCount;

  if (totalAfterAddition > event.maxTeamSize) {
    return res.status(400).json({
      success: false,
      message: `Adding ${newMemberCount} members would exceed the maximum team size of ${event.maxTeamSize}. Current team has ${currentMemberCount} members.`,
    });
  }

  const inviteResults = {
    sent: [],
    errors: [],
  };

  // Process each user
  for (const userId of userIds) {
    try {
      // Check if user exists
      const user = await Users.findById(userId);
      if (!user) {
        inviteResults.errors.push(`User with ID ${userId} not found`);
        continue;
      }

      // Check if user is already in this team
      const isAlreadyMember = team.members.some(
        (member) => member.userId._id.toString() === userId.toString()
      );

      if (isAlreadyMember) {
        inviteResults.errors.push(`${user.name} is already a team member`);
        continue;
      }

      // Check if user is the team leader
      if (team.leader._id.toString() === userId.toString()) {
        inviteResults.errors.push(`${user.name} is already the team leader`);
        continue;
      }

      // Check if user already has a team for this event
      const existingTeam = await Teams.findOne({
        eventId: team.eventId,
        $or: [{ leader: userId }, { "members.userId": userId }],
      });

      if (existingTeam) {
        inviteResults.errors.push(
          `${user.name} is already part of another team for this event`
        );
        continue;
      }

      // Check if user is already registered for this event (solo)
      const isAlreadyRegistered = await isUserRegisteredForEvent(
        userId,
        team.eventId
      );
      if (isAlreadyRegistered) {
        inviteResults.errors.push(
          `${user.name} is already registered for this event`
        );
        continue;
      }

      // Check if there's already a pending invite
      const existingInvite = await Invites.findOne({
        teamId: teamId,
        inviteeId: userId,
        status: "pending",
      });

      if (existingInvite) {
        inviteResults.errors.push(
          `${user.name} already has a pending invite for this team`
        );
        continue;
      }

      // Create invite
      const invite = new Invites({
        teamId: teamId,
        inviterId: currentUserId,
        inviteeId: userId,
        eventId: team.eventId,
        status: "pending",
      });

      await invite.save();
      inviteResults.sent.push(user.name);
    } catch (error) {
      console.error(`Error processing invite for user ${userId}:`, error);
      inviteResults.errors.push(`Failed to invite user with ID ${userId}`);
    }
  }

  res.status(200).json({
    success: true,
    message: "Member invites processed",
    invites: inviteResults,
  });
});

// Cancel a team invite
const cancelInvite = catchAsyncError(async (req, res) => {
  const { inviteId } = req.params;
  const userId = req.user._id;

  // Find the invite
  const invite = await Invites.findById(inviteId).populate("teamId");
  if (!invite) {
    return res.status(404).json({
      success: false,
      message: "Invite not found",
    });
  }

  // Check if the user is the team leader (only team leader can cancel invites)
  if (invite.teamId.leader.toString() !== userId.toString()) {
    return res.status(403).json({
      success: false,
      message: "Only team leader can cancel invites",
    });
  }

  // Check if invite is still pending
  if (invite.status !== "pending") {
    return res.status(400).json({
      success: false,
      message: "Can only cancel pending invites",
    });
  }

  // Delete the invite
  await Invites.findByIdAndDelete(inviteId);

  res.status(200).json({
    success: true,
    message: "Invite cancelled successfully",
  });
});

// Get gender-based team statistics for an event
const getGenderBasedTeamStats = catchAsyncError(async (req, res) => {
  const { eventId } = req.params;

  const event = await Events.findById(eventId);
  if (!event) {
    return res.status(404).json({ success: false, message: "Event not found" });
  }

  if (!event.hasGenderBasedTeams) {
    return res.status(200).json({
      success: true,
      hasGenderBasedTeams: false,
      stats: null,
    });
  }
  const teams = await Teams.find({
    eventId,
    isRegistered: true,
  }).populate([
    { path: "members.userId", select: "gender" },
    { path: "leader", select: "gender" },
  ]);
  let boyTeamsCount = 0,
    girlTeamsCount = 0;
  // Count registered teams by gender
  // const boyTeamsCount = await Teams.countDocuments({
  //   eventId,
  //   teamGender: "Male",
  //   isRegistered: true,
  // });

  // const girlTeamsCount = await Teams.countDocuments({
  //   eventId,
  //   teamGender: "Female",
  //   isRegistered: true,
  // });
  for (const team of teams) {
    let gender = team.teamGender;
    if (!gender || gender === "Mixed") {
      let leaderGender = team.leader?.gender;
      if (leaderGender === "Male" || leaderGender === "Female")
        gender = leaderGender;
      else {
        const firstMember = team.members[0]?.userId;
        if (
          firstMember &&
          (firstMember.gender === "Male" || firstMember.gender === "Female")
        )
          gender = firstMember.gender;
      }
    }
    if (gender && gender !== "Mixed")
      await Teams.findByIdAndUpdate(team._id, { teamGender: gender });
    if (gender === "Male") boyTeamsCount++;
    if (gender === "Female") girlTeamsCount++;
  }

  const stats = {
    boyTeams: {
      registered: boyTeamsCount,
      max: event.maxBoyTeams || 0,
      remaining: Math.max(0, (event.maxBoyTeams || 0) - boyTeamsCount),
    },
    girlTeams: {
      registered: girlTeamsCount,
      max: event.maxGirlTeams || 0,
      remaining: Math.max(0, (event.maxGirlTeams || 0) - girlTeamsCount),
    },
  };
  console.log("[Gender stats sent]: ", stats);
  console.log("[BoyTeamsCount]: ", boyTeamsCount);
  console.log("[GirlTeamsCount]: ", girlTeamsCount);
  res.status(200).json({
    success: true,
    hasGenderBasedTeams: true,
    stats,
  });
});

module.exports = {
  createTeam,
  createTeamWithInvites,
  inviteToTeam,
  respondToInvite,
  registerTeam,
  getUserTeams,
  getUserTeamsForEvent,
  getTeam,
  deleteTeam,
  leaveTeam,
  addMembersToTeam,
  getUserNotifications,
  markNotificationAsRead,
  cancelInvite,
  getGenderBasedTeamStats,
};
