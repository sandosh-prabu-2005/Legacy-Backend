#!/usr/bin/env node

const dotenv = require('dotenv');
const path = require('path');
const mongoose = require('mongoose');

// Load environment variables
dotenv.config({ path: path.join(__dirname, 'config', 'config.env') });

console.log('🚀 Team Member Level Management Script v2');
console.log('=========================================\n');

// Degree to level mapping
const degreeToLevelMap = {
    // Undergraduate degrees
    'BE': 'UG',
    'BTech': 'UG',
    'BSc': 'UG',
    'BCom': 'UG',
    'BCA': 'UG',
    'BA': 'UG',
    'BBA': 'UG',
    // Postgraduate degrees
    'ME': 'PG',
    'MTech': 'PG',
    'MSc': 'PG',
    'MCom': 'PG',
    'MCA': 'PG',
    'MA': 'PG',
    'MBA': 'PG',
    // Doctoral degrees
    'PhD': 'PhD'
};

async function connectDB() {
    try {
        const conn = await mongoose.connect(process.env.DB_LOCAL_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✅ Connected to MongoDB');
        return conn;
    } catch (error) {
        console.error('❌ Database connection failed:', error);
        process.exit(1);
    }
}

async function addLevelFieldToSchema() {
    try {
        // Use raw MongoDB operations to add the level field to existing documents
        const db = mongoose.connection.db;
        const collection = db.collection('teams');
        
        console.log('📝 Adding level field to team members schema...');
        
        // Update all team documents to ensure members have a level field
        const result = await collection.updateMany(
            { "members": { $exists: true } },
            { 
                $set: { 
                    "members.$[].level": "" 
                } 
            }
        );
        
        console.log(`✅ Updated ${result.modifiedCount} team documents to include level field`);
        return result;
    } catch (error) {
        console.error('❌ Error adding level field:', error);
        throw error;
    }
}

async function updateTeamMemberLevels() {
    try {
        const db = mongoose.connection.db;
        const collection = db.collection('teams');
        
        console.log('🔍 Finding teams and updating member levels...');
        
        // Get all teams
        const teams = await collection.find({ members: { $exists: true, $ne: [] } }).toArray();
        console.log(`📊 Found ${teams.length} teams with members`);
        
        let totalUpdated = 0;
        let totalProcessed = 0;
        
        for (const team of teams) {
            let teamUpdated = false;
            
            for (let i = 0; i < team.members.length; i++) {
                const member = team.members[i];
                totalProcessed++;
                
                // Skip if already has level or no degree
                if (member.level && member.level.trim() !== '') {
                    continue;
                }
                
                if (!member.degree) {
                    console.log(`⚠️  Skipping member ${member.name || 'Unknown'} - no degree`);
                    continue;
                }
                
                const inferredLevel = degreeToLevelMap[member.degree];
                if (!inferredLevel) {
                    console.log(`⚠️  Unknown degree "${member.degree}" for member ${member.name || 'Unknown'}`);
                    continue;
                }
                
                // Update the member level directly in the array
                team.members[i].level = inferredLevel;
                teamUpdated = true;
                totalUpdated++;
                
                console.log(`✅ Updated member ${member.name || 'Unknown'} in team "${team.teamName}": ${member.degree} → ${inferredLevel}`);
            }
            
            // Save the entire team document if any member was updated
            if (teamUpdated) {
                await collection.replaceOne(
                    { _id: team._id },
                    team
                );
                console.log(`💾 Saved updates for team: ${team.teamName}`);
            }
        }
        
        console.log(`\n📊 Update Summary:`);
        console.log(`   Total members processed: ${totalProcessed}`);
        console.log(`   Members updated: ${totalUpdated}`);
        
        return { totalProcessed, totalUpdated };
        
    } catch (error) {
        console.error('❌ Error updating team member levels:', error);
        throw error;
    }
}

async function verifyUpdates() {
    try {
        const db = mongoose.connection.db;
        const collection = db.collection('teams');
        
        console.log('\n🔍 Verifying updates...');
        
        // Count members with and without level field
        const pipeline = [
            { $unwind: '$members' },
            {
                $group: {
                    _id: null,
                    totalMembers: { $sum: 1 },
                    membersWithLevel: {
                        $sum: {
                            $cond: [
                                { 
                                    $and: [
                                        { $ne: ['$members.level', null] },
                                        { $ne: ['$members.level', ''] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    membersWithoutLevel: {
                        $sum: {
                            $cond: [
                                { 
                                    $or: [
                                        { $eq: ['$members.level', null] },
                                        { $eq: ['$members.level', ''] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ];
        
        const result = await collection.aggregate(pipeline).toArray();
        
        if (result.length > 0) {
            const stats = result[0];
            console.log(`📈 Verification Results:`);
            console.log(`   Total members: ${stats.totalMembers}`);
            console.log(`   Members with level field: ${stats.membersWithLevel}`);
            console.log(`   Members without level field: ${stats.membersWithoutLevel}`);
            
            if (stats.membersWithoutLevel === 0) {
                console.log('🎉 All members now have level fields!');
            } else {
                console.log('⚠️  Some members still missing level fields');
            }
            
            return stats;
        }
        
        return null;
    } catch (error) {
        console.error('❌ Error verifying updates:', error);
        throw error;
    }
}

async function main() {
    try {
        // Connect to database
        await connectDB();
        
        // Add level field to schema
        await addLevelFieldToSchema();
        
        // Update team member levels
        const updateResult = await updateTeamMemberLevels();
        
        // Verify the updates
        await verifyUpdates();
        
        console.log('\n🏁 Script completed successfully!');
        
    } catch (error) {
        console.error('💥 Script failed:', error);
        process.exit(1);
    } finally {
        // Close database connection
        if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.close();
            console.log('👋 Database connection closed.');
        }
    }
}

// Handle script termination
process.on('SIGINT', async () => {
    console.log('\n🛑 Script interrupted by user');
    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Script terminated');
    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
    }
    process.exit(0);
});

// Run the script
if (require.main === module) {
    main();
}

module.exports = { main, degreeToLevelMap };