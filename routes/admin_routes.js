const express = require("express");
const {
  getEventDetails,
  createEvent,
  getAllEventsWithApplications,
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
  getDeptRegistrationStats,
  getEventRegistrations,
  updateEventWinners,
  updateRegistrationAttendance,
  getClubAdminStats,
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
  getEventParticipants,
  updateAttendance,
  // changeAdminPassword,
} = require("../controllers/adminController");
const {
  isAuthenticatedUser,
  authorizeRoles,
} = require("../middlewares/authenticate");
const superAdminAuth = require("../middlewares/superAdminAuth");
const router = express.Router();

// Dashboard routes
router
  .route("/admin/dashboard/stats")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getDashboardStats);

router
  .route("/admin/dashboard/events-registrations")
  .get(isAuthenticatedUser, superAdminAuth, getEventsWithRegistrations);

router
  .route("/admin/dashboard/all-registrations")
  .get(isAuthenticatedUser, superAdminAuth, getAllEventRegistrations);

router
  .route("/admin/dashboard/club-stats")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getClubAdminStats);

router
  .route("/admin/dashboard/dept-stats")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getDeptRegistrationStats);

router
  .route("/admin/dashboard/college-stats")
  .get(
    isAuthenticatedUser,
    authorizeRoles("admin"),
    getCollegeRegistrationStats
  );

// Users

// NOTE: department stats route handled by getDeptRegistrationStats above

// Event management routes
router
  .route("/admin/events")
  .get(
    isAuthenticatedUser,
    authorizeRoles("admin"),
    getAllEventsWithApplications
  )
  .post(isAuthenticatedUser, authorizeRoles("admin"), createEvent);

router
  .route("/admin/events/:id")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getEventDetails)
  .put(isAuthenticatedUser, authorizeRoles("admin"), updateEvent)
  .delete(isAuthenticatedUser, authorizeRoles("admin"), deleteEvent);

router
  .route("/admin/events/:eventId/winners")
  .put(isAuthenticatedUser, authorizeRoles("admin"), updateEventWinners);

router
  .route("/admin/events/:eventId/registrations")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getEventRegistrations);

router
  .route("/admin/events/:eventId/participants")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getEventParticipants);

router
  .route("/admin/events/:eventId/attendance")
  .put(isAuthenticatedUser, authorizeRoles("admin"), updateAttendance);

// New route: get a single event with aggregated registrations and teams
router
  .route("/admin/events/:id/with-registrations")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getEventWithRegistrations);

// Enhanced route: get event with comprehensive registration data from EventRegistrations model
router
  .route("/admin/events/:id/with-registrations-v2")
  .get(
    isAuthenticatedUser,
    authorizeRoles("admin"),
    getEventWithRegistrationsV2
  );

router
  .route("/admin/events/:eventId/registrations/:registrationId/attendance")
  .put(
    isAuthenticatedUser,
    authorizeRoles("admin"),
    updateRegistrationAttendance
  );

// Get events with admin assignment status (Super Admin only)
router
  .route("/admin/events-with-admin-status")
  .get(isAuthenticatedUser, superAdminAuth, getEventsWithAdminStatus);

// User management routes (Super Admin only)
router
  .route("/admin/users")
  .get(
    isAuthenticatedUser,
    authorizeRoles("admin"),
    superAdminAuth,
    getAllUsers
  );
router
  .route("/admin/users/:id/role")
  .put(
    isAuthenticatedUser,
    authorizeRoles("admin"),
    superAdminAuth,
    updateUserRole
  );
router
  .route("/admin/users/admins-by-club")
  .get(
    isAuthenticatedUser,
    authorizeRoles("admin"),
    superAdminAuth,
    getAdminsByClub
  );

// Get all admins for in-charge selection
router
  .route("/admin/users/all-admins")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAllAdmins);

// Admin invite routes (Super Admin only)
router
  .route("/admin/invite/generate")
  .post(
    isAuthenticatedUser,
    authorizeRoles("admin"),
    superAdminAuth,
    generateAdminInvite
  );
router
  .route("/admin/invite/send-email")
  .post(
    isAuthenticatedUser,
    authorizeRoles("admin"),
    superAdminAuth,
    sendAdminInviteEmail
  );
router
  .route("/admin/invite/pending")
  .get(
    isAuthenticatedUser,
    authorizeRoles("admin"),
    superAdminAuth,
    getPendingInvites
  );

// Public route for accepting invites (no auth required)
router.route("/admin/invite/accept/:token").post(acceptAdminInvite);

// Admin creation routes (Super Admin only)
router
  .route("/admin/create-admin")
  .post(
    isAuthenticatedUser,
    authorizeRoles("admin"),
    superAdminAuth,
    createAdmin
  );

router
  .route("/admin/events-for-assignment")
  .get(
    isAuthenticatedUser,
    authorizeRoles("admin"),
    superAdminAuth,
    getEventsForAdminAssignment
  );

// Change admin password route (Super Admin only)
// router
//   .route("/admin/change-admin-password/:adminId")
//   .put(
//     isAuthenticatedUser,
//     authorizeRoles("admin"),
//     superAdminAuth,
//     changeAdminPassword
//   );

// Update event dates route (Super Admin only)
router
  .route("/admin/update-event-dates")
  .post(isAuthenticatedUser, superAdminAuth, updateEventDates);

// Debug routes (Super Admin only)
router
  .route("/admin/debug/email-config")
  .get(isAuthenticatedUser, superAdminAuth, checkEmailConfig);

// Database update routes (Super Admin only)
router
  .route("/admin/database/status")
  .get(isAuthenticatedUser, superAdminAuth, getDatabaseUpdateStatus);

router
  .route("/admin/database/update-treasure-hunt")
  .post(isAuthenticatedUser, superAdminAuth, updateTreasureHuntGender);

router
  .route("/admin/database/update-divide-conquer")
  .post(isAuthenticatedUser, superAdminAuth, updateDivideAndConquerLimit);

router
  .route("/admin/database/update-sherlock-holmes")
  .post(isAuthenticatedUser, superAdminAuth, updateSherlockHolmesClub);

router
  .route("/admin/database/run-corrections")
  .post(isAuthenticatedUser, superAdminAuth, runEventCorrections);

// Legacy route (keeping for compatibility)
router
  .route("/erp/get-event-details/:id")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getEventDetails);

module.exports = router;
