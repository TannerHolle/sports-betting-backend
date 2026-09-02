const axios = require('axios');
const Bet = require('../models/Bet');
const Parlay = require('../models/Parlay');
const User = require('../models/User');
const { combineLegs, calculatePayout } = require('../utils/oddsMath');

class BetResolver {
  constructor() {
    this.resolutionInterval = null;
    this.isResolving = false;
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
          // Settling and paying must happen once and only once. Make the
          // pending -> settled transition itself the lock: whoever's write
          // matches a still-pending bet owns the payout, everyone else backs
          // off. This holds across overlapping passes and across machines,
          // with no lock collection and no intermediate 'resolving' state to
          // get stuck in.
          const claim = await Bet.updateOne(
            { _id: bet._id, status: 'pending' },
            { $set: {
                status: outcome.status,
                resolvedAt: new Date(),
                actualResult: outcome.actualResult
              } }
          );
          if (claim.modifiedCount === 0) {
            // Already settled by another pass - do not pay it again
            continue;
          }

          const userId = bet.user?._id || bet.user;
          const username = bet.user?.username || userId;

          // $inc rather than read-modify-write, so two bets settling for the
          // same user can't clobber each other's balance change
          if (outcome.status === 'won') {
            await User.updateOne({ _id: userId },
              { $inc: { balance: bet.amount + bet.potentialWin, totalWon: bet.potentialWin } });
            console.log(`      🎉 Bet WON: ${username} earned $${bet.potentialWin.toFixed(2)}`);
          } else if (outcome.status === 'push') {
            await User.updateOne({ _id: userId }, { $inc: { balance: bet.amount } });
            console.log(`      ⚖️  Bet PUSH: ${username} received $${bet.amount.toFixed(2)} back`);
          } else {
            await User.updateOne({ _id: userId }, { $inc: { totalLost: bet.amount } });
            console.log(`      ❌ Bet LOST: ${username} lost $${bet.amount.toFixed(2)}`);
          }
          resolvedCount++;
        } catch (err) {
          console.error(`      ❌ Error resolving bet ${bet._id}:`, err.message);
        }
      }
    }

    console.log(`✓ Resolved ${resolvedCount} bet(s)\n`);
  }

  async processAllPendingParlays() {
    const pendingParlays = await Parlay.find({ status: 'pending' });
    if (!pendingParlays.length) return;

    console.log(`\n🎯 Checking ${pendingParlays.length} pending parlay(s)...`);

    // One lookup per game, shared across every parlay that uses it
    const gameCache = new Map();
    const lookup = async (gameId, sport) => {
      const key = `${gameId}|${sport || ''}`;
      if (!gameCache.has(key)) gameCache.set(key, await this.findGame(gameId, sport));
      return gameCache.get(key);
    };

    let resolvedCount = 0;

    for (const parlay of pendingParlays) {
      let changed = false;

      for (const leg of parlay.legs) {
        if (leg.status !== 'pending') continue;
        const gameData = await lookup(leg.gameId, leg.sport);
        if (!gameData) continue;
        if (!gameData.competitions?.[0]?.status?.type?.completed) continue;

        const outcome = this.determineBetOutcome(leg, gameData);
        if (!outcome) continue;

        leg.status = outcome.status;
        leg.actualResult = outcome.actualResult;
        leg.resolvedAt = new Date();
        changed = true;
      }

      const anyLost = parlay.legs.some(leg => leg.status === 'lost');
      const allSettled = parlay.legs.every(leg => leg.status !== 'pending');

      // A single losing leg kills the parlay - no need to wait for the rest
      if (!anyLost && !allSettled) {
        if (changed) await parlay.save();
        continue;
      }

      const user = await User.findById(parlay.user);

      if (anyLost) {
        // Same rule as straight bets: the pending -> settled write is the lock
        const claim = await Parlay.updateOne(
          { _id: parlay._id, status: 'pending' },
          { $set: { status: 'lost', resolvedAt: new Date(), legs: parlay.legs } }
        );
        if (claim.modifiedCount === 0) continue;
        if (user) {
          await User.updateOne({ _id: user._id }, { $inc: { totalLost: parlay.amount } });
          console.log(`      ❌ Parlay LOST: ${user.username} lost $${parlay.amount.toFixed(2)}`);
        }
        resolvedCount++;
        continue;
      }

      // Everything settled with no losers. Pushed legs drop out of the price,
      // so a parlay where every leg pushed is just a refund.
      const survivingDecimal = combineLegs(parlay.legs);

      if (survivingDecimal === null) {
        const claim = await Parlay.updateOne(
          { _id: parlay._id, status: 'pending' },
          { $set: { status: 'push', resolvedAt: new Date(), legs: parlay.legs } }
        );
        if (claim.modifiedCount === 0) continue;
        if (user) {
          await User.updateOne({ _id: user._id }, { $inc: { balance: parlay.amount } });
          console.log(`      ⚖️  Parlay PUSH: ${user.username} refunded $${parlay.amount.toFixed(2)}`);
        }
        resolvedCount++;
        continue;
      }

      // Re-price on the legs that actually counted
      const payout = calculatePayout(parlay.legs, parlay.amount);
      const claim = await Parlay.updateOne(
        { _id: parlay._id, status: 'pending' },
        { $set: { status: 'won', potentialWin: payout, resolvedAt: new Date(), legs: parlay.legs } }
      );
      if (claim.modifiedCount === 0) continue;
      if (user) {
        await User.updateOne(
          { _id: user._id },
          { $inc: { balance: parlay.amount + payout, totalWon: payout } }
        );
        const pushed = parlay.legs.filter(l => l.status === 'push').length;
        console.log(`      🎉 Parlay WON: ${user.username} earned $${payout.toFixed(2)}` +
          (pushed ? ` (${pushed} leg(s) pushed, re-priced)` : ''));
      }
      resolvedCount++;
    }

    if (resolvedCount) console.log(`✓ Resolved ${resolvedCount} parlay(s)\n`);
  }

  // setInterval doesn't wait for the previous run, and a pass can outlast the
  // interval (each game costs up to three sequential ESPN lookups). Without
  // this, a slow pass overlaps the next one inside a single process.
  async resolveAll() {
    if (this.isResolving) {
      console.log('⏭️  Resolution already in progress, skipping this tick');
      return;
    }
    this.isResolving = true;
    try {
      await this.processAllPendingBets();
      await this.processAllPendingParlays();
    } catch (err) {
      console.error('❌ Resolution pass failed:', err.message);
    } finally {
      this.isResolving = false;
    }
  }

  startAutoResolution(intervalMinutes = 1) {
    this.resolveAll();
    this.resolutionInterval = setInterval(() => {
      this.resolveAll();
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
    const normalize = (s) => {
      return String(s)
        .toLowerCase()
        // Replace ampersands with 'and' to normalize common variants.
        // Spaces matter: without them "Texas A&M" becomes "texas aandm" and
        // stops matching "Texas A and M". Kept in step with the frontend's
        // matcher in services/oddsService.js.
        .replace(/&/g, ' and ')
        // Remove all non-alphanumeric (keep spaces)
        .replace(/[^a-z0-9\s]/g, ' ')
        // Collapse multiple spaces
        .replace(/\s+/g, ' ')
        .trim();
    };
    const na = normalize(a);
    const nb = normalize(b);
    // Strict normalized equality only; do NOT treat substrings as matches
    return na === nb;
  }
}

module.exports = new BetResolver();


