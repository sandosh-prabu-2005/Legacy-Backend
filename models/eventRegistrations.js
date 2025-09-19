const mongoose = require("mongoose");

// Schema designed for efficient statistical queries
const eventRegistrationSchema = new mongoose.Schema(
  {
    // Event Information - for event-wise statistics
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true, // Index for fast event-wise queries
    },
    eventName: {
      type: String,
      required: true,
      index: true, // Denormalized for faster queries without joins
    },
    eventType: {
      type: String,
      enum: ["solo", "group"],
      required: true,
      index: true,
    },

    // Team Information - for team-based events
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teams",
      default: null,
      index: true,
    },
    teamName: {
      type: String,
      default: null,
    },

    // Registrant (person who registers) Information
    registrantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
      required: true,
      index: true,
    },
    registrantEmail: {
      type: String,
      required: true,
    },

    // Participant Information - for statistical analysis
    participantName: {
      type: String,
      required: true,
    },
    participantEmail: {
      type: String,
      default: null, // Optional as per your requirement
    },
    participantMobile: {
      type: String,
      default: null, // Optional as per your requirement
    },

    // Educational Information - for department/degree-wise statistics
    level: {
      type: String,
      enum: ["UG", "PG", "PhD"],
      required: true,
      index: true, // Index for level-wise statistics
    },
    degree: {
      type: String,
      required: true,
      index: true, // Index for degree-wise statistics
    },
    department: {
      type: String,
      required: true,
      index: true, // Index for department-wise statistics
    },
    customDepartment: {
      type: String,
      default: null, // For "Other" department specifications
    },
    year: {
      type: String,
      required: true,
      index: true, // Index for year-wise statistics
    },

    // Demographic Information - for gender-wise statistics
    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
      required: true,
      index: true, // Index for gender-wise statistics
    },

    // College Information - inherited from registrant, for college-wise statistics
    collegeName: {
      type: String,
      required: true,
      index: true, // Index for college-wise statistics
    },
    collegeCity: {
      type: String,
      required: true,
      index: true, // Index for city-wise statistics
    },
    collegeState: {
      type: String,
      required: true,
      index: true, // Index for state-wise statistics
    },

    // Registration Metadata
    registrationDate: {
      type: Date,
      default: Date.now,
      index: true, // Index for time-based statistics
    },
    registrationType: {
      type: String,
      enum: ["direct", "invite"], // direct = registered by someone else, invite = traditional invite system
      default: "direct",
      index: true,
    },

    // Status tracking
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Attendance tracking - added during attendance marking, not registration
    isPresent: {
      type: Boolean,
      default: false,
      index: true,
    },
    attendanceMarkedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Compound Indexes for efficient complex queries
// For college + event statistics
eventRegistrationSchema.index({ eventId: 1, collegeName: 1 });
// For gender + event statistics
eventRegistrationSchema.index({ eventId: 1, gender: 1 });
// For college + gender statistics
eventRegistrationSchema.index({ collegeName: 1, gender: 1 });
// For event + gender + college statistics (most complex query)
eventRegistrationSchema.index({ eventId: 1, gender: 1, collegeName: 1 });
// For department-wise statistics
eventRegistrationSchema.index({ eventId: 1, department: 1 });
// For level-wise statistics
eventRegistrationSchema.index({ eventId: 1, level: 1 });
// For time-based statistics
eventRegistrationSchema.index({ registrationDate: 1, eventId: 1 });

// Virtual for full department name (handles custom departments)
eventRegistrationSchema.virtual("fullDepartment").get(function () {
  return this.department === "Other" ? this.customDepartment : this.department;
});

// Ensure virtual fields are serialized
eventRegistrationSchema.set("toJSON", { virtuals: true });
eventRegistrationSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("EventRegistration", eventRegistrationSchema);
