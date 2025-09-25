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

const checkUserLevels = async () => {
  try {
    console.log("🔍 Checking user level field status...\n");

    // Total users count
    const totalUsers = await User.countDocuments({});
    console.log(`📊 Total users in database: ${totalUsers}`);

    // Users with valid levels
    const validLevels = await User.countDocuments({
      level: { $in: ["UG", "PG", "PhD"] },
    });
    console.log(`✅ Users with valid level field: ${validLevels}`);

    // Users with null/missing levels
    const nullLevels = await User.countDocuments({
      $or: [{ level: null }, { level: { $exists: false } }],
    });
    console.log(`❌ Users with null/missing level field: ${nullLevels}`);

    // Users with other invalid values
    const invalidLevels = totalUsers - validLevels - nullLevels;
    console.log(`⚠️  Users with other invalid level values: ${invalidLevels}`);

    if (nullLevels > 0) {
      console.log("\n📋 Sample users with null/missing levels:");
      const sampleUsers = await User.find({
        $or: [{ level: null }, { level: { $exists: false } }],
      })
        .select("name email degree level dept")
        .limit(10);

      sampleUsers.forEach((user, index) => {
        console.log(`${index + 1}. ${user.name} (${user.email})`);
        console.log(`   Degree: ${user.degree} | Department: ${user.dept}`);
        console.log(`   Level: ${user.level || "null/undefined"}`);
        console.log("");
      });

      if (nullLevels > 10) {
        console.log(`   ... and ${nullLevels - 10} more users\n`);
      }
    }

    // Distribution by degree (to understand the data better)
    console.log("📈 Degree distribution for users with null levels:");
    const degreeDistribution = await User.aggregate([
      {
        $match: {
          $or: [{ level: null }, { level: { $exists: false } }],
        },
      },
      {
        $group: {
          _id: "$degree",
          count: { $sum: 1 },
        },
      },
      {
        $sort: { count: -1 },
      },
    ]);

    degreeDistribution.forEach((item) => {
      console.log(`   ${item._id}: ${item.count} users`);
    });
  } catch (error) {
    console.error("❌ Error during check:", error);
  }
};

const main = async () => {
  await connectDB();
  await checkUserLevels();

  console.log("\n🏁 Check completed. Closing database connection...");
  await mongoose.connection.close();
  console.log("👋 Database connection closed.");
  process.exit(0);
};

// Run the script
if (require.main === module) {
  main();
}

module.exports = { checkUserLevels };
