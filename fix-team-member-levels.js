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

// Degree to level mapping based on the frontend educationData structure
const degreeToLevelMapping = {
  // Undergraduate degrees
  'BE': 'UG',
  'BTech': 'UG', 
  'BSc': 'UG',
  'BCA': 'UG',
  'BA': 'UG',
  'BCom': 'UG',
  'BBA': 'UG',
  'BMS': 'UG',
  
  // Postgraduate degrees  
  'ME': 'PG',
  'MTech': 'PG',
  'MSc': 'PG', 
  'MCA': 'PG',
  'MA': 'PG',
  'MCom': 'PG',
  'MBA': 'PG',
  'MSW': 'PG',
  
  // Doctoral degree
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
    const sampleMembersWithoutLevel = [];
    
    // Check each team and its members
    for (const team of teams) {
      for (const member of team.members) {
        totalMembers++;
        
        if (member.level !== undefined && member.level !== null) {
          membersWithLevel++;
        } else {
          membersWithoutLevel++;
          
          // Collect samples for display
          if (sampleMembersWithoutLevel.length < 10) {
            sampleMembersWithoutLevel.push({
              teamId: team._id,
              teamName: team.teamName,
              memberName: member.name || 'N/A',
              memberEmail: member.email || 'N/A',
              degree: member.degree || 'N/A',
              dept: member.dept || 'N/A',
              hasUserId: !!member.userId
            });
          }
        }
        
        if (member.degree) {
          membersWithDegree++;
        }
      }
    }
    
    console.log(`📈 Member Statistics:`);
    console.log(`   Total members: ${totalMembers}`);
    console.log(`   Members with level field: ${membersWithLevel}`);
    console.log(`   Members without level field: ${membersWithoutLevel}`);
    console.log(`   Members with degree field: ${membersWithDegree}`);
    console.log(`   Members without degree field: ${totalMembers - membersWithDegree}`);
    
    if (sampleMembersWithoutLevel.length > 0) {
      console.log('\n📋 Sample members without level field:');
      sampleMembersWithoutLevel.forEach((member, index) => {
        console.log(`${index + 1}. Team: ${member.teamName}`);
        console.log(`   Member: ${member.memberName} (${member.memberEmail})`);
        console.log(`   Degree: ${member.degree} | Department: ${member.dept}`);
        console.log(`   Has userId: ${member.hasUserId}`);
        console.log('');
      });
      
      if (membersWithoutLevel > 10) {
        console.log(`   ... and ${membersWithoutLevel - 10} more members\n`);
      }
    }
    
    // Degree distribution for members without level
    if (membersWithoutLevel > 0) {
      console.log('📈 Degree distribution for members without level field:');
      const degreeCount = {};
      
      for (const team of teams) {
        for (const member of team.members) {
          if (member.level === undefined || member.level === null) {
            const degree = member.degree || 'Unknown';
            degreeCount[degree] = (degreeCount[degree] || 0) + 1;
          }
        }
      }
      
      Object.entries(degreeCount)
        .sort(([,a], [,b]) => b - a)
        .forEach(([degree, count]) => {
          const canInfer = degreeToLevelMapping[degree] ? '✅' : '❌';
          console.log(`   ${degree}: ${count} members ${canInfer}`);
        });
    }
    
  } catch (error) {
    console.error('❌ Error during check:', error);
  }
};

const fixTeamMemberLevels = async () => {
  try {
    console.log('🔧 Starting team member level fix...\n');
    
    // Get all teams with members
    const teams = await Team.find({ 
      members: { $exists: true, $ne: [] } 
    });
    
    console.log(`📊 Processing ${teams.length} teams...`);
    
    let teamsUpdated = 0;
    let membersUpdated = 0;
    let membersSkipped = 0;
    let membersWithoutDegree = 0;
    const updateLog = [];
    
    for (const team of teams) {
      let teamHasUpdates = false;
      
      // Process each member in the team
      for (let i = 0; i < team.members.length; i++) {
        const member = team.members[i];
        
        // Check if level field is missing or null
        if (member.level === undefined || member.level === null) {
          
          if (!member.degree) {
            membersWithoutDegree++;
            updateLog.push({
              teamName: team.teamName,
              memberName: member.name || 'N/A',
              action: 'skipped',
              reason: 'No degree field'
            });
            continue;
          }
          
          const inferredLevel = degreeToLevelMapping[member.degree];
          
          if (inferredLevel) {
            // Add the level field to the member
            team.members[i].level = inferredLevel;
            teamHasUpdates = true;
            membersUpdated++;
            
            updateLog.push({
              teamName: team.teamName,
              memberName: member.name || 'N/A',
              memberEmail: member.email || 'N/A',
              degree: member.degree,
              inferredLevel: inferredLevel,
              action: 'updated'
            });
            
            console.log(`✅ Updated member ${member.name || 'N/A'} in team "${team.teamName}": ${member.degree} → ${inferredLevel}`);
          } else {
            membersSkipped++;
            updateLog.push({
              teamName: team.teamName,
              memberName: member.name || 'N/A',
              degree: member.degree,
              action: 'skipped',
              reason: `Unknown degree: ${member.degree}`
            });
            
            console.log(`⚠️  Skipped member ${member.name || 'N/A'} in team "${team.teamName}": Unknown degree "${member.degree}"`);
          }
        }
      }
      
      // Save the team if it has updates
      if (teamHasUpdates) {
        try {
          await team.save();
          teamsUpdated++;
          console.log(`💾 Saved updates for team: ${team.teamName}`);
        } catch (error) {
          console.error(`❌ Error saving team ${team.teamName}:`, error.message);
        }
      }
    }
    
    // Summary report
    console.log('\n📋 SUMMARY REPORT');
    console.log('================');
    console.log(`Teams processed: ${teams.length}`);
    console.log(`Teams updated: ${teamsUpdated}`);
    console.log(`Members updated: ${membersUpdated}`);
    console.log(`Members skipped (no degree): ${membersWithoutDegree}`);
    console.log(`Members skipped (unknown degree): ${membersSkipped}`);
    
    // Detailed log (show first 20 updates)
    if (updateLog.length > 0) {
      console.log('\n📝 DETAILED UPDATE LOG (First 20 entries)');
      console.log('=========================================');
      updateLog.slice(0, 20).forEach((log, index) => {
        console.log(`${index + 1}. ${log.memberName} (${log.teamName})`);
        console.log(`   Action: ${log.action.toUpperCase()}`);
        if (log.action === 'updated') {
          console.log(`   Degree: ${log.degree} → Level: ${log.inferredLevel}`);
        } else {
          console.log(`   Reason: ${log.reason}`);
        }
        console.log('');
      });
      
      if (updateLog.length > 20) {
        console.log(`   ... and ${updateLog.length - 20} more entries\n`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error during team member level fix:', error);
  }
};

// Main execution
const main = async () => {
  console.log('🚀 Team Member Level Management Script');
  console.log('=====================================\n');
  
  await connectDB();
  
  // First check the current state
  await checkTeamMemberLevels();
  
  console.log('\n' + '='.repeat(50));
  console.log('Starting fix process...');
  console.log('='.repeat(50) + '\n');
  
  // Then fix the missing levels
  await fixTeamMemberLevels();
  
  console.log('\n' + '='.repeat(50));
  console.log('Verification after fix...');
  console.log('='.repeat(50) + '\n');
  
  // Finally verify the fix
  await checkTeamMemberLevels();
  
  console.log('\n🏁 Script completed. Closing database connection...');
  await mongoose.connection.close();
  console.log('👋 Database connection closed.');
  process.exit(0);
};

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
  process.exit(1);
});

// Run the script
if (require.main === module) {
  main();
}

module.exports = { checkTeamMemberLevels, fixTeamMemberLevels, degreeToLevelMapping };