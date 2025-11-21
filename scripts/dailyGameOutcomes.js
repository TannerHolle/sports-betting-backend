/**
 * Daily Game Outcomes Script
 * 
 * This script runs nightly to:
 * 1. Fetch odds for all games scheduled for a specific day (defaults to today)
 * 2. Fetch final results for those games
 * 3. Calculate outcomes (spread covered, over/under, etc.)
 * 4. Store everything in the GameOutcome collection
 * 
 * Usage:
 *   node backend/scripts/dailyGameOutcomes.js [date]
 * 
 * If no date is provided, it processes today's games.
 * Date format: YYYY-MM-DD
 * Use "all" to process all games in the database
 */

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const GameOutcome = require('../models/GameOutcome');
const oddsDatabase = require('../services/oddsDatabase');

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sports-betting', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✓ Connected to MongoDB');
  } catch (error) {
    console.error('✗ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Format date for ESPN API (YYYYMMDD)
const formatDateForAPI = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

// Get ESPN API URL for a sport
const getESPNUrl = (sport, date) => {
  const formattedDate = formatDateForAPI(date);
  const sportUrls = {
    'nba': `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${formattedDate}`,
    'nfl': `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${formattedDate}`,
    'ncaa-basketball': `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${formattedDate}`,
    'ncaa-football': `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${formattedDate}`
  };
  return sportUrls[sport] || null;
};

// Fetch game results from ESPN API
const fetchGameResults = async (sport, date) => {
  try {
    const url = getESPNUrl(sport, date);
    if (!url) return [];
    
    const response = await axios.get(url, { timeout: 10000 });
    return response.data.events || [];
  } catch (error) {
    console.error(`  ✗ Error fetching ESPN results for ${sport}:`, error.message);
    return [];
  }
};

// Fetch games from ESPN for a date range
const fetchGamesForDateRange = async (sport, startDate, endDate) => {
  const allGames = [];
  const currentDate = new Date(startDate);
  
  while (currentDate <= endDate) {
    const games = await fetchGameResults(sport, currentDate);
    allGames.push(...games);
    
    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return allGames;
};

// Helper function to normalize team names for matching
const normalizeTeamName = (name) => {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/\s+/g, '')
    .replace(/^the/, ''); // Remove "the" prefix
};

// Helper function to match teams (fuzzy matching)
const teamsMatch = (team1, team2) => {
  if (!team1 || !team2) return false;
  const norm1 = normalizeTeamName(team1);
  const norm2 = normalizeTeamName(team2);
  // Exact match
  if (norm1 === norm2) return true;
  // One contains the other (for cases like "Lakers" vs "Los Angeles Lakers")
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
  // Check if they share a significant substring (at least 4 chars)
  if (norm1.length >= 4 && norm2.length >= 4) {
    for (let i = 0; i <= norm1.length - 4; i++) {
      const substr = norm1.substring(i, i + 4);
      if (norm2.includes(substr)) return true;
    }
  }
  return false;
};

// Extract team names from ESPN game
const extractESPNTeams = (espnGame) => {
  const competition = espnGame.competitions?.[0];
  const competitors = competition?.competitors || [];
  const homeTeam = competitors.find(c => c.homeAway === 'home');
  const awayTeam = competitors.find(c => c.homeAway === 'away');
  
  if (!homeTeam || !awayTeam) return null;
  
  return {
    home: homeTeam.team?.shortDisplayName || homeTeam.team?.displayName || homeTeam.team?.name || '',
    away: awayTeam.team?.shortDisplayName || awayTeam.team?.displayName || awayTeam.team?.name || '',
    homeId: homeTeam.team?.id,
    awayId: awayTeam.team?.id
  };
};

// Extract odds from stored database format
const extractOdds = (storedOdds, homeTeam, awayTeam) => {
  const odds = {
    spread: { homeLine: null, awayLine: null, homePrice: null, awayPrice: null },
    total: { overLine: null, underLine: null, overPrice: null, underPrice: null },
    moneyline: { home: null, away: null }
  };

  if (!storedOdds || typeof storedOdds !== 'object') {
    return odds;
  }

  // The stored odds format from oddsService.processOddsData
  // Keys are like: "TeamName_spread", "TeamName_moneyline", "Over_total", "Under_total"
  
  // Extract spread odds
  const homeSpreadKey = `${homeTeam}_spread`;
  const awaySpreadKey = `${awayTeam}_spread`;
  if (storedOdds[homeSpreadKey]) {
    odds.spread.homeLine = storedOdds[homeSpreadKey].line;
    odds.spread.homePrice = storedOdds[homeSpreadKey].price;
  }
  if (storedOdds[awaySpreadKey]) {
    odds.spread.awayLine = storedOdds[awaySpreadKey].line;
    odds.spread.awayPrice = storedOdds[awaySpreadKey].price;
  }

  // Extract total (over/under) odds
  if (storedOdds['Over_total']) {
    odds.total.overLine = storedOdds['Over_total'].line;
    odds.total.overPrice = storedOdds['Over_total'].price;
  }
  if (storedOdds['Under_total']) {
    odds.total.underLine = storedOdds['Under_total'].line;
    odds.total.underPrice = storedOdds['Under_total'].price;
  }

  // Extract moneyline odds
  const homeMoneylineKey = `${homeTeam}_moneyline`;
  const awayMoneylineKey = `${awayTeam}_moneyline`;
  if (storedOdds[homeMoneylineKey]) {
    odds.moneyline.home = storedOdds[homeMoneylineKey];
  }
  if (storedOdds[awayMoneylineKey]) {
    odds.moneyline.away = storedOdds[awayMoneylineKey];
  }

  return odds;
};

// Calculate outcomes based on scores and odds
const calculateOutcomes = (homeScore, awayScore, odds) => {
  const outcomes = {
    spreadCovered: null,
    spreadPush: false,
    totalOver: null,
    totalPush: false,
    homeWon: homeScore > awayScore
  };

  const totalPoints = homeScore + awayScore;

  // Calculate spread outcome
  if (odds.spread.homeLine !== null) {
    // Home team spread line (negative = favorite, positive = underdog)
    const homeAdjusted = homeScore + odds.spread.homeLine;
    
    if (homeAdjusted === awayScore) {
      outcomes.spreadPush = true;
    } else {
      // If home team is favorite (negative line), they cover if adjusted > away
      // If home team is underdog (positive line), they cover if adjusted > away
      outcomes.spreadCovered = homeAdjusted > awayScore;
    }
  } else if (odds.spread.awayLine !== null) {
    // Away team spread line
    const awayAdjusted = awayScore + odds.spread.awayLine;
    
    if (awayAdjusted === homeScore) {
      outcomes.spreadPush = true;
    } else {
      outcomes.spreadCovered = awayAdjusted > homeScore;
    }
  }

  // Calculate total (over/under) outcome
  if (odds.total.overLine !== null) {
    const totalLine = odds.total.overLine;
    if (totalPoints === totalLine) {
      outcomes.totalPush = true;
    } else {
      outcomes.totalOver = totalPoints > totalLine;
    }
  }

  return outcomes;
};

// Process a single game
const processGame = async (sport, storedOddsGame, espnGame) => {
  try {
    const gameId = String(espnGame.id || storedOddsGame.id);
    const competition = espnGame.competitions?.[0];
    const competitors = competition?.competitors || [];
    
    const homeTeam = competitors.find(c => c.homeAway === 'home');
    const awayTeam = competitors.find(c => c.homeAway === 'away');
    
    if (!homeTeam || !awayTeam) return null;

    const homeTeamName = homeTeam.team?.shortDisplayName || homeTeam.team?.displayName || storedOddsGame.homeTeam;
    const awayTeamName = awayTeam.team?.shortDisplayName || awayTeam.team?.displayName || storedOddsGame.awayTeam;
    const status = competition?.status;
    const completed = status?.type?.completed || false;
    
    const homeScore = completed ? (parseInt(homeTeam.score) || 0) : null;
    const awayScore = completed ? (parseInt(awayTeam.score) || 0) : null;
    const totalPoints = (homeScore !== null && awayScore !== null) ? homeScore + awayScore : null;
    
    const gameDate = new Date(storedOddsGame.commenceTime || espnGame.date || new Date());
    gameDate.setHours(0, 0, 0, 0);

    // Extract odds from stored format
    const odds = extractOdds(storedOddsGame.odds, storedOddsGame.homeTeam, storedOddsGame.awayTeam);

    // Only proceed if game is completed
    if (!completed || homeScore === null || awayScore === null) return null;

    // Calculate outcomes (game is completed)
    const outcomes = calculateOutcomes(homeScore, awayScore, odds);

    // Create or update GameOutcome (only for completed games)
    // Using gameId + sport as unique identifier (matches unique index)
    const gameOutcome = await GameOutcome.findOneAndUpdate(
      { gameId, sport },
      {
        $set: {
          gameDate,
          homeTeam: homeTeamName,
          awayTeam: awayTeamName,
          odds,
          result: {
            homeScore,
            awayScore,
            totalPoints,
            completed: true,
            completedAt: new Date()
          },
          outcomes,
          oddsFetchedAt: new Date(),
          resultFetchedAt: new Date(),
          processed: true
        },
        $setOnInsert: {
          gameId,
          sport
        }
      },
      { upsert: true, new: true }
    );

    return gameOutcome;
  } catch (error) {
    console.error(`    ✗ Error processing game:`, error.message);
    return null;
  }
};

// Find matching stored odds game for an ESPN game
const findMatchingStoredOdds = (espnGame, storedOddsGames) => {
  const espnId = String(espnGame.id);
  const espnTeams = extractESPNTeams(espnGame);
  if (!espnTeams) return null;

  // First try by ID
  let match = storedOddsGames.find(g => String(g.id) === espnId);
  if (match) return match;

  // Then try by team names (check both home/away and swapped)
  for (const storedGame of storedOddsGames) {
    const homeMatches = teamsMatch(storedGame.homeTeam, espnTeams.home) || teamsMatch(storedGame.homeTeam, espnTeams.away);
    const awayMatches = teamsMatch(storedGame.awayTeam, espnTeams.away) || teamsMatch(storedGame.awayTeam, espnTeams.home);
    
    if (homeMatches && awayMatches) {
      return storedGame;
    }
  }
  
  return null;
};

// Find matching ESPN game for stored odds
const findMatchingESPNGame = (storedGame, espnGames) => {
  const storedId = String(storedGame.id);
  
  // First try by ID
  let match = espnGames.find(g => String(g.id) === storedId);
  if (match) return match;

  // Then try by team names
  for (const espnGame of espnGames) {
    const espnTeams = extractESPNTeams(espnGame);
    if (!espnTeams) continue;
    
    const homeMatches = teamsMatch(storedGame.homeTeam, espnTeams.home) || teamsMatch(storedGame.homeTeam, espnTeams.away);
    const awayMatches = teamsMatch(storedGame.awayTeam, espnTeams.away) || teamsMatch(storedGame.awayTeam, espnTeams.home);
    
    if (homeMatches && awayMatches) {
      return espnGame;
    }
  }
  
  return null;
};

// Main processing function
const processDailyGames = async (targetDate) => {
  if (targetDate) {
    console.log(`\n📅 Processing games for: ${targetDate.toDateString()}\n`);
  } else {
    console.log(`\n📅 Processing all games - fetching comprehensive ESPN data\n`);
  }

  const sports = ['nba', 'nfl', 'ncaa-basketball', 'ncaa-football'];
  let totalProcessed = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkippedNoOdds = 0;
  let totalSkippedNotCompleted = 0;

  for (const sport of sports) {
    console.log(`\n🏀 Processing ${sport}...`);
    
    try {
      // Fetch odds from database (already stored from daily updates)
      const storedOddsGames = await oddsDatabase.getOddsForSport(sport);
      console.log(`  📊 Found ${storedOddsGames.length} games with odds in database`);

      if (storedOddsGames.length === 0) {
        console.log(`  ⚠️  No odds found for ${sport}, skipping`);
        continue;
      }

      // Determine date range for ESPN API fetching
      // Simple: look back 7 days from today
      let startDate, endDate;
      
      if (targetDate) {
        // Single date
        startDate = new Date(targetDate);
        endDate = new Date(targetDate);
      } else {
        // Look back 7 days from today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        endDate = new Date(today);
        endDate.setDate(endDate.getDate() + 1); // Include today
        
        startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 7); // 7 days ago
      }

      console.log(`  📡 Fetching ESPN games from ${startDate.toDateString()} to ${endDate.toDateString()}`);
      
      // Fetch ALL games from ESPN for the date range
      const espnGames = await fetchGamesForDateRange(sport, startDate, endDate);
      console.log(`  📡 Fetched ${espnGames.length} games from ESPN API`);

      if (espnGames.length === 0) {
        console.log(`  ⚠️  No ESPN games found for ${sport}`);
        continue;
      }

      // Filter stored odds to only games within our date range
      const gamesInRange = storedOddsGames.filter(game => {
        if (!game.commenceTime) return false;
        const gameDate = new Date(game.commenceTime);
        gameDate.setHours(0, 0, 0, 0);
        return gameDate >= startDate && gameDate <= endDate;
      });
      
      console.log(`  📊 ${gamesInRange.length} games with odds in date range (${storedOddsGames.length - gamesInRange.length} outside range)`);

      // Process strategy: 
      // 1. For each stored odds game, find matching ESPN game and process
      // 2. For each completed ESPN game, check if we have odds and process
      
      const processedGameIds = new Set();
      let skippedNoESPN = 0;
      let skippedNotCompleted = 0;
      let successfullyProcessed = 0;
      let skippedNoOdds = 0;
      const unmatchedGames = []; // Track games that couldn't be matched for debugging

      // Strategy 1: Process stored odds games (primary)
      console.log(`  🔄 Processing ${gamesInRange.length} games with odds in range...`);
      for (const storedOddsGame of gamesInRange) {
        // Filter by target date if specified
        if (targetDate && storedOddsGame.commenceTime) {
          const gameDate = new Date(storedOddsGame.commenceTime);
          const targetYear = targetDate.getFullYear();
          const targetMonth = targetDate.getMonth();
          const targetDay = targetDate.getDate();
          
          if (gameDate.getFullYear() !== targetYear ||
              gameDate.getMonth() !== targetMonth ||
              gameDate.getDate() !== targetDay) {
            continue;
          }
        }

        const espnGame = findMatchingESPNGame(storedOddsGame, espnGames);
        
        if (!espnGame) {
          skippedNoESPN++;
          unmatchedGames.push({
            home: storedOddsGame.homeTeam,
            away: storedOddsGame.awayTeam,
            id: storedOddsGame.id,
            date: storedOddsGame.commenceTime
          });
          continue;
        }

        const competition = espnGame.competitions?.[0];
        const status = competition?.status;
        const completed = status?.type?.completed || false;
        
        if (!completed) {
          skippedNotCompleted++;
          continue;
        }

        const gameId = String(espnGame.id);
        if (processedGameIds.has(gameId)) continue;

        const result = await processGame(sport, storedOddsGame, espnGame);
        if (result) {
          processedGameIds.add(gameId);
          successfullyProcessed++;
          const isNew = result.createdAt.getTime() === result.updatedAt.getTime();
          if (isNew) {
            totalCreated++;
          } else {
            totalUpdated++;
          }
          totalProcessed++;
        }
      }

      // Strategy 2: Process completed ESPN games that might not have been matched
      // This catches games that exist in ESPN but weren't in our odds (or had different IDs)
      console.log(`  🔄 Processing ${espnGames.length} ESPN games for any missed matches...`);
      for (const espnGame of espnGames) {
        const gameId = String(espnGame.id);
        if (processedGameIds.has(gameId)) continue;

        const competition = espnGame.competitions?.[0];
        const status = competition?.status;
        const completed = status?.type?.completed || false;
        
        if (!completed) {
          continue;
        }

        // Try to find matching stored odds (only check games in our date range)
        const storedOddsGame = findMatchingStoredOdds(espnGame, gamesInRange);
        
        if (!storedOddsGame) {
          skippedNoOdds++;
          continue;
        }

        const result = await processGame(sport, storedOddsGame, espnGame);
        if (result) {
          processedGameIds.add(gameId);
          successfullyProcessed++;
          const isNew = result.createdAt.getTime() === result.updatedAt.getTime();
          if (isNew) {
            totalCreated++;
          } else {
            totalUpdated++;
          }
          totalProcessed++;
        }
      }

      // Summary for this sport
      console.log(`  ✓ Summary:`);
      console.log(`    - Successfully processed: ${successfullyProcessed}`);
      console.log(`    - Skipped (no ESPN match): ${skippedNoESPN}`);
      if (skippedNoESPN > 0 && unmatchedGames.length > 0) {
        console.log(`    - Unmatched games (first 5):`);
        unmatchedGames.slice(0, 5).forEach(g => {
          console.log(`      • ${g.away} @ ${g.home} (ID: ${g.id}, Date: ${g.date ? new Date(g.date).toDateString() : 'N/A'})`);
        });
      }
      console.log(`    - Skipped (not completed): ${skippedNotCompleted}`);
      console.log(`    - Skipped (no odds): ${skippedNoOdds}`);
      
      totalSkippedNoOdds += skippedNoOdds;
      totalSkippedNotCompleted += skippedNotCompleted;
    } catch (error) {
      console.error(`  ✗ Error processing ${sport}:`, error.message);
      console.error(error.stack);
    }
  }

  console.log(`\n✅ Complete:`);
  console.log(`   - Total processed: ${totalProcessed} (${totalCreated} created, ${totalUpdated} updated)`);
  console.log(`   - Skipped (not completed): ${totalSkippedNotCompleted}`);
  console.log(`   - Skipped (no odds): ${totalSkippedNoOdds}\n`);
};

// Main execution
const main = async () => {
  await connectDB();

  // Determine target date
  let targetDate = null; // null means process all games
  const dateArg = process.argv[2];
  
  if (dateArg) {
    if (dateArg === 'all' || dateArg === '--all') {
      // Process all games
      targetDate = null;
    } else {
      // Parse date argument (YYYY-MM-DD)
      targetDate = new Date(dateArg);
      if (isNaN(targetDate.getTime())) {
        console.error('✗ Invalid date format. Use YYYY-MM-DD or "all" to process all games');
        process.exit(1);
      }
      targetDate.setHours(0, 0, 0, 0);
    }
  } else {
    // Default to today
    targetDate = new Date();
    targetDate.setHours(0, 0, 0, 0);
  }

  try {
    await processDailyGames(targetDate);
  } catch (error) {
    console.error('✗ Fatal error:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('✓ Database connection closed');
    process.exit(0);
  }
};

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { processDailyGames };

