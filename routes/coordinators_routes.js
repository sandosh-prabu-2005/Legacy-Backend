const express = require("express");
const {
  getCollegeParticipants,
  getCollegeCoordinators,
  getAllCoordinatorsPublic,
} = require("../controllers/coordinatorsController");
const { isAuthenticatedUser } = require("../middlewares/authenticate");

const router = express.Router();

// Public route to get all coordinators (no auth required)
router.route("/coordinators/public").get(getAllCoordinatorsPublic);

// Route to get participants from the same college as the logged-in user
router.route("/coordinators").get(isAuthenticatedUser, getCollegeParticipants);

// Alternative route to get actual coordinators (users with coordinator roles)
router
  .route("/coordinators/actual")
  .get(isAuthenticatedUser, getCollegeCoordinators);

module.exports = router;
