const mongoose = require("mongoose");
const User = require("./models/users");
require("dotenv").config({ path: "./config/config.env" });

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.DB_LOCAL_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
};

// Degree to level mapping based on the frontend educationData structure
const degreeToLevelMapping = {
  // Undergraduate degrees
  BE: "UG",
  BTech: "UG",
  BSc: "UG",
  BCA: "UG",
  BA: "UG",
  BCom: "UG",
  BBA: "UG",
  BMS: "UG",

  // Postgraduate degrees
  ME: "PG",
  MTech: "PG",
  MSc: "PG",
  MCA: "PG",
  MA: "PG",
  MCom: "PG",
  MBA: "PG",
  MSW: "PG",

  // Doctoral degree
  PhD: "PhD",
};

const fixUserLevels = async () => {
  try {
    console.log("🔍 Starting user level fix...");

    // Find all users where level is null or undefined
    const usersWithNullLevel = await User.find({
      $or: [{ level: null }, { level: { $exists: false } }],
    }).select("_id name email degree level dept");

    console.log(
      `📊 Found ${usersWithNullLevel.length} users with null/missing level field`
    );

    if (usersWithNullLevel.length === 0) {
      console.log("✅ No users found with null level field. All good!");
      return;
    }

    let updatedCount = 0;
    let skippedCount = 0;
    const updateResults = [];

    // Process each user
    for (const user of usersWithNullLevel) {
      const degree = user.degree;
      const inferredLevel = degreeToLevelMapping[degree];

      if (inferredLevel) {
        try {
          // Update the user's level
          await User.updateOne(
            { _id: user._id },
            { $set: { level: inferredLevel } }
          );

          updateResults.push({
            userId: user._id,
            name: user.name,
            email: user.email,
            degree: degree,
            oldLevel: user.level,
            newLevel: inferredLevel,
            department: user.dept,
            status: "updated",
          });

          updatedCount++;
          console.log(
            `✅ Updated user ${user.name} (${user.email}): ${degree} → ${inferredLevel}`
          );
        } catch (error) {
          console.error(`❌ Error updating user ${user._id}:`, error.message);
          updateResults.push({
            userId: user._id,
            name: user.name,
            email: user.email,
            degree: degree,
            oldLevel: user.level,
            error: error.message,
            status: "error",
          });
        }
      } else {
        console.log(
          `⚠️  Skipped user ${user.name} (${user.email}): Unknown degree "${degree}"`
        );
        updateResults.push({
          userId: user._id,
          name: user.name,
          email: user.email,
          degree: degree,
          oldLevel: user.level,
          reason: `Unknown degree: ${degree}`,
          status: "skipped",
        });
        skippedCount++;
      }
    }

    // Summary report
    console.log("\n📋 SUMMARY REPORT");
    console.log("================");
    console.log(`Total users processed: ${usersWithNullLevel.length}`);
    console.log(`Successfully updated: ${updatedCount}`);
    console.log(`Skipped (unknown degree): ${skippedCount}`);
    console.log(
      `Errors: ${updateResults.filter((r) => r.status === "error").length}`
    );

    // Detailed results
    if (updateResults.length > 0) {
      console.log("\n📝 DETAILED RESULTS");
      console.log("==================");
      updateResults.forEach((result, index) => {
        console.log(`${index + 1}. ${result.name} (${result.email})`);
        console.log(
          `   Degree: ${result.degree} | Department: ${
            result.department || "N/A"
          }`
        );
        console.log(`   Status: ${result.status.toUpperCase()}`);
        if (result.status === "updated") {
          console.log(
            `   Level: ${result.oldLevel || "null"} → ${result.newLevel}`
          );
        } else if (result.status === "skipped") {
          console.log(`   Reason: ${result.reason}`);
        } else if (result.status === "error") {
          console.log(`   Error: ${result.error}`);
        }
        console.log("");
      });
    }

    // Verification - check if there are any remaining null levels
    const remainingNullLevels = await User.countDocuments({
      $or: [{ level: null }, { level: { $exists: false } }],
    });

    console.log(
      `🔍 Verification: ${remainingNullLevels} users still have null/missing level field`
    );

    if (remainingNullLevels === 0) {
      console.log("🎉 SUCCESS: All users now have valid level fields!");
    }
  } catch (error) {
    console.error("❌ Error during user level fix:", error);
  }
};

// Main execution
const main = async () => {
  await connectDB();
  await fixUserLevels();

  console.log("\n🏁 Script completed. Closing database connection...");
  await mongoose.connection.close();
  console.log("👋 Database connection closed.");
  process.exit(0);
};

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error("❌ Unhandled Rejection:", error);
  process.exit(1);
});

// Run the script
if (require.main === module) {
  main();
}

module.exports = { fixUserLevels, degreeToLevelMapping };
