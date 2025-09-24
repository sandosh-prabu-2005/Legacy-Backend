const mongoose = require("mongoose");

const TeamSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Events",
      required: true,
    },
    teamName: {
      type: String,
      required: true,
      trim: true,
    },
    leader: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
      required: true,
    },
    members: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Users",
          required: false, // Not required for direct participants
        },
        // Direct participant fields (when userId is not present)
        name: {
          type: String,
          required: function() {
            return !this.userId; // Required only if no userId
          }
        },
        email: {
          type: String,
          required: false // Optional for both invite and direct participants
        },
        mobile: {
          type: String,
          required: false // Optional for both invite and direct participants
        },
        dept: {
          type: String,
          required: function() {
            return !this.userId; // Required for direct participants
          }
        },
        year: {
          type: String,
          required: function() {
            return !this.userId; // Required for direct participants
          }
        },
        degree: {
          type: String,
          required: function() {
            return !this.userId; // Required for direct participants
          }
        },
        level: {
          type: String,
          enum: ["UG", "PG", "PhD"],
          required: function() {
            return !this.userId; // Required for direct participants
          }
        },
        gender: {
          type: String,
          enum: ["Male", "Female", "Other"],
          required: function() {
            return !this.userId; // Required for direct participants
          }
        },
        registrationType: {
          type: String,
          enum: ["invite", "direct"],
          default: "invite"
        },
        joinedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    isRegistered: {
      type: Boolean,
      default: false,
    },
    registeredAt: {
      type: Date,
    },
    registeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
    },
    maxMembers: {
      type: Number,
      default: 6, // Can be adjusted per event
    },
    teamGender: {
      type: String,
      enum: ["Male", "Female", "Mixed"],
      default: null,
    },
    isInvalidated: {
      type: Boolean,
      default: false,
    },
    invalidatedAt: {
      type: Date,
    },
    invalidatedReason: {
      type: String,
    },
  },
  { timestamps: true }
);

// Index for efficient queries
TeamSchema.index({ eventId: 1, leader: 1 });
TeamSchema.index({ "members.userId": 1 });

module.exports = mongoose.model("Teams", TeamSchema);
