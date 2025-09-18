const express = require("express");
const { isAuthenticatedUser } = require("../middlewares/authenticate");
const {
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
} = require("../controllers/teamController");

const router = express.Router();

// Team routes
router.post("/create", isAuthenticatedUser, createTeam);
router.post("/create-with-invites", isAuthenticatedUser, createTeamWithInvites);
router.post("/invite", isAuthenticatedUser, inviteToTeam);
router.post("/invite/:inviteId/respond", isAuthenticatedUser, respondToInvite);
router.delete("/invite/:inviteId", isAuthenticatedUser, cancelInvite);
router.post("/register", isAuthenticatedUser, registerTeam);
router.get("/my-teams", isAuthenticatedUser, getUserTeams);
router.get("/event/:eventId", isAuthenticatedUser, getUserTeamsForEvent);
router.get(
  "/event/:eventId/stats",
  isAuthenticatedUser,
  getGenderBasedTeamStats
);

// Notification routes (must come before /:teamId)

// Team detail route (must come after notification routes)
router.get("/:teamId", isAuthenticatedUser, getTeam);
router.delete("/:teamId", isAuthenticatedUser, deleteTeam);
router.post("/:teamId/leave", isAuthenticatedUser, leaveTeam);
router.post("/:teamId/add-members", isAuthenticatedUser, addMembersToTeam);

module.exports = router;
