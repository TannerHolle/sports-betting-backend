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

// Main processing function
const processDailyGames = async (targetDate) => {
  if (targetDate) {
    console.log(`\n📅 Processing games for: ${targetDate.toDateString()}\n`);
  } else {
    console.log(`\n📅 Processing all games in database\n`);
  }

  const sports = ['nba', 'nfl', 'ncaa-basketball', 'ncaa-football'];
  let totalProcessed = 0;
  let totalCreated = 0;
  let totalUpdated = 0;

  for (const sport of sports) {
    console.log(`\n🏀 Processing ${sport}...`);
    
    try {
      // Fetch odds from database (already stored from daily updates)
      const storedOddsGames = await oddsDatabase.getOddsForSport(sport);

      // Filter odds for target date (or process all if no target date)
      let gamesForDate;
      if (targetDate) {
        const targetDateStr = formatDateForAPI(targetDate);
        const targetYear = targetDate.getFullYear();
        const targetMonth = targetDate.getMonth();
        const targetDay = targetDate.getDate();
        
        gamesForDate = storedOddsGames.filter(game => {
          if (!game.commenceTime) return false;
          const gameDate = new Date(game.commenceTime);
          // Compare by calendar date (year, month, day) regardless of timezone
          return gameDate.getFullYear() === targetYear &&
                 gameDate.getMonth() === targetMonth &&
                 gameDate.getDate() === targetDay;
        });

      } else {
        gamesForDate = storedOddsGames.filter(game => game.commenceTime);
      }

      if (gamesForDate.length === 0) continue;

      // Fetch results from ESPN
      let espnGames = [];
      
      if (targetDate) {
        espnGames = await fetchGameResults(sport, targetDate);
      } else {
        // Fetch for all unique dates in games
        const uniqueDates = new Set();
        gamesForDate.forEach(game => {
          if (game.commenceTime) {
            const gameDate = new Date(game.commenceTime);
            uniqueDates.add(formatDateForAPI(gameDate));
          }
        });
        
        for (const dateStr of uniqueDates) {
          const year = parseInt(dateStr.substring(0, 4));
          const month = parseInt(dateStr.substring(4, 6)) - 1;
          const day = parseInt(dateStr.substring(6, 8));
          const date = new Date(year, month, day);
          const results = await fetchGameResults(sport, date);
          espnGames.push(...results);
        }
      }

      // Helper function to normalize team names for matching
      const normalizeTeamName = (name) => {
        return name.toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .replace(/\s+/g, '');
      };

      // Helper function to match teams (fuzzy matching)
      const teamsMatch = (team1, team2) => {
        const norm1 = normalizeTeamName(team1);
        const norm2 = normalizeTeamName(team2);
        // Exact match
        if (norm1 === norm2) return true;
        // One contains the other (for cases like "Lakers" vs "Los Angeles Lakers")
        if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
        return false;
      };

      // Helper function to find matching ESPN game
      const findMatchingESPNGame = (storedGame) => {
        // First try by ID
        let match = espnGames.find(g => String(g.id) === String(storedGame.id));
        if (match) return match;

        // Then try by team names
        for (const espnGame of espnGames) {
          const competition = espnGame.competitions?.[0];
          const competitors = competition?.competitors || [];
          const homeTeam = competitors.find(c => c.homeAway === 'home');
          const awayTeam = competitors.find(c => c.homeAway === 'away');
          
          if (!homeTeam || !awayTeam) continue;
          
          const espnHome = homeTeam.team?.shortDisplayName || homeTeam.team?.displayName || '';
          const espnAway = awayTeam.team?.shortDisplayName || awayTeam.team?.displayName || '';
          
          // Check if teams match (both home and away)
          const homeMatches = teamsMatch(storedGame.homeTeam, espnHome) || teamsMatch(storedGame.homeTeam, espnAway);
          const awayMatches = teamsMatch(storedGame.awayTeam, espnAway) || teamsMatch(storedGame.awayTeam, espnHome);
          
          // Both teams must match (could be swapped)
          if (homeMatches && awayMatches) {
            return espnGame;
          }
        }
        
        return null;
      };

      // Count stats for logging
      let skippedNoESPN = 0;
      let skippedNotCompleted = 0;
      let successfullyProcessed = 0;

      // Process each game
      for (const storedOddsGame of gamesForDate) {
        const espnGame = findMatchingESPNGame(storedOddsGame);
        
        if (!espnGame) {
          skippedNoESPN++;
          continue;
        }

        const competition = espnGame.competitions?.[0];
        const status = competition?.status;
        const completed = status?.type?.completed || false;
        
        if (!completed) {
          skippedNotCompleted++;
          continue;
        }

        const result = await processGame(sport, storedOddsGame, espnGame);
        if (result) {
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
      if (gamesForDate.length > 0) {
        console.log(`  ✓ ${successfullyProcessed} processed, ${skippedNoESPN} no ESPN data, ${skippedNotCompleted} not completed`);
      }
    } catch (error) {
      console.error(`  ✗ Error processing ${sport}:`, error.message);
    }
  }

  console.log(`\n✅ Complete: ${totalProcessed} processed (${totalCreated} created, ${totalUpdated} updated)\n`);
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

