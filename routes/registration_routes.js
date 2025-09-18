const express = require("express");
const {
  registerSoloEvent,
  registerGroupEvent,
  registerEventWithParticipants,
  getCollegeRegistrations,
  updateSoloRegistration,
  updateTeamRegistrationMember,
  removeTeamRegistrationMember,
  updateTeamRegistration,
  getCollegeEventsForEdit,
  getRegistrationDetails,
} = require("../controllers/registrationController");
const { isAuthenticatedUser } = require("../middlewares/authenticate");
const router = express.Router();

// Registration routes
router.route("/solo").post(isAuthenticatedUser, registerSoloEvent);
router.route("/group").post(isAuthenticatedUser, registerGroupEvent);
router
  .route("/direct")
  .post(isAuthenticatedUser, registerEventWithParticipants);
router.route("/college").get(isAuthenticatedUser, getCollegeRegistrations);
router
  .route("/college/events")
  .get(isAuthenticatedUser, getCollegeEventsForEdit);
router
  .route("/:registrationId/details")
  .get(isAuthenticatedUser, getRegistrationDetails);

// Update routes
router
  .route("/solo/:registrationId")
  .put(isAuthenticatedUser, updateSoloRegistration);
router
  .route("/team/:teamId")
  .put(isAuthenticatedUser, updateTeamRegistration);
router
  .route("/team/:teamId/member/:memberId")
  .put(isAuthenticatedUser, updateTeamRegistrationMember)
  .delete(isAuthenticatedUser, removeTeamRegistrationMember);

module.exports = router;
