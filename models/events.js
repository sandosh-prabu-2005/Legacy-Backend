const mongoose = require("mongoose");

const EventSchema = new mongoose.Schema(
  {
    event_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    event_type: {
      type: String,
      enum: ["solo", "group"],
      default: "solo",
      required: true,
    },

    minTeamSize: {
      type: Number,
      default: function () {
        return this.event_type === "group" ? 2 : 1;
      },
    },

    maxTeamSize: {
      type: Number,
      default: function () {
        return this.event_type === "group" ? 6 : 1;
      },
    },

    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },

    // new field from your JSON
    clubInCharge: {
      type: String,
      default: "", // or `required: true` if you want to enforce it
      trim: true,
    },

    description: {
      type: String,
      default: "",
    },

    event_date: {
      type: Date,
      default: null,
    },

    venue: {
      type: String,
      default: "",
    },

    registration_deadline: {
      type: Date,
      default: null,
    },

    max_participants: {
      type: Number,
      default: null,
    },

    organizing_club: {
      type: String,
      default: "",
    },

    coordinatorName: {
      type: String,
      default: "",
    },

    coordinatorDept: {
      type: String,
      default: "",
    },

    staff_incharges: [
      {
        adminId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Users",
          required: true,
        },
        name: {
          type: String,
          required: true,
        },
        email: {
          type: String,
          required: true,
        },
        club: {
          type: String,
          default: "",
        },
      },
    ],

    rules: {
      type: [String],
      default: [],
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    maxApplications: {
      type: Number,
      default: null,
    },

    applicationDeadline: {
      type: Date,
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
      required: false,
    },

    // Gender-based team restrictions for specific events
    hasGenderBasedTeams: {
      type: Boolean,
      default: false,
    },

    maxBoyTeams: {
      type: Number,
      default: null,
    },

    maxGirlTeams: {
      type: Number,
      default: null,
    },

    applications: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Users",
          required: true,
        },
        teamId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Teams",
          required: false, // Only for group events
        },
        appliedAt: {
          type: Date,
          default: Date.now,
        },
        status: {
          type: String,
          enum: ["pending", "accepted", "rejected"],
          default: "pending",
        },
        isPresent: {
          type: Boolean,
          default: null,
        },
        isWinner: {
          type: Boolean,
          default: null,
        },
        winnerRank: {
          type: Number,
          default: null,
        },
      },
    ],

    /**
     * Registration fee for this event.  If zero, the event is free and no
     * payment will be collected during the registration flow.  If greater
     * than zero the payment gateway will charge the user this amount (in
     * rupees) when they register.  Defaults to 0 (free).
     */
    registrationAmount: {
      type: Number,
      default: 0,
      min: [0, "Registration amount cannot be negative"],
    },

    // Winners array for storing event winners
    winners: [
      {
        rank: {
          type: Number,
          required: true,
        },
        teamId: {
          type: String,
          required: false, // For group events
        },
        teamName: {
          type: String,
          required: false, // For group events
        },
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Users",
          required: false, // For solo events
        },
      },
    ],

    winnersUpdatedAt: {
      type: Date,
      required: false,
    },
  },
  { timestamps: true }
);

// Pre-save hook to auto-generate event_id if missing
EventSchema.pre("save", async function (next) {
  if (!this.event_id && this.name) {
    // Generate event_id from name
    const generateEventId = (name) => {
      return name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "") // Remove special characters
        .replace(/\s+/g, "-") // Replace spaces with hyphens
        .trim();
    };

    let baseEventId = generateEventId(this.name);
    let eventId = baseEventId;
    let counter = 1;

    // Ensure uniqueness
    while (await mongoose.model("Events").findOne({ event_id: eventId })) {
      eventId = `${baseEventId}-${counter}`;
      counter++;
    }

    this.event_id = eventId;
  }
  next();
});

module.exports = mongoose.model("Events", EventSchema);
