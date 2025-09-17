const express = require("express");
const {
  signUpUser,
  verifyEmail,
  verifyOTP,
  resendOTP,
  forgotPassword,
  resetPassword,
  signinUser,
  signOutUser,
  findUser,
  loadUser,
  getUserById,
  getYears,
  searchUsers,
  getUserRegistrations,
  getAllUsers,
  changePassword,
} = require("../controllers/userController");
const { isAuthenticatedUser } = require("../middlewares/authenticate");

const router = express.Router();

router.route("/user/signup").post(signUpUser);
router.route("/user/verify/:token").get(verifyEmail);
router.route("/user/verify-otp").post(verifyOTP);
router.route("/user/resend-otp").post(resendOTP);
router.route("/user/signin").post(signinUser);
router.route("/user/signout").get(signOutUser);
router.route("/user/find").post(isAuthenticatedUser, findUser);
router.route("/user/load").get(isAuthenticatedUser, loadUser);
router.route("/user/:userId").get(isAuthenticatedUser, getUserById);
router
  .route("/user/registrations")
  .get(isAuthenticatedUser, getUserRegistrations);
router.route("/users/search").get(isAuthenticatedUser, searchUsers);
router.route("/user/all").get(isAuthenticatedUser, getAllUsers);
router.route("/years").get(getYears);
router.route("/user/password/forgot").post(forgotPassword);
router.route("/user/password/reset/:token").post(resetPassword);
router.route("/user/password/change").put(isAuthenticatedUser, changePassword);

module.exports = router;
