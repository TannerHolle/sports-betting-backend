const axios = require('axios');
const Bet = require('../models/Bet');
const User = require('../models/User');

class BetResolver {
  constructor() {
    this.resolutionInterval = null;
  }

  formatDateForAPI(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  async getLiveGameData(gameId, sport = '', searchDate = null) {
    try {
      const date = searchDate || new Date();
      const formattedDate = this.formatDateForAPI(date);
      
      const sportUrls = {
        'nba': `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${formattedDate}`,
        'nfl': `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${formattedDate}`,
        'ncaa-basketball': `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${formattedDate}`,
        'ncaa-football': `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${formattedDate}`
      };
      
      const apiUrl = sportUrls[sport.toLowerCase()] || sportUrls['nba'];
      const response = await axios.get(apiUrl);
      const games = response.data.events || [];
      return games.find(game => String(game.id) === String(gameId)) || null;
    } catch (error) {
      return null;
    }
  }

  async findGame(gameId, sport) {
    // Try yesterday, today, and tomorrow
    const today = new Date();
    const dates = [
      new Date(today.getTime() - 24 * 60 * 60 * 1000), // yesterday
      today,                                            // today
      new Date(today.getTime() + 24 * 60 * 60 * 1000)  // tomorrow
    ];
    
    // Try each date until we find the game
    for (const date of dates) {
      const gameData = await this.getLiveGameData(gameId, sport, date);
      if (gameData) return gameData;
    }
    
    return null;
  }

  determineBetOutcome(bet, gameData) {
    if (!gameData || !gameData.competitions?.[0]) return null;
    const competition = gameData.competitions[0];
    const competitors = competition.competitors || [];
    const homeTeam = competitors.find(c => c.homeAway === 'home');
    const awayTeam = competitors.find(c => c.homeAway === 'away');
    const status = competition.status;
    if (!homeTeam || !awayTeam || !status) return null;
    if (!status.type?.completed) return null;

    const homeScore = parseInt(homeTeam.score) || 0;
    const awayScore = parseInt(awayTeam.score) || 0;
    const homeTeamName = homeTeam.team?.shortDisplayName || homeTeam.team?.displayName || '';
    const awayTeamName = awayTeam.team?.shortDisplayName || awayTeam.team?.displayName || '';
    const homeWon = homeScore > awayScore;
    const awayWon = awayScore > homeScore;
    const totalPoints = homeScore + awayScore;

    let betWon = false;
    let spreadResult = null; // Used to track pushes
    switch (bet.betType) {
      case 'moneyline':
        if (this.teamNamesMatch(bet.selection, homeTeamName)) betWon = homeWon;
        else if (this.teamNamesMatch(bet.selection, awayTeamName)) betWon = awayWon;
        break;
      case 'spread':
        const spreadLine = this.extractLine(bet);
        if (spreadLine === null) return null;
        // For spread bets: (teamScore + spreadLine) > opponentScore
        // Negative spread (favorite) means they must win by more than |spreadLine|
        // Positive spread (underdog) means they win if they lose by less than spreadLine or win
        // If (teamScore + spreadLine) === opponentScore, it's a push
        let spreadResult;
        if (this.teamNamesMatch(bet.selection, homeTeamName)) {
          const adjustedScore = homeScore + spreadLine;
          if (adjustedScore === awayScore) {
            spreadResult = 'push';
          } else {
            betWon = adjustedScore > awayScore;
          }
        } else if (this.teamNamesMatch(bet.selection, awayTeamName)) {
          const adjustedScore = awayScore + spreadLine;
          if (adjustedScore === homeScore) {
            spreadResult = 'push';
          } else {
            betWon = adjustedScore > homeScore;
          }
        }
        break;
      case 'total':
        const totalLine = this.extractLine(bet);
        if (totalLine === null) return null;
        // If total equals the line exactly, it's a push
        if (totalPoints === totalLine) {
          spreadResult = 'push';
        } else if (bet.selection === 'Over') {
          betWon = totalPoints > totalLine;
        } else if (bet.selection === 'Under') {
          betWon = totalPoints < totalLine;
        }
        break;
      default:
        return null;
    }

    // Determine final status: push takes precedence, then won/lost
    let finalStatus;
    if (spreadResult === 'push') {
      finalStatus = 'push';
    } else {
      finalStatus = betWon ? 'won' : 'lost';
    }

    return {
      status: finalStatus,
      actualResult: {
        homeTeam: homeTeamName,
        awayTeam: awayTeamName,
        homeScore,
        awayScore,
        totalPoints,
        gameStatus: 'Final',
        resolvedAt: new Date().toISOString()
      }
    };
  }

  extractLine(bet) {
    if (bet.line !== undefined && bet.line !== null) {
      // Convert to string
      let lineStr = String(bet.line).trim();
      
      // For spread bets, preserve the sign (+ or -) as it's critical for resolution
      // For total bets, remove "o" (over) and "u" (under) prefixes but keep the number
      if (bet.betType === 'spread') {
        // For spreads, keep the sign - parse directly
        const n = parseFloat(lineStr);
        return isNaN(n) ? null : n;
      } else {
        // For totals, remove "o" and "u" prefixes but keep the number
        lineStr = lineStr.replace(/^[ouOU]/i, '');
        const n = parseFloat(lineStr);
        return isNaN(n) ? null : n;
      }
    }
    return null;
  }

  async processAllPendingBets() {
    const pendingBets = await Bet.find({ status: 'pending' }).populate('user');
    if (!pendingBets.length) {
      console.log('✓ No pending bets to resolve');
      return;
    }

    console.log(`\n🔍 Checking ${pendingBets.length} pending bet(s)...`);

    // Group bets by game
    const betsByGame = {};
    for (const bet of pendingBets) {
      if (!betsByGame[bet.gameId]) {
        betsByGame[bet.gameId] = {
          sport: bet.sport || '',
          bets: [],
          gameDate: bet.gameData?.gameStartTime || bet.createdAt
        };
      }
      betsByGame[bet.gameId].bets.push(bet);
    }

    let resolvedCount = 0;

    // Process each game
    for (const [gameId, group] of Object.entries(betsByGame)) {
      console.log(`  Checking game ${gameId} (${group.sport}, ${group.bets.length} bet(s))...`);
      
      const gameData = await this.findGame(gameId, group.sport);
      if (!gameData) {
        console.log(`    ⚠️  Game not found in API`);
        continue;
      }

      const status = gameData.competitions?.[0]?.status;
      const statusName = status?.type?.name || 'unknown';
      
      if (!status?.type?.completed) {
        console.log(`    ⏳ Game not completed (status: ${statusName}, teams: ${gameData.competitions?.[0]?.competitors?.map(c => c.team?.shortDisplayName || c.team?.displayName).join(', ')})`);
        continue;
      }

      console.log(`    ✅ Game completed! Resolving ${group.bets.length} bet(s)...`);

      // Resolve all bets for this completed game
      for (const bet of group.bets) {
        const outcome = this.determineBetOutcome(bet, gameData);
        if (!outcome) {
          console.log(`      ⚠️  Could not determine outcome for bet ${bet._id}`);
          continue;
        }

        try {
          bet.status = outcome.status;
          bet.resolvedAt = new Date();
          bet.actualResult = outcome.actualResult;
          await bet.save();

          const user = await User.findById(bet.user);
          if (!user) continue;

          if (outcome.status === 'won') {
            user.balance += bet.amount + bet.potentialWin;
            user.totalWon += bet.potentialWin;
            console.log(`      🎉 Bet WON: ${user.username} earned $${bet.potentialWin.toFixed(2)}`);
          } else if (outcome.status === 'push') {
            // Push: return the bet amount, no win or loss
            user.balance += bet.amount;
            console.log(`      ⚖️  Bet PUSH: ${user.username} received $${bet.amount.toFixed(2)} back`);
          } else {
            user.totalLost += bet.amount;
            console.log(`      ❌ Bet LOST: ${user.username} lost $${bet.amount.toFixed(2)}`);
          }
          await user.save();
          resolvedCount++;
        } catch (err) {
          console.error(`      ❌ Error resolving bet ${bet._id}:`, err.message);
        }
      }
    }

    console.log(`✓ Resolved ${resolvedCount} bet(s)\n`);
  }

  startAutoResolution(intervalMinutes = 1) {
    this.processAllPendingBets();
    this.resolutionInterval = setInterval(() => {
      this.processAllPendingBets();
    }, intervalMinutes * 60 * 1000);
  }

  stopAutoResolution() {
    if (this.resolutionInterval) {
      clearInterval(this.resolutionInterval);
      this.resolutionInterval = null;
    }
  }

  teamNamesMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    return false;
  }
}

module.exports = new BetResolver();


