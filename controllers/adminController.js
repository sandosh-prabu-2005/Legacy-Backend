const catchAsyncError = require("../middlewares/catchAsyncError");
const ErrorHandler = require("../utils/errorHandler");
const mongoose = require("mongoose");

console.log("=== AdminController loaded with NEW updateEventWinners function ===", new Date().toISOString());

const EventModel = require("../models/events");
const UserModel = require("../models/users");
const TeamModel = require("../models/teams");
const EventRegistration = require("../models/eventRegistrations");
const sendEmail = require("../utils/email");
const crypto = require("crypto");

// Create a new event (Admin only)
const createEvent = catchAsyncError(async (req, res, next) => {
  const {
    name,
    staff_incharges,
    rules,
    description,
    event_type,
    clubInCharge,
    venue,
    event_date,
    registration_deadline,
    maxApplications,
    applicationDeadline,
    organizing_club,
    coordinatorName,
    coordinatorDept,
    minTeamSize,
    maxTeamSize,
    registrationAmount,
  } = req.body;

  if (!name) {
    return next(new ErrorHandler("Event name is required", 400));
  }

  // Determine club for the event. Super admins can choose, club admins use their own club.
  let eventClub;
  if (req.user.isSuperAdmin) {
    eventClub = clubInCharge || req.user.club || "";
  } else {
    if (!req.user.club) {
      return next(
        new ErrorHandler("Admin must belong to a club to create events", 400)
      );
    }
    eventClub = req.user.club;
  }

  // Generate slug/identifier from name. If duplicate exists, append a counter.
  const generateEventId = (name) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, "-")
      .trim();
  };
  let event_id = generateEventId(name);
  let counter = 1;
  const originalEventId = event_id;
  while (await EventModel.findOne({ event_id })) {
    event_id = `${originalEventId}-${counter}`;
    counter++;
  }

  // Derive min/max team sizes based on event type if not provided
  const finalMinTeamSize =
    typeof minTeamSize === "number"
      ? minTeamSize
      : event_type === "group"
      ? 2
      : 1;
  const finalMaxTeamSize =
    typeof maxTeamSize === "number"
      ? maxTeamSize
      : event_type === "group"
      ? 6
      : 1;

  // Parse registration fee to number. Default to 0 if not provided.
  const fee = parseFloat(registrationAmount);
  const safeFee = isNaN(fee) ? 0 : Math.max(fee, 0);

  // Build payload for new event
  const payload = {
    event_id,
    name,
    event_type: event_type || "solo",
    clubInCharge: eventClub,
    organizing_club: organizing_club || eventClub || "",
    coordinatorName: coordinatorName || "",
    coordinatorDept: coordinatorDept || "",
    description: description || "",
    venue: venue || "",
    event_date,
    registration_deadline,
    maxApplications,
    applicationDeadline,
    minTeamSize: finalMinTeamSize,
    maxTeamSize: finalMaxTeamSize,
    rules: Array.isArray(rules) ? rules : rules ? [rules] : [],
    staff_incharges: staff_incharges || [],
    createdBy: req.user.id,
    registrationAmount: safeFee,
  };

  const event = await EventModel.create(payload);

  return res.status(201).json({
    success: true,
    message: "Event created successfully",
    event,
  });
});

// Get all events with applications (Admin only)
const getAllEventsWithApplications = catchAsyncError(async (req, res, next) => {
  // Admins can now view all events (no filter)
  // Edit permissions are handled at the individual operation level

  const events = await EventModel.find()
    .populate({
      path: "applications.userId",
      select: "name email level degree dept year phoneNumber UserId",
    })
    .sort({ createdAt: -1 });
  const eventsWithStats = events.map((event) => ({
    ...event.toObject(),
    applicationCount: event.applications.length,
  }));

  res.status(200).json({
    success: true,
    events: eventsWithStats,
    totalEvents: events.length,
  });
});

const getEventDetails = catchAsyncError(async (req, res, next) => {
  const event = await EventModel.findById(req.params.id).populate({
    path: "applications.userId",
    select: "name email level degree dept year phoneNumber UserId",
  });

  if (!event) {
    return next(new ErrorHandler("Event not found", 404));
  }

  // Check if club admin can access this event
  if (
    !req.user.isSuperAdmin &&
    req.user.club &&
    event.clubInCharge !== req.user.club
  ) {
    return next(
      new ErrorHandler(
        "Access denied: You can only view events from your club",
        403
      )
    );
  }

  res.status(200).json({
    success: true,
    event,
  });
});

// Update an event (Admin only)
const updateEvent = catchAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const updateData = req.body;

  const event = await EventModel.findById(id);
  if (!event) {
    return next(new ErrorHandler("Event not found", 404));
  }

  // Check if club admin can update this event
  if (
    !req.user.isSuperAdmin &&
    req.user.club &&
    event.clubInCharge !== req.user.club
  ) {
    return next(
      new ErrorHandler(
        "Access denied: You can only update events from your club",
        403
      )
    );
  }

  // If club admin, don't allow them to change the clubInCharge
  if (
    !req.user.isSuperAdmin &&
    updateData.clubInCharge &&
    updateData.clubInCharge !== req.user.club
  ) {
    return next(
      new ErrorHandler(
        "Access denied: You cannot transfer events to other clubs",
        403
      )
    );
  }

  // If registrationAmount is provided, coerce to number and ensure non-negative
  if (Object.prototype.hasOwnProperty.call(updateData, "registrationAmount")) {
    const amt = parseFloat(updateData.registrationAmount);
    updateData.registrationAmount = isNaN(amt) ? 0 : Math.max(amt, 0);
  }
  const updatedEvent = await EventModel.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    success: true,
    message: "Event updated successfully",
    event: updatedEvent,
  });
});

// Delete an event (Admin only)
const deleteEvent = catchAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const event = await EventModel.findById(id);
  if (!event) {
    return next(new ErrorHandler("Event not found", 404));
  }

  // Check if club admin can delete this event
  if (
    !req.user.isSuperAdmin &&
    req.user.club &&
    event.clubInCharge !== req.user.club
  ) {
    return next(
      new ErrorHandler(
        "Access denied: You can only delete events from your club",
        403
      )
    );
  }

  await EventModel.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: "Event deleted successfully",
  });
});

// Get all users (Admin only)
const getAllUsers = catchAsyncError(async (req, res, next) => {
  const { page = 1, limit = 10, search = "", role = "" } = req.query;

  const query = {};

  // Add search criteria
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { UserId: { $regex: search, $options: "i" } },
      { club: { $regex: search, $options: "i" } },
    ];
  }

  // Add role filter
  if (role) {
    query.role = role;
  }

  const users = await UserModel.find(query)
    .select("-password -verificationToken -resetPasswordToken")
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .sort({ createdAt: -1 });

  const totalUsers = await UserModel.countDocuments(query);

  res.status(200).json({
    success: true,
    users,
    totalUsers,
    totalPages: Math.ceil(totalUsers / limit),
    currentPage: page,
  });
});

// Update user role (Super Admin only)
const updateUserRole = catchAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { role } = req.body;

  // Only super admin can update user roles
  if (!req.user.isSuperAdmin) {
    return next(
      new ErrorHandler(
        "Access denied: Only super admin can update user roles",
        403
      )
    );
  }

  if (!["user", "admin"].includes(role)) {
    return next(new ErrorHandler("Invalid role specified", 400));
  }

  const user = await UserModel.findById(id);
  if (!user) {
    return next(new ErrorHandler("User not found", 404));
  }

  user.role = role;
  await user.save();

  res.status(200).json({
    success: true,
    message: `User role updated to ${role} successfully`,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

// Generate admin invite link (Super Admin only)
const generateAdminInvite = catchAsyncError(async (req, res, next) => {
  const { email } = req.body;

  // Only super admin can generate admin invites
  if (!req.user.isSuperAdmin) {
    return next(
      new ErrorHandler(
        "Access denied: Only super admin can invite new admins",
        403
      )
    );
  }

  if (!email) {
    return next(new ErrorHandler("Email is required", 400));
  }

  // Check if user already exists
  let user = await UserModel.findOne({ email });

  if (user && user.role === "admin") {
    return next(new ErrorHandler("User is already an admin", 400));
  }

  if (!user) {
    // Create a placeholder user with invite
    user = new UserModel({
      name: "Pending Admin",
      year: "N/A",
      dept: "N/A",
      email,
      password: crypto.randomBytes(32).toString("hex"), // Temp password
      gender: "Other",
      phone: "0000000000",
      role: "user",
      isVerified: false,
      invitedBy: req.user._id,
    });
  }

  const inviteToken = user.generateAdminInviteToken();
  await user.save({ validateBeforeSave: false });

  const inviteUrl = `${
    process.env.FRONTEND_URL || "http://localhost:5174"
  }/admin/invite/${inviteToken}`;

  // Console log the invite URL for easy testing
  console.log("🔗 ADMIN INVITE LINK GENERATED:");
  console.log("📧 Email:", email);
  console.log("🌐 Invite URL:", inviteUrl);
  console.log("⏰ Expires in: 7 days");
  console.log("=".repeat(50));

  res.status(200).json({
    success: true,
    message: "Admin invite generated successfully",
    inviteUrl,
    expiresIn: "7 days",
  });
});

// Send admin invite email (Super Admin only)
const sendAdminInviteEmail = catchAsyncError(async (req, res, next) => {
  const { email, inviteUrl } = req.body;

  // Only super admin can send admin invites
  if (!req.user.isSuperAdmin) {
    return next(
      new ErrorHandler(
        "Access denied: Only super admin can send admin invites",
        403
      )
    );
  }

  if (!email || !inviteUrl) {
    return next(new ErrorHandler("Email and invite URL are required", 400));
  }

  const inviterName = req.user.name;
  const message = `
    Hello,

    You have been invited to become an admin for FIESTA 2025 by ${inviterName}.

    Please click the following link to accept the admin invitation:
    ${inviteUrl}

    This invitation is valid for 7 days. If you don't have an account, you'll be asked to complete your profile.

    📧 If there are any other admins who need to be given access, please reply to this email with their email IDs so that we can send them an invitation too.

    Best regards,
    FIESTA 2025 Team
  `;

  try {
    await sendEmail({
      email,
      subject: "Admin Invitation - FIESTA 2025",
      message,
    });

    // Console log for debugging
    console.log("📧 ADMIN INVITE EMAIL SENT:");
    console.log("📬 To:", email);
    console.log("🔗 URL:", inviteUrl);
    console.log("👤 Sent by:", inviterName);
    console.log("=".repeat(50));

    res.status(200).json({
      success: true,
      message: `Admin invitation sent to ${email}`,
    });
  } catch (error) {
    return next(new ErrorHandler("Email could not be sent", 500));
  }
});

// Accept admin invite
const acceptAdminInvite = catchAsyncError(async (req, res, next) => {
  const { token } = req.params;
  const { name, year, dept, password, gender, phone, club } = req.body;

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const user = await UserModel.findOne({
    adminInviteToken: hashedToken,
    adminInviteTokenExpire: { $gt: Date.now() },
  });

  if (!user) {
    return next(new ErrorHandler("Invalid or expired invitation token", 400));
  }

  // Validate club field for admin role
  if (!club) {
    return next(
      new ErrorHandler("Club field is required for admin users", 400)
    );
  }

  const validClubs = [
    "Blue Sky Forum",
    "Readers' Club",
    "Photography Club",
    "Dance Club",
    "Music Club",
    "Drama Club",
    "Tech Club",
    "Literary Club",
    "Sports Club",
    "Cultural Club",
  ];

  if (!validClubs.includes(club)) {
    return next(new ErrorHandler("Invalid club selected", 400));
  }

  // Update user details if provided (for new users)
  if (name) user.name = name;
  if (dept) user.dept = dept;
  if (password) user.password = password;
  if (gender) user.gender = gender;
  if (phone) user.phone = phone;
  user.club = club;
  user.year = "0"; // Set year to "0" for admin staff

  user.role = "admin";
  user.isVerified = true;
  user.adminInviteToken = undefined;
  user.adminInviteTokenExpire = undefined;

  await user.save();

  res.status(200).json({
    success: true,
    message: "Admin invitation accepted successfully! You are now an admin.",
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      club: user.club,
    },
  });
});

// Get pending admin invites (Admin only)
const getPendingInvites = catchAsyncError(async (req, res, next) => {
  const pendingInvites = await UserModel.find({
    adminInviteToken: { $exists: true },
    adminInviteTokenExpire: { $gt: Date.now() },
  })
    .populate("invitedBy", "name email")
    .select("name email adminInviteTokenExpire invitedBy createdAt");

  res.status(200).json({
    success: true,
    invites: pendingInvites,
    count: pendingInvites.length,
  });
});

// Get dashboard stats (Admin only)
const getDashboardStats = catchAsyncError(async (req, res, next) => {
  const user = req.user;

  // For event-specific admins, filter data by their assigned event
  const isEventSpecificAdmin =
    user.role === "admin" && !user.isSuperAdmin && user.assignedEvent;

  let eventFilter = {};
  let userEventInfo = null;

  if (isEventSpecificAdmin) {
    eventFilter = { _id: user.assignedEvent };

    // Aggregate assigned event details
    const assignedEventId = mongoose.Types.ObjectId.isValid(user.assignedEvent)
      ? new mongoose.Types.ObjectId(user.assignedEvent)
      : user.assignedEvent;

    const aggregated = await EventModel.aggregate([
      { $match: { _id: assignedEventId } },
      {
        $lookup: {
          from: "users",
          localField: "applications.userId",
          foreignField: "_id",
          as: "applicants",
        },
      },
      {
        $lookup: {
          from: "teams",
          localField: "_id",
          foreignField: "eventId",
          as: "eventTeams",
        },
      },
      {
        $project: {
          name: 1,
          event_id: 1,
          clubInCharge: 1,
          event_type: 1,
          startDate: 1,
          endDate: 1,
          createdAt: 1,
          updatedAt: 1,
          maxApplications: 1,
          minTeamSize: 1,
          maxTeamSize: 1,
          winners: 1, // Include the winners field
          winnersUpdatedAt: 1, // Include the winners timestamp
          registrationCount: {
            $cond: {
              if: { $eq: ["$event_type", "group"] },
              then: {
                $size: {
                  $filter: {
                    input: "$eventTeams",
                    cond: { $eq: ["$$this.isRegistered", true] },
                  },
                },
              },
              else: { $size: "$applications" },
            },
          },
          registeredTeamsCount: {
            $size: {
              $filter: {
                input: "$eventTeams",
                cond: { $eq: ["$$this.isRegistered", true] },
              },
            },
          },
          registrations: {
            $map: {
              input: "$applications",
              as: "app",
              in: {
                userId: "$$app.userId",
                teamId: "$$app.teamId",
                registeredAt: "$$app.registeredAt",
                appliedAt: "$$app.appliedAt",
                isWinner: "$$app.isWinner",
                isPresent: "$$app.isPresent",
                winnerRank: "$$app.winnerRank",
                user: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$applicants",
                        cond: { $eq: ["$$this._id", "$$app.userId"] },
                      },
                    },
                    0,
                  ],
                },
              },
            },
          },
          eventTeams: {
            $filter: {
              input: "$eventTeams",
              cond: { $eq: ["$$this.isRegistered", true] },
            },
          },
        },
      },
      { $sort: { createdAt: -1 } },
    ]);

    if (!aggregated || aggregated.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Assigned event not found",
        assignedEvent: [],
      });
    }

    const event = aggregated[0];

    // Populate team leader and members for detailed view
    if (event.eventTeams && event.eventTeams.length > 0) {
      try {
        const teamsFromDb = await TeamModel.find({
          eventId: event._id,
          isRegistered: true,
        })
          .populate({
            path: "leader",
            select: "name email dept year phoneNumber",
          })
          .populate({
            path: "members.userId",
            select: "name email dept year phoneNumber",
          })
          .lean();

        for (let team of teamsFromDb) {
          if (Array.isArray(team.members) && team.members.length > 0) {
            const seenUserIds = new Set();
            team.members = team.members
              .filter((member) => member && member.userId)
              .filter((member) => {
                const idObj = member.userId._id || member.userId;
                const idStr =
                  idObj && idObj.toString ? idObj.toString() : idObj;
                if (!idStr) return false;
                if (seenUserIds.has(idStr)) return false;
                seenUserIds.add(idStr);
                return true;
              })
              .map((member) => ({
                userId: member.userId,
                joinedAt: member.joinedAt,
              }));
          } else {
            team.members = [];
          }
        }

        event.eventTeams = teamsFromDb;
      } catch (err) {
        console.error(
          "Failed to populate teams for dashboard assignedEvent:",
          err
        );
      }
    }

    // Format the assigned event for frontend compatibility
    const formattedEvent = {
      event_id: event.event_id,
      name: event.name,
      event_type: event.event_type,
      eventType: event.event_type,
      clubInCharge: event.clubInCharge,
      applicants: event.registrations.map((reg) => ({
        userId: reg.userId,
        name: reg.user?.name || "Unknown",
        email: reg.user?.email || "Unknown",
        dept: reg.user?.dept || "Unknown",
        year: reg.user?.year || "Unknown",
        rollNum: reg.user?.phoneNumber || reg.user?.rollNum || "-",
        teamId: reg.teamId,
        isWinner: reg.isWinner || false,
        // prefer per-user attendance map (attendance.<event_id>) if present, fallback to application field
        isPresent:
          reg.user?.attendance?.[event.event_id] ?? reg.isPresent ?? false,
      })),
      registrations: event.registrations.map((reg) => ({
        userId: reg.userId,
        teamId: reg.teamId,
        registeredAt: reg.registeredAt || reg.appliedAt,
        userName: reg.user?.name || "Unknown",
        userEmail: reg.user?.email || "Unknown",
        userDept: reg.user?.dept || "Unknown",
        userYear: reg.user?.year || "Unknown",
        isPresent:
          reg.user?.attendance?.[event.event_id] ?? reg.isPresent ?? false,
      })),
      teams: event.eventTeams
        ? event.eventTeams.map((team) => ({
            _id: team._id,
            teamName: team.teamName,
            leader: {
              name: team.leader?.name || "Unknown",
              email: team.leader?.email || "Unknown",
              dept: team.leader?.dept || "Unknown",
              year: team.leader?.year || "Unknown",
            },
            members: team.members
              ? team.members.map((member) => ({
                  name: member.userId?.name || "Unknown",
                  email: member.userId?.email || "Unknown",
                  dept: member.userId?.dept || "Unknown",
                  year: member.userId?.year || "Unknown",
                  joinedAt: member.joinedAt,
                  attended:
                    member.userId?.attendance?.[event.event_id] ??
                    member.userId?.isPresent ??
                    false,
                }))
              : [],
            memberCount: team.members ? team.members.length : 0,
            registeredAt: team.registeredAt,
          }))
        : [],
      minTeamSize: event.minTeamSize,
      maxTeamSize: event.maxTeamSize,
      registrationCount: event.registrationCount || 0,
      registeredTeamsCount: event.registeredTeamsCount || 0,
      maxApplications: event.maxApplications,
      eventDate: event.startDate || event.eventDate || null,
      availableSeats: event.maxApplications
        ? event.maxApplications - (event.registrationCount || 0)
        : null,
      // Get winners from the event's winners field (new approach)
      winners: event.winners || [],
      // Fallback winners built from isWinner flags (for backward compatibility)
      fallbackWinners: (event.registrations || [])
        .filter((r) => r.isWinner)
        .slice()
        .sort((a, b) => (a.winnerRank ?? Infinity) - (b.winnerRank ?? Infinity))
        .map((reg) => ({
          userId: reg.userId,
          teamId: reg.teamId,
          name: reg.user?.name || "Unknown",
          email: reg.user?.email || "Unknown",
          dept: reg.user?.dept || "Unknown",
          year: reg.user?.year || "Unknown",
          rollNum:
            reg.user?.phoneNumber || reg.rollNum || reg.user?.rollNum || null,
          winnerRank: reg.winnerRank ?? null,
        })),
    };

    return res.status(200).json({
      success: true,
      stats: {},
      assignedEvent: formattedEvent,
    });
  }

  // Super Admin: Get statistics using EventRegistrations collection (like college registrations page)
  // Use the already imported EventRegistration model
  
  // Get all registrations from EventRegistrations collection
  const allRegistrations = await EventRegistration.find({}).lean();

  // Calculate total registrations (total individual registrations)
  const totalRegistrations = allRegistrations.length;

  // Separate solo and team registrations
  const soloRegistrations = allRegistrations.filter(
    (reg) => reg.eventType === "solo"
  );
  const teamRegistrations = allRegistrations.filter(
    (reg) => reg.eventType === "group"
  );

  // Get unique teams for team events
  const TeamModel = require("../models/teams");
  const uniqueTeams = await TeamModel.find({ isRegistered: true }).lean();
  const totalTeams = uniqueTeams.length;

  // Calculate unique participants (people with same name, email, mobile, dept, etc.)
  const uniqueParticipants = new Map();
  allRegistrations.forEach((reg) => {
    const key =
      `${reg.participantName}-${reg.participantEmail}-${reg.participantMobile}-${reg.department}-${reg.level}`.toLowerCase();
    if (!uniqueParticipants.has(key)) {
      uniqueParticipants.set(key, {
        name: reg.participantName,
        email: reg.participantEmail,
        gender: reg.gender,
        dept: reg.department,
        level: reg.level,
      });
    }
  });

  // Calculate gender statistics for all registrations
  let boys = 0,
    girls = 0,
    unknownGender = 0;
  allRegistrations.forEach((reg) => {
    const gender = String(reg.gender || "")
      .toLowerCase()
      .trim();
    if (gender === "male" || gender === "m") boys++;
    else if (gender === "female" || gender === "f") girls++;
    else unknownGender++;
  });

  // Calculate unique participant gender statistics
  let uniqueBoys = 0,
    uniqueGirls = 0,
    uniqueUnknown = 0;
  uniqueParticipants.forEach((participant) => {
    const gender = String(participant.gender || "")
      .toLowerCase()
      .trim();
    if (gender === "male" || gender === "m") uniqueBoys++;
    else if (gender === "female" || gender === "f") uniqueGirls++;
    else uniqueUnknown++;
  });

  console.log(
    `[DASHBOARD STATS] Total Registrations: ${totalRegistrations}, Solo: ${soloRegistrations.length}, Team: ${teamRegistrations.length}, Teams: ${totalTeams}`
  );
  console.log(
    `[DASHBOARD STATS] Gender - Boys: ${boys}, Girls: ${girls}, Unknown: ${unknownGender}`
  );
  console.log(
    `[DASHBOARD STATS] Unique Participants: ${uniqueParticipants.size}, Boys: ${uniqueBoys}, Girls: ${uniqueGirls}`
  );

  // Other stats (keep existing logic)
  const totalUsers = await UserModel.countDocuments({ role: { $ne: "admin" } });
  const totalEvents = await EventModel.countDocuments();
  const totalAdmins = await UserModel.countDocuments({ role: "admin" });
  const verifiedUsers = await UserModel.countDocuments({
    isVerified: true,
    role: { $ne: "admin" },
  });
  const unverifiedUsers = await UserModel.countDocuments({
    isVerified: false,
    role: { $ne: "admin" },
  });
  const pendingInvites = await UserModel.countDocuments({
    adminInviteToken: { $exists: true },
    adminInviteTokenExpire: { $gt: Date.now() },
  });

  // Recent registrations (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentRegistrations = await UserModel.countDocuments({
    createdAt: { $gte: sevenDaysAgo },
    role: { $ne: "admin" },
  });

  // Admins by club
  const adminsByClub = await UserModel.aggregate([
    { $match: { role: "admin", club: { $exists: true } } },
    { $group: { _id: "$club", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  res.status(200).json({
    success: true,
    stats: {
      totalUsers,
      totalEvents,
      totalAdmins,
      verifiedUsers,
      unverifiedUsers,
      // Total registrations (all individual registrations)
      totalApplications: totalRegistrations,
      totalRegistrations: totalRegistrations,
      soloRegistrations: soloRegistrations.length,
      teamRegistrations: teamRegistrations.length,
      totalTeams: totalTeams,
      // Gender statistics for all registrations
      boys,
      girls,
      unknownGender,
      // Unique participant statistics
      uniqueParticipants: uniqueParticipants.size,
      uniqueBoys,
      uniqueGirls,
      uniqueUnknown,
      // Other stats
      recentRegistrations,
      pendingInvites,
      adminsByClub,
    },
    ...(userEventInfo && { assignedEvent: userEventInfo }),
  });
});

// Get admins grouped by club (Admin only)
const getAdminsByClub = catchAsyncError(async (req, res, next) => {
  const adminsByClub = await UserModel.aggregate([
    { $match: { role: "admin", club: { $exists: true } } },
    {
      $group: {
        _id: "$club",
        admins: {
          $push: {
            id: "$_id",
            name: "$name",
            email: "$email",
            dept: "$dept",
            year: "$year",
            createdAt: "$createdAt",
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.status(200).json({
    success: true,
    adminsByClub,
    totalClubs: adminsByClub.length,
  });
});

// Get all admins for in-charge selection
const getAllAdmins = catchAsyncError(async (req, res, next) => {
  const { search } = req.query;

  let query = { role: "admin" };

  // Add search functionality
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { club: { $regex: search, $options: "i" } },
    ];
  }

  const admins = await UserModel.find(query)
    .select("name email club dept year")
    .sort({ name: 1 })
    .limit(50); // Limit to 50 results for performance

  res.status(200).json({
    success: true,
    admins,
    count: admins.length,
  });
});

// Get all event registrations directly from EventRegistrations collection (Super Admin only)
const getAllEventRegistrations = catchAsyncError(async (req, res, next) => {
  try {
    console.log("=== getAllEventRegistrations called ===");
    
    // Set request timeout for 30 seconds
    req.setTimeout(30000);
    
    // First, get all registrations without populate
    const registrations = await EventRegistration.find({})
      .lean()
      .sort({ createdAt: -1 });

    console.log(`Found ${registrations.length} registrations in EventRegistrations collection`);
    
    if (registrations.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          registrations: [],
          totalRegistrations: 0,
        }
      });
    }

    // Get unique event and user IDs for bulk queries
    const eventIds = [...new Set(registrations.map(r => r.eventId).filter(Boolean))];
    const userIds = [...new Set(registrations.map(r => r.registrantId).filter(Boolean))];
    
    console.log(`Bulk fetching ${eventIds.length} events and ${userIds.length} users`);
    
    // Bulk fetch events and users
    const [events, users] = await Promise.all([
      EventModel.find({ _id: { $in: eventIds } })
        .select("name event_id event_type clubInCharge")
        .lean(),
      UserModel.find({ _id: { $in: userIds } })
        .select("name email college")
        .lean()
    ]);
    
    console.log(`Fetched ${events.length} events and ${users.length} users`);
    
    // Create lookup maps for O(1) access
    const eventMap = new Map(events.map(e => [e._id.toString(), e]));
    const userMap = new Map(users.map(u => [u._id.toString(), u]));
    
    // Populate registrations efficiently
    const registrationsWithEventData = registrations.map(reg => ({
      ...reg,
      eventId: reg.eventId ? eventMap.get(reg.eventId.toString()) : null,
      registrantId: reg.registrantId ? userMap.get(reg.registrantId.toString()) : null
    }));
    
    // Log sample for debugging
    if (registrationsWithEventData.length > 0) {
      console.log("Sample registration:", JSON.stringify(registrationsWithEventData[0], null, 2));
    }

    res.status(200).json({
      success: true,
      data: {
        registrations: registrationsWithEventData,
        totalRegistrations: registrationsWithEventData.length,
      }
    });

  } catch (error) {
    console.error("Error fetching all event registrations:", error);
    return next(new ErrorHandler("Failed to fetch event registrations", 500));
  }
});

// Get detailed events with registrations (Super Admin only)
const getEventsWithRegistrations = catchAsyncError(async (req, res, next) => {
  // Aggregate events with their applications, teams, and related user data
  const eventsWithRegistrations = await EventModel.aggregate([
    {
      $lookup: {
        from: "users",
        localField: "applications.userId",
        foreignField: "_id",
        as: "applicants",
      },
    },
    {
      $lookup: {
        from: "teams",
        localField: "_id",
        foreignField: "eventId",
        as: "eventTeams",
      },
    },
    {
      $lookup: {
        from: "eventregistrations",
        localField: "_id",
        foreignField: "eventId",
        as: "eventRegistrations",
      },
    },
    {
      $project: {
        name: 1,
        event_id: 1,
        clubInCharge: 1,
        event_type: 1,
        createdAt: 1,
        updatedAt: 1,
        maxApplications: 1,
        registrationCount: {
          $cond: {
            if: { $eq: ["$event_type", "group"] },
            then: {
              $size: {
                $filter: {
                  input: "$eventRegistrations",
                  cond: { $eq: ["$$this.eventType", "group"] },
                },
              },
            },
            else: {
              $size: {
                $filter: {
                  input: "$eventRegistrations",
                  cond: { $eq: ["$$this.eventType", "solo"] },
                },
              },
            },
          },
        },
        participantCount: {
          $cond: {
            if: { $eq: ["$event_type", "group"] },
            then: {
              $size: {
                $filter: {
                  input: "$eventRegistrations",
                  cond: { $eq: ["$$this.eventType", "group"] },
                },
              },
            },
            else: {
              $size: {
                $filter: {
                  input: "$eventRegistrations",
                  cond: { $eq: ["$$this.eventType", "solo"] },
                },
              },
            },
          },
        },
        registeredTeamsCount: {
          $size: {
            $filter: {
              input: "$eventTeams",
              cond: { $eq: ["$$this.isRegistered", true] },
            },
          },
        },
        registrations: {
          $map: {
            input: "$applications",
            as: "app",
            in: {
              userId: "$$app.userId",
              teamId: "$$app.teamId",
              registeredAt: "$$app.registeredAt",
              appliedAt: "$$app.appliedAt",
              isWinner: "$$app.isWinner",
              isPresent: "$$app.isPresent",
              winnerRank: "$$app.winnerRank",
              user: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: "$applicants",
                      cond: { $eq: ["$$this._id", "$$app.userId"] },
                    },
                  },
                  0,
                ],
              },
            },
          },
        },
        eventTeams: {
          $filter: {
            input: "$eventTeams",
            cond: { $eq: ["$$this.isRegistered", true] },
          },
        },
      },
    },
    { $sort: { createdAt: -1, clubInCharge: 1 } },
  ]);

  // Get team details for registered teams in bulk
  try {
    const eventIds = eventsWithRegistrations
      .filter((e) => e.eventTeams && e.eventTeams.length > 0)
      .map((e) => e._id);

    if (eventIds.length > 0) {
      const teams = await TeamModel.find({
        eventId: { $in: eventIds },
        isRegistered: true,
      })
        .populate({
          path: "leader",
          select: "name email dept year phoneNumber gender",
        })
        .populate({
          path: "members.userId",
          select: "name email dept year phoneNumber gender",
        })
        .lean();

      // group teams by eventId
      const teamsByEvent = teams.reduce((acc, t) => {
        const key =
          t.eventId && t.eventId.toString ? t.eventId.toString() : t.eventId;
        acc[key] = acc[key] || [];
        // deduplicate members
        if (Array.isArray(t.members) && t.members.length > 0) {
          const seen = new Set();
          t.members = t.members
            .filter((m) => m && m.userId)
            .filter((m) => {
              const idObj = m.userId._id || m.userId;
              const idStr = idObj && idObj.toString ? idObj.toString() : idObj;
              if (!idStr) return false;
              if (seen.has(idStr)) return false;
              seen.add(idStr);
              return true;
            })
            .map((m) => ({ userId: m.userId, joinedAt: m.joinedAt }));
        } else {
          t.members = [];
        }

        acc[key].push(t);
        return acc;
      }, {});

      // attach teams to respective events
      for (let event of eventsWithRegistrations) {
        const key =
          event._id && event._id.toString ? event._id.toString() : event._id;
        event.eventTeams = teamsByEvent[key] || [];
      }

      // Compute per-event participant counts and gender breakdowns
      for (let event of eventsWithRegistrations) {
        const seen = new Map(); // id -> gender

        // helper to normalize gender strictly to 'male'/'female' or 'unknown'
        const norm = (raw) => {
          if (!raw && raw !== "") return "unknown";
          const g = String(raw || "")
            .trim()
            .toLowerCase();
          if (g === "male") return "male";
          if (g === "female") return "female";
          return "unknown";
        };

        // registrations (solo applicants or individual entries)
        for (const reg of event.registrations || []) {
          // reg.user may be populated from aggregation 'applicants'
          const userObj = reg.user || {};
          const uid = userObj._id || reg.userId || null;
          const idStr = uid && uid.toString ? uid.toString() : uid;
          if (idStr) {
            const g = norm(
              userObj.gender || userObj?.gender || reg.gender || null
            );
            if (!seen.has(idStr)) seen.set(idStr, g);
          }
        }

        // teams: include leader + members
        for (const t of event.eventTeams || []) {
          // leader may be populated
          const leader = t.leader || {};
          const leaderId = leader._id || null;
          const leaderIdStr =
            leaderId && leaderId.toString ? leaderId.toString() : leaderId;
          if (leaderIdStr) {
            const g = norm(leader.gender || leader?.gender || null);
            if (!seen.has(leaderIdStr)) seen.set(leaderIdStr, g);
          }

          // members were normalized earlier to have userId objects when loaded from DB
          const members = t.members || [];
          for (const m of members) {
            const memberObj = m.userId || m.user || {};
            const mid = memberObj._id || memberObj || null;
            const midStr = mid && mid.toString ? mid.toString() : mid;
            if (midStr) {
              const g = norm(memberObj.gender || memberObj?.gender || null);
              if (!seen.has(midStr)) seen.set(midStr, g);
            }
          }
        }

        // now compute counts
        let male = 0,
          female = 0,
          unknown = 0;
        for (const g of seen.values()) {
          if (g === "male") male++;
          else if (g === "female") female++;
          else unknown++;
        }

        event.participantCount = seen.size;
        event.genderStats = { male, female, unknown };
      }
    }
  } catch (err) {
    console.error(
      "Failed to bulk load teams for eventsWithRegistrations:",
      err
    );
  }

  // Group by club
  const eventsByClub = eventsWithRegistrations.reduce((acc, event) => {
    const club = event.clubInCharge || "No Club";
    if (!acc[club]) {
      acc[club] = {
        clubName: club,
        events: [],
        totalEvents: 0,
        totalRegistrations: 0,
      };
    }

    // Build winners list ordered by winnerRank (if present)
    const winnersList = (event.registrations || [])
      .filter((r) => r.isWinner)
      .slice()
      .sort((a, b) => (a.winnerRank ?? Infinity) - (b.winnerRank ?? Infinity))
      .map((reg) => ({
        userId: reg.userId,
        teamId: reg.teamId,
        name: reg.user?.name || reg.userName || "Unknown",
        email: reg.user?.email || reg.userEmail || "Unknown",
        dept: reg.user?.dept || reg.userDept || "Unknown",
        year: reg.user?.year || reg.userYear || "Unknown",
        rollNum:
          reg.user?.phoneNumber || reg.rollNum || reg.user?.rollNum || null,
        winnerRank: reg.winnerRank ?? null,
      }));

    acc[club].events.push({
      ...event,
      winners: winnersList,
      availableSeats: event.maxApplications
        ? event.maxApplications - event.registrationCount
        : null,
      registrations: event.registrations.map((reg) => ({
        userId: reg.userId,
        teamId: reg.teamId,
        registeredAt: reg.registeredAt,
        appliedAt: reg.appliedAt,
        name: reg.user?.name || reg.userName || "Unknown",
        email: reg.user?.email || reg.userEmail || "Unknown",
        dept: reg.user?.dept || reg.userDept || "Unknown",
        year: reg.user?.year || reg.userYear || "Unknown",
        rollNum:
          reg.user?.phoneNumber || reg.rollNum || reg.user?.rollNum || null,
        userName: reg.user?.name || reg.userName || "Unknown",
        userEmail: reg.user?.email || reg.userEmail || "Unknown",
        userDept: reg.user?.dept || reg.userDept || "Unknown",
        userYear: reg.user?.year || reg.userYear || "Unknown",
        isWinner: reg.isWinner || false,
        isPresent:
          reg.user?.attendance?.[event.event_id] ?? reg.isPresent ?? false,
        winnerRank: reg.winnerRank ?? null,
      })),
      teams: event.eventTeams.map((team) => ({
        _id: team._id,
        teamName: team.teamName,
        leader: {
          name: team.leader?.name || "Unknown",
          email: team.leader?.email || "Unknown",
          dept: team.leader?.dept || "Unknown",
          year: team.leader?.year || "Unknown",
        },
        members: team.members
          .filter((member) => {
            // Exclude leader from members
            if (!member.userId || !team.leader) return true;
            const memberId = member.userId._id
              ? member.userId._id.toString()
              : member.userId.toString();
            const leaderId = team.leader._id
              ? team.leader._id.toString()
              : team.leader.toString();
            return memberId !== leaderId;
          })
          .map((member) => ({
            name: member.userId?.name || "Unknown",
            email: member.userId?.email || "Unknown",
            dept: member.userId?.dept || "Unknown",
            year: member.userId?.year || "Unknown",
            joinedAt: member.joinedAt,
            attended:
              member.userId?.attendance?.[event.event_id] ??
              member.userId?.isPresent ??
              false,
          })),
        memberCount: team.members.filter((member) => {
          if (!member.userId || !team.leader) return true;
          const memberId = member.userId._id
            ? member.userId._id.toString()
            : member.userId.toString();
          const leaderId = team.leader._id
            ? team.leader._id.toString()
            : team.leader.toString();
          return memberId !== leaderId;
        }).length,
        registeredAt: team.registeredAt,
      })),
    });

    acc[club].totalEvents++;
    acc[club].totalRegistrations += event.registrationCount;

    return acc;
  }, {});

  const clubsData = Object.values(eventsByClub);

  res.status(200).json({
    success: true,
    clubs: clubsData,
    totalClubs: clubsData.length,
    totalEvents: eventsWithRegistrations.length,
    totalRegistrations: eventsWithRegistrations.reduce(
      (sum, event) => sum + event.registrationCount,
      0
    ),
    lastUpdated: new Date().toISOString(),
  });
});

// Get a single event with registrations and teams (Admin access allowed if they manage the event)
const getEventWithRegistrations = catchAsyncError(async (req, res, next) => {
  const eventId = req.params.id;

  // Fetch aggregated event with registrations and teams (support lookup by Mongo _id or by event_id string)
  const isObjectId = mongoose.Types.ObjectId.isValid(eventId);
  const matchStage = isObjectId
    ? {
        $or: [
          { _id: new mongoose.Types.ObjectId(eventId) },
          { event_id: eventId },
        ],
      }
    : { event_id: eventId };

  const aggregated = await EventModel.aggregate([
    { $match: matchStage },
    {
      $lookup: {
        from: "users",
        localField: "applications.userId",
        foreignField: "_id",
        as: "applicants",
      },
    },
    {
      $lookup: {
        from: "teams",
        localField: "_id",
        foreignField: "eventId",
        as: "eventTeams",
      },
    },
    {
      $project: {
        name: 1,
        event_id: 1,
        clubInCharge: 1,
        event_type: 1,
        startDate: 1,
        endDate: 1,
        createdAt: 1,
        updatedAt: 1,
        maxApplications: 1,
        winners: 1, // Include the winners field
        winnersUpdatedAt: 1, // Include the winners timestamp
        registrationCount: {
          $cond: {
            if: { $eq: ["$event_type", "group"] },
            then: {
              $size: {
                $filter: {
                  input: "$eventTeams",
                  cond: { $eq: ["$$this.isRegistered", true] },
                },
              },
            },
            else: { $size: "$applications" },
          },
        },
        registeredTeamsCount: {
          $size: {
            $filter: {
              input: "$eventTeams",
              cond: { $eq: ["$$this.isRegistered", true] },
            },
          },
        },
        registrations: {
          $map: {
            input: "$applications",
            as: "app",
            in: {
              userId: "$$app.userId",
              teamId: "$$app.teamId",
              registeredAt: "$$app.registeredAt",
              appliedAt: "$$app.appliedAt",
              isWinner: "$$app.isWinner",
              isPresent: "$$app.isPresent",
              winnerRank: "$$app.winnerRank",
              user: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: "$applicants",
                      cond: { $eq: ["$$this._id", "$$app.userId"] },
                    },
                  },
                  0,
                ],
              },
            },
          },
        },
        eventTeams: {
          $filter: {
            input: "$eventTeams",
            cond: { $eq: ["$$this.isRegistered", true] },
          },
        },
      },
    },
    { $sort: { createdAt: -1 } },
  ]);

  if (!aggregated || aggregated.length === 0) {
    return res.status(404).json({ success: false, message: "Event not found" });
  }

  const event = aggregated[0];

  // Load full event applications from DB to resolve winnerRank reliably
  let dbEventApps = [];
  try {
    const fullEvent = await EventModel.findById(event._id)
      .select("applications")
      .lean();
    if (fullEvent && Array.isArray(fullEvent.applications))
      dbEventApps = fullEvent.applications;
  } catch (err) {
    console.error(
      "Failed to load full event applications to resolve winnerRank:",
      err
    );
  }

  // Populate teams: query TeamModel directly to ensure members and leader are populated
  if (event.eventTeams && event.eventTeams.length > 0) {
    try {
      const teamsFromDb = await TeamModel.find({
        eventId: event._id,
        isRegistered: true,
      })
        .populate({
          path: "leader",
          select: "name email dept year phoneNumber",
        })
        .populate({
          path: "members.userId",
          select: "name email dept year phoneNumber",
        })
        .lean();

      // Deduplicate members by userId in each team and normalize shape
      for (let team of teamsFromDb) {
        if (Array.isArray(team.members) && team.members.length > 0) {
          const seenUserIds = new Set();
          team.members = team.members
            .filter((member) => member && member.userId)
            .filter((member) => {
              const idObj = member.userId._id || member.userId;
              const idStr = idObj && idObj.toString ? idObj.toString() : idObj;
              if (!idStr) return false;
              if (seenUserIds.has(idStr)) return false;
              seenUserIds.add(idStr);
              return true;
            })
            .map((member) => ({
              userId: member.userId,
              joinedAt: member.joinedAt,
            }));
        } else {
          team.members = [];
        }
      }

      event.eventTeams = teamsFromDb;
    } catch (popErr) {
      // Fallback to whatever was aggregated previously
      console.error("Failed to load teams from DB:", popErr);
    }
  }

  // Build a map of teams for easy lookup and format teams for frontend
  const teamMap = new Map();
  const formattedTeams = (event.eventTeams || []).map((team) => {
    const leader = team.leader || {};
    const members = (team.members || [])
      .filter((member) => {
        // Exclude leader from members list
        if (!member.userId || !leader || !leader._id) return true;
        const memberId = member.userId._id
          ? member.userId._id.toString()
          : member.userId.toString();
        const leaderId = leader._id ? leader._id.toString() : leader.toString();
        return memberId !== leaderId;
      })
      .map((member) => ({
        _id: member.userId?._id || null,
        name: member.userId?.name || "Unknown",
        email: member.userId?.email || "Unknown",
        dept: member.userId?.dept || "Unknown",
        year: member.userId?.year || "Unknown",
        joinedAt: member.joinedAt,
      }));

    const formatted = {
      _id: team._id,
      teamName: team.teamName || team.name || "Team",
      leader: {
        _id: leader._id || null,
        name: leader?.name || "Unknown",
        email: leader?.email || "Unknown",
        dept: leader?.dept || "Unknown",
        year: leader?.year || "Unknown",
      },
      members,
      memberCount: members.length,
      registeredAt: team.registeredAt,
      isRegistered: !!team.isRegistered,
    };

    teamMap.set(team._id ? team._id.toString() : team._id, formatted);
    return formatted;
  });

  // Fetch registrant information from EventRegistrations model
  let eventRegistrations = [];
  try {
    eventRegistrations = await EventRegistration.find({
      eventId: event._id,
    })
      .populate("registrantId", "name email")
      .lean();
  } catch (err) {
    console.error(
      "Failed to load event registrations for registrant info:",
      err
    );
  }

  // Create a map for quick lookup of registrant info by participant userId/teamId
  const registrantMap = new Map();
  eventRegistrations.forEach((reg) => {
    // For solo events, map by participant userId
    if (event.event_type === "solo" && reg.participantEmail) {
      // Find user by email since we might not have direct userId mapping
      const participant = event.registrations?.find(
        (r) => (r.user?.email || r.userEmail) === reg.participantEmail
      );
      if (participant) {
        const participantId =
          participant.userId?.toString() || participant.userId;
        registrantMap.set(participantId, {
          registrantName: reg.registrantId?.name || "Unknown",
          registrantEmail: reg.registrantId?.email || reg.registrantEmail,
        });
      }
    }
    // For team events, map by teamId
    else if (event.event_type === "group" && reg.teamId) {
      registrantMap.set(reg.teamId.toString(), {
        registrantName: reg.registrantId?.name || "Unknown",
        registrantEmail: reg.registrantId?.email || reg.registrantEmail,
      });
    }
  });

  // Format and return same structure as getEventsWithRegistrations for frontend
  const formattedEvent = {
    ...event,
    availableSeats: event.maxApplications
      ? event.maxApplications - (event.registrationCount || 0)
      : null,
    teams: formattedTeams,
    // Get winners from the event's winners field (new approach)
    winners: event.winners || [],
    // Fallback winners built from isWinner flags (for backward compatibility)
    fallbackWinners: (event.registrations || [])
      .filter((r) => r.isWinner)
      .slice()
      .map((reg) => {
        // try to find winnerRank from registration first, fallback to DB applications
        let rank = reg.winnerRank ?? null;
        try {
          if ((rank === null || rank === undefined) && dbEventApps.length > 0) {
            const rid =
              reg.userId && reg.userId.toString
                ? reg.userId.toString()
                : String(reg.userId || "");
            const matched = dbEventApps.find((a) => {
              const aid =
                a.userId && a.userId.toString
                  ? a.userId.toString()
                  : String(a.userId || "");
              return aid === rid;
            });
            if (
              matched &&
              matched.winnerRank !== null &&
              matched.winnerRank !== undefined
            ) {
              rank = matched.winnerRank;
            }
          }
        } catch (e) {
          // ignore and leave rank as-is
        }
        return {
          userId: reg.userId,
          teamId: reg.teamId,
          name: reg.user?.name || reg.userName || "Unknown",
          email: reg.user?.email || reg.userEmail || "Unknown",
          dept: reg.user?.dept || reg.userDept || "Unknown",
          year: reg.user?.year || reg.userYear || "Unknown",
          rollNum:
            reg.user?.phoneNumber || reg.rollNum || reg.user?.rollNum || null,
          winnerRank: rank ?? null,
        };
      })
      .sort((a, b) => (a.winnerRank ?? Infinity) - (b.winnerRank ?? Infinity)),

    registrations: event.registrations.map((reg) => {
      const teamIdStr = reg.teamId
        ? reg.teamId._id
          ? reg.teamId._id.toString()
          : reg.teamId.toString()
        : null;

      const teamInfo = teamIdStr ? teamMap.get(teamIdStr) : null;

      // Get registrant info
      const participantId = reg.userId?.toString() || reg.userId;
      const registrantInfo =
        registrantMap.get(participantId) || registrantMap.get(teamIdStr) || {};

      return {
        userId: reg.userId,
        teamId: reg.teamId,
        registeredAt: reg.registeredAt || reg.appliedAt,
        // legacy-friendly fields for frontend components
        name: reg.user?.name || reg.userName || "Unknown",
        email: reg.user?.email || reg.userEmail || "Unknown",
        dept: reg.user?.dept || reg.userDept || "Unknown",
        year: reg.user?.year || reg.userYear || "Unknown",
        rollNum:
          reg.user?.phoneNumber ||
          reg.rollNum ||
          reg.user?.rollNum ||
          reg.user?.phoneNumber ||
          null,
        // also provide namespaced fields (kept for backward compatibility)
        userName: reg.user?.name || reg.userName || "Unknown",
        userEmail: reg.user?.email || reg.userEmail || "Unknown",
        userDept: reg.user?.dept || reg.userDept || "Unknown",
        userYear: reg.user?.year || reg.userYear || "Unknown",
        isWinner: reg.isWinner || false,
        isPresent:
          reg.user?.attendance?.[event.event_id] ?? reg.isPresent ?? false,
        winnerRank: reg.winnerRank ?? null,
        teamName:
          teamInfo && teamInfo.teamName
            ? teamInfo.teamName
            : reg.teamId && typeof reg.teamId === "object"
            ? reg.teamId.teamName || reg.teamId.name || null
            : null,
        teamMembers: teamInfo ? teamInfo.members : [],
        // Add registrant information
        registrantName: registrantInfo.registrantName || "Unknown",
        registrantEmail: registrantInfo.registrantEmail || "Unknown",
      };
    }),
  };

  res.status(200).json({ success: true, event: formattedEvent });
});

// Enhanced version that fetches registration data primarily from EventRegistrations model
const getEventWithRegistrationsV2 = catchAsyncError(async (req, res, next) => {
  const eventId = req.params.id;

  // Fetch event details first
  const isObjectId = mongoose.Types.ObjectId.isValid(eventId);
  const matchStage = isObjectId
    ? {
        $or: [
          { _id: new mongoose.Types.ObjectId(eventId) },
          { event_id: eventId },
        ],
      }
    : { event_id: eventId };

  const event = await EventModel.findOne(matchStage).lean();
  if (!event) {
    return res.status(404).json({ success: false, message: "Event not found" });
  }

  // Fetch comprehensive registration data from EventRegistrations model
  const registrations = await EventRegistration.find({
    eventId: event._id,
  })
    .populate("registrantId", "name email college")
    .lean();

  // Build registrations array with complete information
  const formattedRegistrations = registrations.map((reg) => ({
    _id: reg._id, // EventRegistration._id
    userId: reg._id, // For solo events, this EventRegistration._id is used in winners array
    registrationId: reg._id, // Alternative field name
    teamId: reg.teamId || null,
    registeredAt: reg.createdAt,
    // Participant information
    name: reg.participantName || "Unknown",
    email: reg.participantEmail || "Unknown",
    mobile: reg.participantMobile || null,
    dept: reg.department || "Unknown",
    year: reg.year || "Unknown",
    gender: reg.gender || "Unknown",
    college: reg.collegeName || "Unknown",
    // Also provide namespaced fields for backward compatibility
    userName: reg.participantName || "Unknown",
    userEmail: reg.participantEmail || "Unknown",
    userMobile: reg.participantMobile || null,
    userDept: reg.department || "Unknown",
    userYear: reg.year || "Unknown",
    userGender: reg.gender || "Unknown",
    userCollege: reg.collegeName || "Unknown",
    // Registrant information
    registrantName: reg.registrantId?.name || "Unknown",
    registrantEmail: reg.registrantId?.email || "Unknown",
    registrantCollege: reg.registrantId?.college || "Unknown",
    // Other fields
    isWinner: false, // Will be updated from event applications if available
    isPresent: false,
    winnerRank: null,
  }));

  // Create a map of registrant info by teamId for team events
  const teamRegistrantMap = new Map();
  registrations.forEach((reg) => {
    if (reg.teamId) {
      teamRegistrantMap.set(reg.teamId.toString(), {
        registrantName: reg.registrantId?.name || "Unknown",
        registrantEmail: reg.registrantId?.email || "Unknown",
        registrantCollege: reg.registrantId?.college || "Unknown",
      });
    }
  });

  // Update winner status from event applications if available
  if (event.applications && Array.isArray(event.applications)) {
    event.applications.forEach((app) => {
      const registration = formattedRegistrations.find(
        (reg) => reg.userId?.toString() === app.userId?.toString()
      );
      if (registration) {
        registration.isWinner = app.isWinner || false;
        registration.isPresent = app.isPresent || false;
        registration.winnerRank = app.winnerRank || null;
      }
    });
  }

  // Fetch team information for group events
  let teams = [];
  if (event.event_type === "group") {
    try {
      const TeamModel = require("../models/teams");
      teams = await TeamModel.find({
        eventId: event._id,
        isRegistered: true,
      })
        .populate("leader", "name email dept year phoneNumber college")
        .populate("members.userId", "name email dept year phoneNumber college")
        .lean();

      // Format teams with member information including college
      teams = teams.map((team) => {
        const teamRegistrant = teamRegistrantMap.get(team._id.toString()) || {};
        return {
          _id: team._id,
          teamName: team.teamName || team.name || "Team",
          leader: {
            _id: team.leader?._id || null,
            name: team.leader?.name || "Unknown",
            email: team.leader?.email || "Unknown",
            dept: team.leader?.dept || "Unknown",
            year: team.leader?.year || "Unknown",
            college: team.leader?.college || "Unknown",
          },
          members: (team.members || [])
            .filter(
              (member) =>
                member.userId &&
                member.userId._id?.toString() !== team.leader?._id?.toString()
            )
            .map((member) => ({
              _id: member.userId._id,
              name: member.userId.name || "Unknown",
              email: member.userId.email || "Unknown",
              dept: member.userId.dept || "Unknown",
              year: member.userId.year || "Unknown",
              college: member.userId.college || "Unknown",
              joinedAt: member.joinedAt,
            })),
          memberCount: team.members?.length || 0,
          registeredAt: team.registeredAt,
          isRegistered: !!team.isRegistered,
          // Add registrant information for the team
          registrantName: teamRegistrant.registrantName || "Unknown",
          registrantEmail: teamRegistrant.registrantEmail || "Unknown",
          registrantCollege: teamRegistrant.registrantCollege || "Unknown",
        };
      });
    } catch (err) {
      console.error("Failed to load teams:", err);
    }
  }

  // Format winners - handle both direct winners array and isWinner flags in registrations
  let formattedWinners = [];
  
  if (event.winners && Array.isArray(event.winners) && event.winners.length > 0) {
    // Use direct winners array from event document (preferred for new format)
    if (event.event_type === "group") {
      // For group events, we need to send individual member records for each winner team
      // so that the frontend can process them correctly
      const TeamModel = require("../models/teams");
      
      const allWinnerMembers = [];
      
      for (const winner of event.winners) {
        try {
          const team = await TeamModel.findById(winner.teamId).lean();
          
          console.log(`DEBUG: Fetching winner team ${winner.teamId}:`, {
            teamFound: !!team,
            teamName: team?.teamName || team?.name,
            leaderObjectId: team?.leader?.toString(),
            membersCount: team?.members?.length || 0
          });
          
          if (team) {
            // Get all team members (including leader)
            const allMembers = [];
            
            // First, add all team members from the members array (they have direct information)
            if (team.members && Array.isArray(team.members)) {
              team.members.forEach(member => {
                allMembers.push({
                  _id: member._id || `direct-${member.name}-${Math.random().toString(36).slice(2, 8)}`,
                  name: member.name || "Unknown",
                  email: member.email || "Unknown",
                  dept: member.dept || "Unknown",
                  year: member.year || "Unknown",
                  college: "Unknown", // Direct members don't have college info
                  degree: member.degree || "Unknown",
                  gender: member.gender || "Unknown",
                  mobile: member.mobile || "Unknown",
                  role: "Member"
                });
              });
            }
            
            // Handle leader - try to get leader info from User collection
            if (team.leader) {
              try {
                const leaderUser = await UserModel.findById(team.leader)
                  .select('name email dept year college')
                  .lean();
                
                if (leaderUser) {
                  // Check if this leader is already in our members array (by email match)
                  const existingMemberIndex = allMembers.findIndex(member => 
                    member.email && leaderUser.email && 
                    member.email.toLowerCase().trim() === leaderUser.email.toLowerCase().trim()
                  );
                  
                  if (existingMemberIndex !== -1) {
                    // Leader found in members array, update their info and role
                    allMembers[existingMemberIndex] = {
                      ...allMembers[existingMemberIndex],
                      name: leaderUser.name || allMembers[existingMemberIndex].name,
                      college: leaderUser.college || "Unknown",
                      role: "Leader"
                    };
                    console.log(`DEBUG: Leader ${leaderUser.name} found in members array, updated role`);
                  } else {
                    // Leader not in members array, add them separately
                    allMembers.push({
                      _id: leaderUser._id,
                      name: leaderUser.name || "Unknown",
                      email: leaderUser.email || "Unknown",
                      dept: leaderUser.dept || "Unknown",
                      year: leaderUser.year || "Unknown",
                      college: leaderUser.college || "Unknown",
                      role: "Leader"
                    });
                    console.log(`DEBUG: Leader ${leaderUser.name} added separately`);
                  }
                } else {
                  // Leader not found in User collection
                  if (allMembers.length > 0) {
                    allMembers[0].role = "Leader";
                    console.log(`DEBUG: Made first member ${allMembers[0].name} the leader`);
                  }
                }
              } catch (err) {
                console.log(`DEBUG: Error fetching leader ${team.leader}:`, err.message);
                if (allMembers.length > 0) {
                  allMembers[0].role = "Leader";
                }
              }
            } else if (allMembers.length > 0) {
              allMembers[0].role = "Leader";
            }
            
            console.log(`DEBUG: Final allMembers for team ${winner.teamId}:`, allMembers.map(m => ({
              name: m.name,
              email: m.email,
              role: m.role
            })));
            
            // Create individual winner member records that frontend expects
            // Frontend groups by teamId, so we create separate records for each member
            allMembers.forEach((member, index) => {
              allWinnerMembers.push({
                // Individual member as winner record - frontend expects this structure
                _id: member._id,
                userId: member._id,
                teamId: winner.teamId,
                teamName: winner.teamName || team.teamName || team.name || "Team",
                name: member.name,        // Frontend resolveName() looks for .name
                userName: member.name,    // Frontend resolveName() looks for .userName
                email: member.email,
                userEmail: member.email,  // Frontend resolveEmail() looks for .userEmail
                dept: member.dept,
                userDept: member.dept,    // Frontend resolveDept() looks for .userDept
                year: member.year,
                userYear: member.year,    // Frontend resolveYear() looks for .userYear
                college: member.college,
                userCollege: member.college, // Frontend resolveCollege() looks for .userCollege
                gender: member.gender,
                userGender: member.gender,   // Frontend resolveGender() looks for .userGender
                mobile: member.mobile,
                userMobile: member.mobile,   // Frontend resolveMobile() looks for .userMobile
                role: member.role,
                rank: winner.rank,
                winnerRank: winner.rank,
                isWinner: true,
                // Add index to maintain member order in frontend
                memberIndex: index
              });
            });
            
          } else {
            // Team not found, create placeholder winner record
            allWinnerMembers.push({
              teamId: winner.teamId,
              teamName: winner.teamName || "Team",
              name: "Team not found",
              userName: "Team not found",
              email: "Unknown",
              userEmail: "Unknown",
              dept: "Unknown",
              userDept: "Unknown",
              year: "Unknown",
              userYear: "Unknown",
              college: "Unknown",
              userCollege: "Unknown",
              rank: winner.rank,
              winnerRank: winner.rank,
              isWinner: true
            });
          }
        } catch (err) {
          console.error(`Error fetching team details for winner ${winner.teamId}:`, err);
          // Create error placeholder
          allWinnerMembers.push({
            teamId: winner.teamId,
            teamName: winner.teamName || "Team",
            name: "Error loading team",
            userName: "Error loading team", 
            email: "Unknown",
            userEmail: "Unknown",
            dept: "Unknown",
            userDept: "Unknown",
            year: "Unknown",
            userYear: "Unknown",
            college: "Unknown",
            userCollege: "Unknown",
            rank: winner.rank,
            winnerRank: winner.rank,
            isWinner: true
          });
        }
      }
      
      formattedWinners = allWinnerMembers;
      
    } else {
      // For solo events, populate participant details from eventregistrations collection
      // The userId in winners array refers to _id in eventregistrations collection
      formattedWinners = await Promise.all(
        event.winners.map(async (winner) => {
          try {
            // For solo events, userId in winners array is the eventRegistration _id
            const eventRegistration = await EventRegistration.findById(winner.userId).lean();
            
            if (eventRegistration) {
              return {
                rank: winner.rank,
                userId: winner.userId, // This is the eventRegistration._id
                registrationId: eventRegistration._id,
                name: eventRegistration.participantName || "Unknown",
                userName: eventRegistration.participantName || "Unknown",
                email: eventRegistration.participantEmail || "Unknown",
                userEmail: eventRegistration.participantEmail || "Unknown",
                dept: eventRegistration.department || "Unknown",
                userDept: eventRegistration.department || "Unknown",
                year: eventRegistration.year || "Unknown",
                userYear: eventRegistration.year || "Unknown",
                college: eventRegistration.collegeName || "Unknown",
                userCollege: eventRegistration.collegeName || "Unknown",
                gender: eventRegistration.gender || "Unknown",
                mobile: eventRegistration.participantMobile || null,
                level: eventRegistration.level || "Unknown",
                degree: eventRegistration.degree || "Unknown",
                collegeName: eventRegistration.collegeName || "Unknown",
                participantName: eventRegistration.participantName || "Unknown",
                participantEmail: eventRegistration.participantEmail || "Unknown",
                isPresent: eventRegistration.isPresent || false,
                winnerRank: winner.rank,
              };
            } else {
              console.warn(`EventRegistration not found for winner userId: ${winner.userId}`);
              return {
                rank: winner.rank,
                userId: winner.userId,
                name: "Unknown",
                userName: "Unknown", 
                email: "Unknown",
                userEmail: "Unknown",
                dept: "Unknown",
                userDept: "Unknown",
                year: "Unknown",
                userYear: "Unknown",
                college: "Unknown",
                userCollege: "Unknown",
                gender: "Unknown",
                mobile: null,
                participantName: "Unknown",
                participantEmail: "Unknown",
                winnerRank: winner.rank,
              };
            }
          } catch (err) {
            console.error(`Error fetching eventRegistration details for winner ${winner.userId}:`, err);
            return {
              rank: winner.rank,
              userId: winner.userId,
              name: "Unknown",
              userName: "Unknown",
              email: "Unknown", 
              userEmail: "Unknown",
              dept: "Unknown",
              userDept: "Unknown",
              year: "Unknown",
              userYear: "Unknown",
              college: "Unknown",
              userCollege: "Unknown",
              gender: "Unknown",
              mobile: null,
              participantName: "Unknown",
              participantEmail: "Unknown",
              winnerRank: winner.rank,
            };
          }
        })
      );
    }
    
    // Sort winners by rank
    formattedWinners.sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity));
  } else {
    // Fallback to old method - check isWinner flags in registrations
    formattedWinners = formattedRegistrations
      .filter((r) => r.isWinner)
      .sort((a, b) => (a.winnerRank ?? Infinity) - (b.winnerRank ?? Infinity));
  }

  // Format final response
  const formattedEvent = {
    ...event,
    availableSeats: event.maxApplications
      ? event.maxApplications - formattedRegistrations.length
      : null,
    registrationCount: formattedRegistrations.length,
    registeredTeamsCount: teams.length,
    teams,
    registrations: formattedRegistrations,
    winners: formattedWinners,
  };

  res.status(200).json({ success: true, event: formattedEvent });
});

// Get club admin dashboard data (Club Admin only)
const getClubAdminStats = catchAsyncError(async (req, res, next) => {
  const userClub = req.user.club;

  if (!userClub) {
    return next(new ErrorHandler("Admin must belong to a club", 400));
  }

  // Get events with detailed registrations for this club
  const clubEventsWithRegistrations = await EventModel.aggregate([
    { $match: { clubInCharge: userClub } },
    {
      $lookup: {
        from: "users",
        localField: "applications.userId",
        foreignField: "_id",
        as: "applicants",
      },
    },
    {
      $lookup: {
        from: "teams",
        localField: "_id",
        foreignField: "eventId",
        as: "eventTeams",
      },
    },
    {
      $project: {
        name: 1,
        event_id: 1,
        clubInCharge: 1,
        event_type: 1,
        startDate: 1,
        endDate: 1,
        createdAt: 1,
        updatedAt: 1,
        maxApplications: 1,
        registrationCount: {
          $cond: {
            if: { $eq: ["$event_type", "group"] },
            then: {
              $size: {
                $filter: {
                  input: "$eventTeams",
                  cond: { $eq: ["$$this.isRegistered", true] },
                },
              },
            },
            else: { $size: "$applications" },
          },
        },
        registeredTeamsCount: {
          $size: {
            $filter: {
              input: "$eventTeams",
              cond: { $eq: ["$$this.isRegistered", true] },
            },
          },
        },
        totalTeamsCount: { $size: "$eventTeams" },
        registrations: {
          $map: {
            input: "$applications",
            as: "app",
            in: {
              userId: "$$app.userId",
              teamId: "$$app.teamId",
              registeredAt: "$$app.registeredAt",
              appliedAt: "$$app.appliedAt",
              user: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: "$applicants",
                      cond: { $eq: ["$$this._id", "$$app.userId"] },
                    },
                  },
                  0,
                ],
              },
            },
          },
        },
        eventTeams: {
          $filter: {
            input: "$eventTeams",
            cond: { $eq: ["$$this.isRegistered", true] },
          },
        },
      },
    },
    { $sort: { createdAt: -1 } },
  ]);

  // Get team details for registered teams
  for (let event of clubEventsWithRegistrations) {
    if (event.eventTeams && event.eventTeams.length > 0) {
      const populatedTeams = await TeamModel.populate(event.eventTeams, [
        { path: "leader", select: "name email dept year" },
        { path: "members.userId", select: "name email level degree dept year" },
      ]);
      event.eventTeams = populatedTeams;
    }
  }

  // Format registrations data
  const eventsWithFormattedRegistrations = clubEventsWithRegistrations.map(
    (event) => ({
      ...event,
      availableSeats: event.maxApplications
        ? event.maxApplications - event.registrationCount
        : null,
      registrations: event.registrations.map((reg) => ({
        userId: reg.userId,
        teamId: reg.teamId,
        registeredAt: reg.registeredAt || reg.appliedAt,
        userName: reg.user?.name || "Unknown",
        userEmail: reg.user?.email || "Unknown",
        userDept: reg.user?.dept || "Unknown",
        userYear: reg.user?.year || "Unknown",
      })),
      teams: event.eventTeams.map((team) => ({
        _id: team._id,
        teamName: team.teamName,
        leader: {
          name: team.leader?.name || "Unknown",
          email: team.leader?.email || "Unknown",
          dept: team.leader?.dept || "Unknown",
          year: team.leader?.year || "Unknown",
        },
        members: team.members.map((member) => ({
          name: member.userId?.name || "Unknown",
          email: member.userId?.email || "Unknown",
          dept: member.userId?.dept || "Unknown",
          year: member.userId?.year || "Unknown",
          joinedAt: member.joinedAt,
        })),
        memberCount: team.members.length,
        registeredAt: team.registeredAt,
      })),
    })
  );

  // Calculate total registrations for club events
  const totalRegistrations = clubEventsWithRegistrations.reduce(
    (sum, event) => sum + event.registrationCount,
    0
  );

  // Calculate total registered teams for club events
  const totalRegisteredTeams = clubEventsWithRegistrations.reduce(
    (sum, event) => sum + event.registeredTeamsCount,
    0
  );

  // Recent registrations for club events (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentRegistrations = clubEventsWithRegistrations.reduce(
    (sum, event) => {
      const recentApps = event.registrations.filter(
        (reg) => new Date(reg.registeredAt || reg.appliedAt) >= sevenDaysAgo
      );
      return sum + recentApps.length;
    },
    0
  );
  // Upcoming events
  const upcomingEvents = clubEventsWithRegistrations.filter(
    (event) => event.startDate && new Date(event.startDate) > new Date()
  ).length;

  // Past events
  const pastEvents = clubEventsWithRegistrations.filter(
    (event) => event.endDate && new Date(event.endDate) < new Date()
  ).length;

  res.status(200).json({
    success: true,
    stats: {
      totalEvents: clubEventsWithRegistrations.length,
      upcomingEvents,
      pastEvents,
      totalRegistrations,
      totalRegisteredTeams,
      recentRegistrations,
      clubName: userClub,
    },
    events: eventsWithFormattedRegistrations,
    lastUpdated: new Date().toISOString(),
  });
});

// Get department-wise registration stats (Admin only)
const getDeptRegistrationStats = catchAsyncError(async (req, res, next) => {
  const user = req.user;
  // allow admins and superadmins
  if (!user) return next(new ErrorHandler("Not authenticated", 401));

  // If admin is event-specific, limit to that event
  const isEventSpecificAdmin =
    user.role === "admin" && !user.isSuperAdmin && user.assignedEvent;

  let eventMatch = {};
  if (isEventSpecificAdmin) {
    eventMatch = {
      $match: { _id: new mongoose.Types.ObjectId(user.assignedEvent) },
    };
  }
  // Aggregate department counts from individual applications, grouped by dept+gender
  const appPipeline = [
    ...(isEventSpecificAdmin ? [eventMatch] : []),
    { $unwind: "$applications" },
    {
      $lookup: {
        from: "users",
        localField: "applications.userId",
        foreignField: "_id",
        as: "appUser",
      },
    },
    { $unwind: { path: "$appUser", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        dept: { $ifNull: ["$appUser.dept", "Unknown"] },
        gender: { $toLower: { $ifNull: ["$appUser.gender", "unknown"] } },
      },
    },
    {
      $group: {
        _id: { dept: "$dept", gender: "$gender" },
        count: { $sum: 1 },
      },
    },
  ];

  // Aggregate department counts from registered teams (leader + members), grouped by dept+gender
  const teamPipeline = [
    ...(isEventSpecificAdmin ? [eventMatch] : []),
    {
      $lookup: {
        from: "teams",
        localField: "_id",
        foreignField: "eventId",
        as: "teams",
      },
    },
    { $unwind: { path: "$teams", preserveNullAndEmptyArrays: true } },
    { $match: { "teams.isRegistered": true } },
    {
      $project: {
        uids: {
          $concatArrays: [
            {
              $cond: [
                { $ifNull: ["$teams.leader", false] },
                ["$teams.leader"],
                [],
              ],
            },
            { $ifNull: ["$teams.members.userId", []] },
          ],
        },
      },
    },
    { $unwind: { path: "$uids", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "users",
        localField: "uids",
        foreignField: "_id",
        as: "teamUser",
      },
    },
    { $unwind: { path: "$teamUser", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        dept: { $ifNull: ["$teamUser.dept", "Unknown"] },
        gender: { $toLower: { $ifNull: ["$teamUser.gender", "unknown"] } },
      },
    },
    {
      $group: {
        _id: { dept: "$dept", gender: "$gender" },
        count: { $sum: 1 },
      },
    },
  ];

  const [appAgg, teamAgg] = await Promise.all([
    EventModel.aggregate(appPipeline),
    EventModel.aggregate(teamPipeline),
  ]);

  // Combine aggregates into per-department male/female counts
  const counts = {}; // dept -> { male, female, unknown, total }

  const merge = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const r of arr) {
      const dept = (r._id && r._id.dept) || "Unknown";
      const rawGender = (r._id && r._id.gender) || "unknown";
      const gender = String(rawGender).toLowerCase().trim();
      if (!counts[dept])
        counts[dept] = { male: 0, female: 0, unknown: 0, total: 0 };
      const cnt = r.count || 0;
      if (gender === "male") counts[dept].male += cnt;
      else if (gender === "female") counts[dept].female += cnt;
      else counts[dept].unknown += cnt;
      counts[dept].total += cnt;
    }
  };

  merge(appAgg);
  merge(teamAgg);

  const deptStats = Object.keys(counts)
    .map((dept) => ({ dept, ...counts[dept] }))
    .sort((a, b) => b.total - a.total);

  res.status(200).json({ success: true, data: deptStats });
});

// Seed database with events (Super Admin only) - ONE-TIME USE
const seedDatabaseEvents = catchAsyncError(async (req, res, next) => {
  // Only super admin can run seeding
  if (!req.user.isSuperAdmin) {
    return next(
      new ErrorHandler("Access denied: Only super admin can seed database", 403)
    );
  }

  try {
    // Import the seeding function
    const seedFinalEvents = require("../utils/final-seeder");

    // Check if events already exist
    const eventCount = await EventModel.countDocuments();

    if (eventCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Database already contains ${eventCount} events. Seeding skipped to prevent duplicates.`,
        eventsCount: eventCount,
      });
    }

    console.log("🌱 Starting database seeding via admin endpoint...");

    // Run the seeding function
    await seedFinalEvents();

    // Get the final count
    const finalEventCount = await EventModel.countDocuments();

    res.status(200).json({
      success: true,
      message: "Database seeded successfully!",
      eventsSeeded: finalEventCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Seeding error:", error);
    return next(new ErrorHandler(`Seeding failed: ${error.message}`, 500));
  }
});

// Debug endpoint to check SMTP configuration (Super Admin only)
const checkEmailConfig = catchAsyncError(async (req, res, next) => {
  console.log("🔍 Checking email configuration...");

  const config = {
    SMTP_HOST: process.env.SMTP_HOST || "NOT SET",
    SMTP_PORT: process.env.SMTP_PORT || "NOT SET",
    SMTP_USER: process.env.SMTP_USER || "NOT SET",
    SMTP_PASS: process.env.SMTP_PASS ? "***SET***" : "NOT SET",
    SMTP_FROM_NAME: process.env.SMTP_FROM_NAME || "NOT SET",
    SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL || "NOT SET",
    NODE_ENV: process.env.NODE_ENV || "NOT SET",
  };

  console.log("Email config:", config);

  // Test email sending
  let emailTest = { success: false, error: null };

  try {
    // Try to send a test email to the admin
    await sendEmail({
      email: req.user.email,
      subject: "SMTP Configuration Test",
      message: `This is a test email to verify SMTP configuration.\n\nSent at: ${new Date().toISOString()}\nEnvironment: ${
        process.env.NODE_ENV
      }\nServer: Railway`,
    });

    emailTest = { success: true, error: null };
    console.log("✅ Test email sent successfully");
  } catch (error) {
    emailTest = {
      success: false,
      error: {
        message: error.message,
        code: error.code,
        command: error.command,
      },
    };
    console.error("❌ Test email failed:", error);
  }

  res.status(200).json({
    success: true,
    message: "Email configuration check completed",
    config,
    emailTest,
  });
});

// Update all event dates to August 30th, 2025 (Super Admin only)
const updateEventDates = catchAsyncError(async (req, res, next) => {
  console.log("📅 Updating all event dates to August 30th, 2025...");

  try {
    // New date: August 30th, 2025
    const newEventDate = new Date("2025-08-30T10:00:00.000Z");

    const result = await EventModel.updateMany(
      {}, // Update all events
      {
        $set: {
          event_date: newEventDate,
        },
      }
    );

    console.log(`✅ Updated ${result.modifiedCount} events successfully`);

    // Verify the update
    const sampleEvents = await EventModel.find({})
      .limit(3)
      .select("name event_date");
    console.log(
      "📋 Sample updated events:",
      sampleEvents.map((e) => ({
        name: e.name,
        date: e.event_date,
      }))
    );

    res.status(200).json({
      success: true,
      message: `Successfully updated ${result.modifiedCount} event dates to August 30th, 2025`,
      modifiedCount: result.modifiedCount,
      sampleEvents: sampleEvents.map((e) => ({
        name: e.name,
        date: e.event_date,
      })),
    });
  } catch (error) {
    console.error("❌ Error updating event dates:", error);
    return next(
      new ErrorHandler(`Failed to update event dates: ${error.message}`, 500)
    );
  }
});

// Super Admin only: Update Treasure Hunt with gender-based team restrictions
const updateTreasureHuntGender = catchAsyncError(async (req, res, next) => {
  // Check if user is super admin
  if (!req.user.isSuperAdmin) {
    return next(new ErrorHandler("Access denied. Super admin required.", 403));
  }

  try {
    const result = await EventModel.updateOne(
      { event_id: "E012" },
      {
        $set: {
          hasGenderBasedTeams: true,
          maxBoyTeams: 15,
          maxGirlTeams: 15,
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Treasure Hunt event not found (E012)",
      });
    }

    if (result.modifiedCount === 0) {
      return res.status(200).json({
        success: true,
        message: "Treasure Hunt already has gender-based team configuration",
        alreadyConfigured: true,
      });
    }

    // Verify the update
    const updatedEvent = await EventModel.findOne({ event_id: "E012" });

    res.status(200).json({
      success: true,
      message: "Treasure Hunt successfully configured with gender-based teams",
      configuration: {
        hasGenderBasedTeams: updatedEvent.hasGenderBasedTeams,
        maxBoyTeams: updatedEvent.maxBoyTeams,
        maxGirlTeams: updatedEvent.maxGirlTeams,
      },
    });
  } catch (error) {
    return next(
      new ErrorHandler("Failed to update Treasure Hunt configuration", 500)
    );
  }
});

// Super Admin only: Update Divide and Conquer team limit
const updateDivideAndConquerLimit = catchAsyncError(async (req, res, next) => {
  // Check if user is super admin
  if (!req.user.isSuperAdmin) {
    return next(new ErrorHandler("Access denied. Super admin required.", 403));
  }

  try {
    const result = await EventModel.updateOne(
      { name: { $regex: /divide.*and.*conquer/i } },
      {
        $set: {
          maxApplications: 30,
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Divide and Conquer event not found",
      });
    }

    if (result.modifiedCount === 0) {
      return res.status(200).json({
        success: true,
        message: "Divide and Conquer limit already set to 30",
        alreadyConfigured: true,
      });
    }

    // Verify the update
    const updatedEvent = await EventModel.findOne({
      name: { $regex: /divide.*and.*conquer/i },
    });

    res.status(200).json({
      success: true,
      message: "Divide and Conquer team limit updated from 20 to 30",
      eventDetails: {
        name: updatedEvent.name,
        eventId: updatedEvent.event_id,
        oldLimit: 20,
        newLimit: updatedEvent.maxApplications,
      },
    });
  } catch (error) {
    return next(
      new ErrorHandler("Failed to update Divide and Conquer limit", 500)
    );
  }
});

// Super Admin only: Update Sherlock Holmes club assignment
const updateSherlockHolmesClub = catchAsyncError(async (req, res, next) => {
  // Check if user is super admin
  if (!req.user.isSuperAdmin) {
    return next(new ErrorHandler("Access denied. Super admin required.", 403));
  }

  try {
    // Find Sherlock Holmes event
    const sherlockEvent = await EventModel.findOne({
      $or: [{ name: { $regex: /sherlock.*holmes/i } }, { event_id: "E024" }],
    });

    if (!sherlockEvent) {
      return res.status(404).json({
        success: false,
        message: "Sherlock Holmes event not found",
      });
    }

    // Check if already assigned to Heritage
    if (
      sherlockEvent.clubInCharge === "Heritage" &&
      sherlockEvent.organizing_club === "Heritage"
    ) {
      return res.status(200).json({
        success: true,
        message: "Sherlock Holmes already assigned to Heritage",
        alreadyConfigured: true,
        eventDetails: {
          name: sherlockEvent.name,
          eventId: sherlockEvent.event_id,
          currentClub: sherlockEvent.clubInCharge,
          currentOrganizingClub: sherlockEvent.organizing_club,
        },
      });
    }

    // Update the club assignment
    const result = await EventModel.updateOne(
      { _id: sherlockEvent._id },
      {
        $set: {
          clubInCharge: "Heritage",
          organizing_club: "Heritage",
          updatedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({
        success: false,
        message: "Failed to update Sherlock Holmes club assignment",
      });
    }

    res.status(200).json({
      success: true,
      message: "Sherlock Holmes club updated from NSS to Heritage",
      eventDetails: {
        name: sherlockEvent.name,
        eventId: sherlockEvent.event_id,
        oldClub: "NSS",
        newClub: "Heritage",
      },
    });
  } catch (error) {
    return next(
      new ErrorHandler("Failed to update Sherlock Holmes club assignment", 500)
    );
  }
});

// Super Admin only: Run all event corrections (Divide & Conquer + Sherlock Holmes)
const runEventCorrections = catchAsyncError(async (req, res, next) => {
  // Check if user is super admin
  if (!req.user.isSuperAdmin) {
    return next(new ErrorHandler("Access denied. Super admin required.", 403));
  }

  try {
    const corrections = [];

    // 1. Update Divide and Conquer limit
    const divideAndConquer = await EventModel.findOne({
      name: { $regex: /divide.*and.*conquer/i },
    });

    if (divideAndConquer) {
      if (divideAndConquer.maxApplications !== 30) {
        await EventModel.updateOne(
          { _id: divideAndConquer._id },
          { $set: { maxApplications: 30, updatedAt: new Date() } }
        );
        corrections.push({
          type: "divide_and_conquer_limit",
          status: "updated",
          details: "Team limit updated from 20 to 30",
        });
      } else {
        corrections.push({
          type: "divide_and_conquer_limit",
          status: "already_correct",
          details: "Team limit already set to 30",
        });
      }
    } else {
      corrections.push({
        type: "divide_and_conquer_limit",
        status: "not_found",
        details: "Divide and Conquer event not found",
      });
    }

    // 2. Update Sherlock Holmes club
    const sherlockEvent = await EventModel.findOne({
      $or: [{ name: { $regex: /sherlock.*holmes/i } }, { event_id: "E024" }],
    });

    if (sherlockEvent) {
      if (
        sherlockEvent.clubInCharge !== "Heritage" ||
        sherlockEvent.organizing_club !== "Heritage"
      ) {
        await EventModel.updateOne(
          { _id: sherlockEvent._id },
          {
            $set: {
              clubInCharge: "Heritage",
              organizing_club: "Heritage",
              updatedAt: new Date(),
            },
          }
        );
        corrections.push({
          type: "sherlock_holmes_club",
          status: "updated",
          details: "Club changed from NSS to Heritage",
        });
      } else {
        corrections.push({
          type: "sherlock_holmes_club",
          status: "already_correct",
          details: "Already assigned to Heritage",
        });
      }
    } else {
      corrections.push({
        type: "sherlock_holmes_club",
        status: "not_found",
        details: "Sherlock Holmes event not found",
      });
    }

    const updatedCount = corrections.filter(
      (c) => c.status === "updated"
    ).length;

    res.status(200).json({
      success: true,
      message: `Event corrections completed. ${updatedCount} updates applied.`,
      corrections,
      totalUpdates: updatedCount,
    });
  } catch (error) {
    return next(new ErrorHandler("Failed to run event corrections", 500));
  }
});

// Super Admin only: Get current database update status
const getDatabaseUpdateStatus = catchAsyncError(async (req, res, next) => {
  // Check if user is super admin
  if (!req.user.isSuperAdmin) {
    return next(new ErrorHandler("Access denied. Super admin required.", 403));
  }

  try {
    // Check Treasure Hunt status
    const treasureHunt = await EventModel.findOne({ event_id: "E012" });
    const divideAndConquer = await EventModel.findOne({
      name: { $regex: /divide.*and.*conquer/i },
    });
    const sherlockHolmes = await EventModel.findOne({
      $or: [{ name: { $regex: /sherlock.*holmes/i } }, { event_id: "E024" }],
    });

    const status = {
      treasureHunt: {
        found: !!treasureHunt,
        configured: treasureHunt
          ? treasureHunt.hasGenderBasedTeams &&
            treasureHunt.maxBoyTeams === 15 &&
            treasureHunt.maxGirlTeams === 15
          : false,
        details: treasureHunt
          ? {
              name: treasureHunt.name,
              eventId: treasureHunt.event_id,
              hasGenderBasedTeams: treasureHunt.hasGenderBasedTeams || false,
              maxBoyTeams: treasureHunt.maxBoyTeams || null,
              maxGirlTeams: treasureHunt.maxGirlTeams || null,
            }
          : null,
      },
      divideAndConquer: {
        found: !!divideAndConquer,
        configured: divideAndConquer
          ? divideAndConquer.maxApplications === 30
          : false,
        details: divideAndConquer
          ? {
              name: divideAndConquer.name,
              eventId: divideAndConquer.event_id,
              maxApplications: divideAndConquer.maxApplications,
            }
          : null,
      },
      sherlockHolmes: {
        found: !!sherlockHolmes,
        configured: sherlockHolmes
          ? sherlockHolmes.clubInCharge === "Heritage" &&
            sherlockHolmes.organizing_club === "Heritage"
          : false,
        details: sherlockHolmes
          ? {
              name: sherlockHolmes.name,
              eventId: sherlockHolmes.event_id,
              clubInCharge: sherlockHolmes.clubInCharge,
              organizing_club: sherlockHolmes.organizing_club,
            }
          : null,
      },
    };

    res.status(200).json({
      success: true,
      message: "Database update status retrieved successfully",
      status,
      needsUpdate:
        !status.treasureHunt.configured ||
        !status.divideAndConquer.configured ||
        !status.sherlockHolmes.configured,
    });
  } catch (error) {
    return next(new ErrorHandler("Failed to get database update status", 500));
  }
});

// Get all events with admin assignment status (Super Admin only)
const getEventsWithAdminStatus = catchAsyncError(async (req, res, next) => {
  // Check if user is super admin
  if (!req.user.isSuperAdmin) {
    return next(new ErrorHandler("Access denied. Super admin only.", 403));
  }

  try {
    // Get all events
    const events = await EventModel.find().sort({ name: 1 });

    // Get all admin assignments
    const adminAssignments = await UserModel.find(
      {
        role: "admin",
        assignedEvent: { $exists: true },
      },
      { assignedEvent: 1, email: 1, name: 1 }
    );

    // Get all pending invites
    const AdminInvite = require("../models/adminInvite");
    const pendingInvites = await AdminInvite.find(
      {
        isUsed: false,
        inviteTokenExpire: { $gt: Date.now() },
      },
      { eventId: 1, email: 1 }
    );

    // Create a map of event assignments
    const eventAdminMap = {};
    const eventInviteMap = {};

    // Map assigned admins
    adminAssignments.forEach((admin) => {
      eventAdminMap[admin.assignedEvent.toString()] = {
        adminId: admin._id,
        adminEmail: admin.email,
        adminName: admin.name,
        status: "assigned",
      };
    });

    // Map pending invites
    pendingInvites.forEach((invite) => {
      if (invite.eventId && !eventAdminMap[invite.eventId.toString()]) {
        eventInviteMap[invite.eventId.toString()] = {
          inviteEmail: invite.email,
          status: "pending",
        };
      }
    });

    // Combine events with admin status
    const eventsWithAdminStatus = events.map((event) => ({
      _id: event._id,
      name: event.name,
      event_type: event.event_type,
      clubInCharge: event.clubInCharge,
      organizing_club: event.organizing_club,
      adminStatus: eventAdminMap[event._id.toString()] ||
        eventInviteMap[event._id.toString()] || { status: "available" },
    }));

    res.status(200).json({
      success: true,
      events: eventsWithAdminStatus,
    });
  } catch (error) {
    console.error("Error getting events with admin status:", error);
    return next(
      new ErrorHandler("Failed to fetch events with admin status", 500)
    );
  }
});

// Update event attendance (Admin only)
const updateEventAttendance = catchAsyncError(async (req, res, next) => {
  const { eventId } = req.params;
  const { attendance } = req.body; // [{ userId, isPresent }]

  if (!eventId || !Array.isArray(attendance)) {
    return next(new ErrorHandler("Missing eventId or attendance data", 400));
  }

  // For each attendance entry, update or create isPresent field in the matching application
  for (const { userId, isPresent } of attendance) {
    console.log(
      `[DEBUG][Attendance Update] userId to update:`,
      userId,
      `eventId:`,
      eventId,
      `isPresent:`,
      isPresent
    );
    let objectUserId = userId;
    if (typeof userId === "string" && mongoose.Types.ObjectId.isValid(userId)) {
      objectUserId = new mongoose.Types.ObjectId(userId);
    }
    await EventModel.updateOne(
      { event_id: eventId, "applications.userId": objectUserId },
      { $set: { "applications.$.isPresent": isPresent } },
      { upsert: false }
    );
  }

  res.status(200).json({ success: true, message: "Attendance updated" });
});

// Update winners for an event (Admin only)
const updateEventWinners = catchAsyncError(async (req, res, next) => {
  console.log("=== NEW updateEventWinners function called ===");
  const { eventId } = req.params;
  const { winners } = req.body;

  console.log("EventId:", eventId);
  console.log("Winners data received:", JSON.stringify(winners, null, 2));

  if (!eventId || !Array.isArray(winners)) {
    console.log("Invalid input - missing eventId or winners data");
    return next(new ErrorHandler("Missing eventId or winners data", 400));
  }

  // Load event
  const event = await EventModel.findOne({ event_id: eventId });
  if (!event) return next(new ErrorHandler("Event not found", 404));

  console.log("Found event:", {
    _id: event._id,
    event_id: event.event_id, 
    name: event.name,
    currentWinners: event.winners || "No winners field yet"
  });

  // Prepare winners array - store team IDs for group events, user IDs for solo events
  const winnersArray = [];

  for (const winner of winners) {
    const winnerEntry = {
      rank: winner.winnerRank || winner.position || winnersArray.length + 1,
    };

    if (winner.groupId || winner.teamId) {
      // Group event - store team/group ID
      winnerEntry.teamId = winner.groupId || winner.teamId;
      winnerEntry.teamName = winner.groupName || winner.teamName;
    } else if (winner.userId) {
      // Solo event - store user ID
      winnerEntry.userId = winner.userId;
    }

    winnersArray.push(winnerEntry);
  }

  // Sort winners by rank
  winnersArray.sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity));

  console.log("Final winnersArray to be saved:", JSON.stringify(winnersArray, null, 2));

  // Update the event with the new winners array field
  const updateResult = await EventModel.updateOne(
    { event_id: eventId },
    { 
      $set: { 
        winners: winnersArray,
        winnersUpdatedAt: new Date()
      } 
    }
  );

  console.log("Event update result:", updateResult);

  // Verify the update by fetching the document again
  const updatedEvent = await EventModel.findOne({ event_id: eventId });
  console.log("Verification - Event after update:", {
    _id: updatedEvent._id,
    event_id: updatedEvent.event_id,
    winners: updatedEvent.winners,
    winnersUpdatedAt: updatedEvent.winnersUpdatedAt
  });

  // Since applications array is empty, we need to update the teams collection for winners
  // For teams, mark the teams as winners in the teams collection
  for (const winnerEntry of winnersArray) {
    if (winnerEntry.teamId) {
      console.log(`Updating team ${winnerEntry.teamId} as winner with rank ${winnerEntry.rank}`);
      await TeamModel.updateMany(
        { 
          eventId: event._id,
          $or: [
            { _id: new mongoose.Types.ObjectId(winnerEntry.teamId) },
            { teamId: winnerEntry.teamId }
          ]
        },
        { 
          $set: { 
            isWinner: true, 
            winnerRank: winnerEntry.rank 
          } 
        }
      );
      
      // Also update individual users in the team
      const teams = await TeamModel.find({
        eventId: event._id,
        $or: [
          { _id: new mongoose.Types.ObjectId(winnerEntry.teamId) },
          { teamId: winnerEntry.teamId }
        ]
      }).populate(['leader', 'members']);
      
      for (const team of teams) {
        const userIds = [];
        if (team.leader) userIds.push(team.leader._id);
        if (team.members) userIds.push(...team.members.map(m => m._id));
        
        if (userIds.length > 0) {
          console.log(`Updating ${userIds.length} users in team ${winnerEntry.teamId} as winners`);
          await UserModel.updateMany(
            { _id: { $in: userIds } },
            { $set: { isWinner: true } }
          );
        }
      }
    } else if (winnerEntry.userId) {
      // For individual events, update user directly
      console.log(`Updating user ${winnerEntry.userId} as winner with rank ${winnerEntry.rank}`);
      await UserModel.updateOne(
        { _id: new mongoose.Types.ObjectId(winnerEntry.userId) },
        { $set: { isWinner: true } }
      );
    }
  }

  // Reset non-winners in teams collection for this event
  const winnerTeamIds = winnersArray.filter(w => w.teamId).map(w => w.teamId);
  if (winnerTeamIds.length > 0) {
    await TeamModel.updateMany(
      { 
        eventId: event._id,
        _id: { $nin: winnerTeamIds.map(id => new mongoose.Types.ObjectId(id)) }
      },
      { 
        $set: { 
          isWinner: false, 
          winnerRank: null 
        } 
      }
    );
  }

  // Return response with the new winners array
  console.log("=== Winners update completed successfully ===");
  return res.status(200).json({
    success: true,
    message: "Winners updated successfully",
    winners: winnersArray,
    event: { event_id: event.event_id, name: event.name },
  });
});

// Get registrations for a specific event (Admin only)
const getEventRegistrations = catchAsyncError(async (req, res, next) => {
  const { eventId } = req.params;

  if (!eventId) {
    return next(new ErrorHandler("Event ID is required", 400));
  }

  // Find the event
  const event = await EventModel.findOne({ event_id: eventId });
  if (!event) {
    return next(new ErrorHandler("Event not found", 404));
  }

  // Check authorization: superadmin can view all events, regular admin can only view their assigned event
  if (!req.user.isSuperAdmin) {
    if (
      !req.user.assignedEvent ||
      req.user.assignedEvent.toString() !== event._id.toString()
    ) {
      return next(
        new ErrorHandler(
          "You are not authorized to view this event's registrations",
          403
        )
      );
    }
  }

  // Get registrations based on event type
  let registrations = [];

  if (event.event_type === "group") {
    // For group events, get registered teams with their members
    const teams = await TeamModel.find({
      eventId: event._id,
      isRegistered: true,
    }).populate([
      // include attendance map so we can read attendance.<event_id>
      {
        path: "leader",
        select: "name email dept year rollNo attendance isPresent isWinner",
      },
      {
        path: "members.userId",
        select: "name email dept year rollNo attendance isPresent isWinner",
      },
    ]);

    // Flatten teams into individual registrations
    for (const team of teams) {
      // Add leader
      if (team.leader) {
        registrations.push({
          _id: team.leader._id,
          name: team.leader.name,
          email: team.leader.email,
          dept: team.leader.dept,
          year: team.leader.year,
          rollNo: team.leader.rollNo,
          teamName: team.teamName,
          teamId: team._id,
          role: "Leader",
          registeredAt: team.createdAt,
          attended:
            team.leader?.attendance?.[event.event_id] ??
            team.leader?.isPresent ??
            false,
        });
      }

      // Add members
      if (team.members && team.members.length > 0) {
        for (const member of team.members) {
          if (member.userId) {
            registrations.push({
              _id: member.userId._id,
              name: member.userId.name,
              email: member.userId.email,
              dept: member.userId.dept,
              year: member.userId.year,
              rollNo: member.userId.rollNo,
              teamName: team.teamName,
              teamId: team._id,
              role: "Member",
              registeredAt: team.createdAt,
              attended:
                member.userId?.attendance?.[event.event_id] ??
                member.userId?.isPresent ??
                false,
            });
          }
        }
      }
    }
  } else {
    // For individual events, get applications with user data
    const eventWithApplications = await EventModel.findOne({
      event_id: eventId,
    }).populate({
      path: "applications.userId",
      select: "name email dept year rollNo attendance isPresent isWinner",
    });

    if (eventWithApplications && eventWithApplications.applications) {
      registrations = eventWithApplications.applications.map((app) => ({
        _id: app.userId._id,
        name: app.userId.name,
        email: app.userId.email,
        dept: app.userId.dept,
        year: app.userId.year,
        rollNo: app.userId.rollNo,
        teamName: null,
        teamId: null,
        role: "Individual",
        registeredAt: app.registeredAt || app.appliedAt,
        attended:
          app.userId?.attendance?.[eventWithApplications.event_id] ??
          app.isPresent ??
          false,
      }));
    }
  }

  res.status(200).json({
    success: true,
    event: {
      _id: event._id,
      name: event.name,
      event_id: event.event_id,
      event_type: event.event_type,
      date: event.date,
    },
    registrations,
  });
});

// Update attendance for a specific registration (Admin only)
const updateRegistrationAttendance = catchAsyncError(async (req, res, next) => {
  const { eventId, registrationId } = req.params;
  const { attended } = req.body;

  if (!eventId || !registrationId || attended === undefined) {
    return next(new ErrorHandler("Missing required parameters", 400));
  }

  // Find the event
  const event = await EventModel.findOne({ event_id: eventId });
  if (!event) {
    return next(new ErrorHandler("Event not found", 404));
  }

  // Check authorization
  if (!req.user.isSuperAdmin) {
    if (
      !req.user.assignedEvent ||
      req.user.assignedEvent.toString() !== event._id.toString()
    ) {
      return next(
        new ErrorHandler(
          "You are not authorized to update attendance for this event",
          403
        )
      );
    }
  }

  let updateResult;

  if (event.event_type === "group") {
    // For group events, update attendance in the user model
    updateResult = await UserModel.updateOne(
      { _id: registrationId },
      { $set: { [`attendance.${eventId}`]: attended } }
    );
  } else {
    // For individual events, update isPresent in the event's applications
    updateResult = await EventModel.updateOne(
      { event_id: eventId, "applications.userId": registrationId },
      { $set: { "applications.$.isPresent": attended } }
    );
  }

  if (updateResult.matchedCount === 0) {
    return next(new ErrorHandler("Registration not found", 404));
  }

  res.status(200).json({
    success: true,
    message: "Attendance updated successfully",
  });
});

// Create a new admin (SuperAdmin only)
const createAdmin = catchAsyncError(async (req, res, next) => {
  const { name, email, assignedEventId, club, tempPassword } = req.body;

  // Check if the current user is a SuperAdmin
  if (!req.user.isSuperAdmin || req.user.role !== "admin") {
    return next(new ErrorHandler("Only SuperAdmins can create admins", 403));
  }

  // Validate required fields
  if (!name || !email || !assignedEventId || !club) {
    return next(
      new ErrorHandler(
        "Name, email, assigned event, and club are required",
        400
      )
    );
  }

  // Check if user with this email already exists
  const existingUser = await UserModel.findOne({ email });
  if (existingUser) {
    return next(new ErrorHandler("User with this email already exists", 400));
  }

  // Verify that the assigned event exists
  const assignedEvent = await EventModel.findById(assignedEventId);
  if (!assignedEvent) {
    return next(new ErrorHandler("Assigned event not found", 404));
  }

  // Generate a temporary password if not provided
  const password = tempPassword || crypto.randomBytes(8).toString("hex");

  try {
    // Create the admin user
    const adminUser = await UserModel.create({
      name,
      email,
      password,
      role: "admin",
      isSuperAdmin: false,
      assignedEvent: assignedEventId,
      club,
      college: "MSEC", // Default college for admins
      city: "Chennai", // Default city for admins
      level: "UG", // Default level for admins
      degree: "BTech", // Default degree for admins
      dept: "Computer Science Engineering", // Default department for admins
      year: "0", // Default year for admins
      gender: "Male", // Default gender for admins
      phoneNumber: "9999999999", // Default phone for admins
      isVerified: true, // Admins are verified by default
      invitedBy: req.user._id, // Track who created this admin
    });

    // Send email with login credentials
    const emailSubject = "Admin Account Created - Legacy'25";
    const emailMessage = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Welcome to Legacy'25 Admin Panel</h2>
        <p>Dear ${name},</p>
        <p>Your admin account has been created by SuperAdmin <strong>${req.user.name}</strong>.</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3>Login Credentials:</h3>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Temporary Password:</strong> ${password}</p>
          <p><strong>Assigned Event:</strong> ${assignedEvent.name}</p>
          <p><strong>Club:</strong> ${club}</p>
        </div>
        
        <p style="color: #e74c3c; font-weight: bold;">
          ⚠️ Please change your password immediately after first login for security purposes.
        </p>
        
        <p>You can access the admin panel at: <a href="${process.env.FRONTEND_URL}/auth/signin">Login to Admin Panel</a></p>
        
        <p>Best regards,<br>Legacy'25 SuperAdmin Team</p>
      </div>
    `;

    await sendEmail({
      email: adminUser.email,
      subject: emailSubject,
      message: emailMessage,
    });

    res.status(201).json({
      success: true,
      message: "Admin created successfully and credentials sent via email",
      admin: {
        id: adminUser._id,
        name: adminUser.name,
        email: adminUser.email,
        club: adminUser.club,
        assignedEvent: {
          id: assignedEvent._id,
          name: assignedEvent.name,
        },
        createdAt: adminUser.createdAt,
      },
      tempPassword: password, // Include in response for SuperAdmin reference
    });
  } catch (error) {
    console.error("Error creating admin:", error);
    return next(new ErrorHandler("Failed to create admin", 500));
  }
});

// Get all events for admin assignment dropdown
const getEventsForAdminAssignment = catchAsyncError(async (req, res, next) => {
  // Check if the current user is a SuperAdmin
  if (!req.user.isSuperAdmin || req.user.role !== "admin") {
    return next(
      new ErrorHandler("Only SuperAdmins can access this endpoint", 403)
    );
  }

  try {
    const events = await EventModel.find({
      isActive: true,
      isArchived: false,
    })
      .select("_id name event_type club organizing_club event_date")
      .sort({ event_date: 1 });

    res.status(200).json({
      success: true,
      events,
    });
  } catch (error) {
    console.error("Error fetching events for admin assignment:", error);
    return next(new ErrorHandler("Failed to fetch events", 500));
  }
});

// Change admin password (SuperAdmin only)
const changeAdminPassword = catchAsyncError(async (req, res, next) => {
  // Check if the current user is a SuperAdmin
  if (!req.user.isSuperAdmin || req.user.role !== "admin") {
    return next(
      new ErrorHandler("Only SuperAdmins can change admin passwords", 403)
    );
  }

  const { adminId } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.trim().length < 6) {
    return next(
      new ErrorHandler("Password must be at least 6 characters long", 400)
    );
  }

  try {
    // Find the admin user
    const admin = await User.findById(adminId);
    if (!admin) {
      return next(new ErrorHandler("Admin not found", 404));
    }

    if (admin.role !== "admin") {
      return next(new ErrorHandler("User is not an admin", 400));
    }

    // Update the password
    admin.password = newPassword;
    await admin.save();

    res.status(200).json({
      success: true,
      message: `Password updated successfully for admin: ${admin.name}`,
    });
  } catch (error) {
    console.error("Error changing admin password:", error);
    return next(new ErrorHandler("Failed to change admin password", 500));
  }
});

// Get college registration statistics
const getCollegeRegistrationStats = catchAsyncError(async (req, res, next) => {
  const user = req.user;
  // allow admins and superadmins
  if (!user) return next(new ErrorHandler("Not authenticated", 401));

  // If admin is event-specific, limit to that event
  const isEventSpecificAdmin =
    user.role === "admin" && !user.isSuperAdmin && user.assignedEvent;

  let query = {};
  if (isEventSpecificAdmin) {
    query.eventId = new mongoose.Types.ObjectId(user.assignedEvent);
  }

  try {
    console.log("Starting college registration stats query...");
    console.log("Is event specific admin:", isEventSpecificAdmin);
    if (isEventSpecificAdmin) {
      console.log("Assigned event:", user.assignedEvent);
    }

    // Get all registrations that match our criteria
    const registrations = await EventRegistration.find(query).lean();
    console.log("Found registrations count:", registrations.length);
    console.log("Sample registrations:", registrations.slice(0, 3));

    // Aggregate data by college and gender
    const combined = {};
    registrations.forEach((registration) => {
      const college = registration.collegeName || "Unknown";
      const gender = (registration.gender || "unknown").toLowerCase();

      if (!combined[college]) {
        combined[college] = {
          college,
          male: 0,
          female: 0,
          unknown: 0,
          total: 0,
        };
      }

      combined[college][gender] += 1;
      combined[college].total += 1;
    });

    const data = Object.values(combined).sort((a, b) => b.total - a.total);
    console.log("Final college stats data:", data);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error in getCollegeRegistrationStats:", error);
    return next(new ErrorHandler("Failed to fetch college statistics", 500));
  }
});

// Get event participants from EventRegistrations collection
const getEventParticipants = catchAsyncError(async (req, res, next) => {
  const { eventId } = req.params;

  try {
    console.log("Fetching participants for event:", eventId);

    // Import EventRegistration model
    const EventRegistration = require("../models/eventRegistrations");

    // First, find the event to get its ObjectId
    const event = await EventModel.findOne({ event_id: eventId });
    if (!event) {
      return next(new ErrorHandler("Event not found", 404));
    }

    // Fetch participants from EventRegistrations collection
    const participants = await EventRegistration.find({ 
      eventId: event._id 
    }).populate('registrantId', 'name email phoneNumber college city dept year level degree gender');

    console.log(`Found ${participants.length} participants for event ${eventId}`);

    // Transform the data to include registrant information
    const participantsWithRegistrant = participants.map(participant => ({
      ...participant.toObject(),
      userId: participant._id, // Use participant document _id for frontend compatibility
      registrant: participant.registrantId ? {
        name: participant.registrantId.name,
        email: participant.registrantId.email,
        phoneNumber: participant.registrantId.phoneNumber,
        college: participant.registrantId.college,
        city: participant.registrantId.city,
        dept: participant.registrantId.dept,
        year: participant.registrantId.year,
        level: participant.registrantId.level,
        degree: participant.registrantId.degree,
        gender: participant.registrantId.gender
      } : null,
      // Ensure attendance fields exist (for existing documents that might not have them)
      isPresent: participant.isPresent || false,
      attendanceMarkedAt: participant.attendanceMarkedAt || null
    }));

    res.status(200).json({
      success: true,
      data: {
        participants: participantsWithRegistrant,
        totalParticipants: participants.length,
        eventId: eventId,
        eventName: event.name
      }
    });

  } catch (error) {
    console.error("Error in getEventParticipants:", error);
    return next(new ErrorHandler("Failed to fetch event participants", 500));
  }
});

// Update attendance for event participants
const updateAttendance = catchAsyncError(async (req, res, next) => {
  const { eventId } = req.params;
  const { attendance } = req.body; // Array of {userId: registrantId, isPresent: boolean}

  try {
    // First, find the event to get its ObjectId
    const event = await EventModel.findOne({ event_id: eventId });
    if (!event) {
      return next(new ErrorHandler("Event not found", 404));
    }

    // Update attendance for each participant
    const updatePromises = attendance.map(async (attendanceRecord) => {
      const { userId, isPresent } = attendanceRecord;
      
      try {
        // Convert userId string to ObjectId
        const objectId = new mongoose.Types.ObjectId(userId);
        
        // Update the EventRegistration document by _id
        const updateResult = await EventRegistration.updateOne(
          { 
            _id: objectId
          },
          { 
            $set: { 
              isPresent: isPresent,
              attendanceMarkedAt: new Date()
            }
          },
          { 
            upsert: false
          }
        );
        
        return updateResult;
        
      } catch (error) {
        console.error(`Error updating attendance for ${userId}:`, error);
        return { matchedCount: 0, modifiedCount: 0, error: error.message };
      }
    });

    const results = await Promise.all(updatePromises);
    const updatedCount = results.filter(result => result.modifiedCount > 0).length;
    const matchedCount = results.filter(result => result.matchedCount > 0).length;
    const errorCount = results.filter(result => result.error).length;

    res.status(200).json({
      success: true,
      message: `Attendance updated for ${updatedCount} participants`,
      data: {
        eventId: eventId,
        updatedCount: updatedCount,
        matchedCount: matchedCount,
        totalRequested: attendance.length,
        errorCount: errorCount
      }
    });

  } catch (error) {
    console.error("Error in updateAttendance:", error);
    return next(new ErrorHandler("Failed to update attendance", 500));
  }
});

module.exports = {
  createEvent,
  getAllEventsWithApplications,
  getEventDetails,
  updateEvent,
  deleteEvent,
  getAllUsers,
  updateUserRole,
  generateAdminInvite,
  sendAdminInviteEmail,
  acceptAdminInvite,
  getPendingInvites,
  getDashboardStats,
  getAdminsByClub,
  getAllAdmins,
  getAllEventRegistrations,
  getEventsWithRegistrations,
  getEventWithRegistrations,
  getEventWithRegistrationsV2,
  getEventRegistrations,
  updateRegistrationAttendance,
  updateEventWinners,
  getDeptRegistrationStats,
  getClubAdminStats,
  seedDatabaseEvents,
  checkEmailConfig,
  updateEventDates,
  updateTreasureHuntGender,
  updateDivideAndConquerLimit,
  updateSherlockHolmesClub,
  runEventCorrections,
  getDatabaseUpdateStatus,
  getEventsWithAdminStatus,
  updateEventAttendance,
  createAdmin,
  getEventsForAdminAssignment,
  getCollegeRegistrationStats,
  changeAdminPassword,
  getEventParticipants,
  updateAttendance,
};
