const mongoose = require('mongoose');
const Team = require('./models/teams');
require('dotenv').config({ path: './config/config.env' });

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.DB_LOCAL_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Degree to level mapping for reference
const degreeToLevelMapping = {
  'BE': 'UG', 'BTech': 'UG', 'BSc': 'UG', 'BCA': 'UG', 'BA': 'UG', 'BCom': 'UG', 'BBA': 'UG', 'BMS': 'UG',
  'ME': 'PG', 'MTech': 'PG', 'MSc': 'PG', 'MCA': 'PG', 'MA': 'PG', 'MCom': 'PG', 'MBA': 'PG', 'MSW': 'PG',
  'PhD': 'PhD'
};

const checkTeamMemberLevels = async () => {
  try {
    console.log('🔍 Checking team member level fields...\n');
    
    // Get all teams with members
    const teams = await Team.find({ 
      members: { $exists: true, $ne: [] } 
    }).select('_id teamName eventId members');
    
    console.log(`📊 Found ${teams.length} teams with members`);
    
    let totalMembers = 0;
    let membersWithoutLevel = 0;
    let membersWithLevel = 0;
    let membersWithDegree = 0;
    let membersCanBeInferred = 0;
    const sampleMembersWithoutLevel = [];
    const degreeDistribution = {};
    
    // Check each team and its members
    for (const team of teams) {
      for (const member of team.members) {
        totalMembers++;
        
        if (member.level !== undefined && member.level !== null) {
          membersWithLevel++;
        } else {
          membersWithoutLevel++;
          
          // Check if we can infer level from degree
          if (member.degree && degreeToLevelMapping[member.degree]) {
            membersCanBeInferred++;
          }
          
          // Collect samples for display
          if (sampleMembersWithoutLevel.length < 15) {
            sampleMembersWithoutLevel.push({
              teamId: team._id,
              teamName: team.teamName,
              memberName: member.name || 'N/A',
              memberEmail: member.email || 'N/A',
              degree: member.degree || 'N/A',
              dept: member.dept || 'N/A',
              hasUserId: !!member.userId,
              canInfer: member.degree && degreeToLevelMapping[member.degree] ? '✅' : '❌'
            });
          }
          
          // Count degree distribution
          const degree = member.degree || 'No Degree';
          degreeDistribution[degree] = (degreeDistribution[degree] || 0) + 1;
        }
        
        if (member.degree) {
          membersWithDegree++;
        }
      }
    }
    
    console.log(`📈 Member Statistics:`);
    console.log(`   Total members across all teams: ${totalMembers}`);
    console.log(`   Members with level field: ${membersWithLevel}`);
    console.log(`   Members without level field: ${membersWithoutLevel}`);
    console.log(`   Members with degree field: ${membersWithDegree}`);
    console.log(`   Members without degree field: ${totalMembers - membersWithDegree}`);
    console.log(`   Members that can be inferred: ${membersCanBeInferred}`);
    console.log(`   Members that cannot be inferred: ${membersWithoutLevel - membersCanBeInferred}`);
    
    if (sampleMembersWithoutLevel.length > 0) {
      console.log('\n📋 Sample members without level field:');
      sampleMembersWithoutLevel.forEach((member, index) => {
        console.log(`${index + 1}. Team: ${member.teamName}`);
        console.log(`   Member: ${member.memberName} (${member.memberEmail})`);
        console.log(`   Degree: ${member.degree} | Department: ${member.dept}`);
        console.log(`   Has userId: ${member.hasUserId} | Can infer: ${member.canInfer}`);
        console.log('');
      });
      
      if (membersWithoutLevel > 15) {
        console.log(`   ... and ${membersWithoutLevel - 15} more members\n`);
      }
    }
    
    // Degree distribution for members without level
    if (membersWithoutLevel > 0) {
      console.log('📈 Degree distribution for members without level field:');
      Object.entries(degreeDistribution)
        .sort(([,a], [,b]) => b - a)
        .forEach(([degree, count]) => {
          const canInfer = degreeToLevelMapping[degree] ? '✅' : '❌';
          console.log(`   ${degree}: ${count} members ${canInfer}`);
        });
    }
    
    // Summary recommendation
    if (membersWithoutLevel > 0) {
      console.log('\n💡 RECOMMENDATION:');
      if (membersCanBeInferred > 0) {
        console.log(`   ✅ ${membersCanBeInferred} members can be automatically updated`);
        console.log(`   ❌ ${membersWithoutLevel - membersCanBeInferred} members need manual review`);
        console.log(`   🚀 Run the fix script to update inferable members`);
      } else {
        console.log(`   ❌ No members can be automatically inferred`);
        console.log(`   🛠️  Manual data cleanup may be needed`);
      }
    } else {
      console.log('\n🎉 All team members already have level fields!');
    }
    
  } catch (error) {
    console.error('❌ Error during check:', error);
  }
};

const main = async () => {
  console.log('🔍 Team Member Level Check Script');
  console.log('=================================\n');
  
  await connectDB();
  await checkTeamMemberLevels();
  
  console.log('\n🏁 Check completed. Closing database connection...');
  await mongoose.connection.close();
  console.log('👋 Database connection closed.');
  process.exit(0);
};

// Run the script
if (require.main === module) {
  main();
}

module.exports = { checkTeamMemberLevels };