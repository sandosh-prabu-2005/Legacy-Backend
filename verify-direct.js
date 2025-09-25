#!/usr/bin/env node

const dotenv = require('dotenv');
const path = require('path');
const mongoose = require('mongoose');

// Load environment variables
dotenv.config({ path: path.join(__dirname, 'config', 'config.env') });

console.log('🔍 Direct MongoDB Verification Script');
console.log('=====================================\n');

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

async function checkTeams() {
    try {
        const db = mongoose.connection.db;
        const collection = db.collection('teams');
        
        console.log('🔍 Checking teams directly...\n');
        
        // Get a few teams to inspect
        const teams = await collection.find({ members: { $exists: true, $ne: [] } }).limit(3).toArray();
        
        teams.forEach((team, index) => {
            console.log(`📋 Team ${index + 1}: "${team.teamName}"`);
            console.log(`   Members: ${team.members.length}`);
            
            team.members.forEach((member, mIndex) => {
                console.log(`   Member ${mIndex + 1}: ${member.name || 'Unknown'}`);
                console.log(`     Degree: ${member.degree || 'N/A'}`);
                console.log(`     Level: ${member.level || 'N/A'}`);
                console.log(`     Level field exists: ${member.hasOwnProperty('level')}`);
                console.log(`     Level field type: ${typeof member.level}`);
                console.log('   ---');
            });
            console.log('\n');
        });
        
        // Count statistics using aggregation
        const stats = await collection.aggregate([
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
                                        { $ne: ['$members.level', ''] },
                                        { $ne: ['$members.level', undefined] }
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
                                        { $eq: ['$members.level', ''] },
                                        { $eq: ['$members.level', undefined] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]).toArray();
        
        if (stats.length > 0) {
            const result = stats[0];
            console.log(`📊 Aggregation Results:`);
            console.log(`   Total members: ${result.totalMembers}`);
            console.log(`   Members with level: ${result.membersWithLevel}`);
            console.log(`   Members without level: ${result.membersWithoutLevel}`);
        }
        
    } catch (error) {
        console.error('❌ Error checking teams:', error);
        throw error;
    }
}

async function main() {
    try {
        await connectDB();
        await checkTeams();
        
        console.log('\n🏁 Verification completed!');
        
    } catch (error) {
        console.error('💥 Verification failed:', error);
        process.exit(1);
    } finally {
        // Close database connection
        if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.close();
            console.log('👋 Database connection closed.');
        }
    }
}

// Run the script
if (require.main === module) {
    main();
}