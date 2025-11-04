const axios = require('axios');
const Bet = require('../models/Bet');
const User = require('../models/User');

class BetResolver {
  constructor() {
    this.resolutionInterval = null;
  }

  async getLiveGameData(gameId, sport = 'nba') {
    try {
      let apiUrl;
      switch (sport.toLowerCase()) {
        case 'nba':
          apiUrl = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
          break;
        case 'nfl':
          apiUrl = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
          break;
        case 'ncaa-basketball':
          apiUrl = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';
          break;
        case 'ncaa-football':
          apiUrl = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';
          break;
        default:
          apiUrl = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
      }
      const response = await axios.get(apiUrl);
      const games = response.data.events || [];
      return games.find(game => game.id === gameId);
    } catch (error) {
      console.error(`Error fetching game data for ${gameId}:`, error.message);
      return null;
    }
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
        if (this.teamNamesMatch(bet.selection, homeTeamName)) betWon = (homeScore + spreadLine) > awayScore;
        else if (this.teamNamesMatch(bet.selection, awayTeamName)) betWon = (awayScore + spreadLine) > homeScore;
        break;
      case 'total':
        const totalLine = this.extractLine(bet);
        if (totalLine === null) return null;
        if (bet.selection === 'Over') betWon = totalPoints > totalLine;
        else if (bet.selection === 'Under') betWon = totalPoints < totalLine;
        break;
      default:
        return null;
    }

    return {
      status: betWon ? 'won' : 'lost',
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
      const n = parseFloat(bet.line);
      return isNaN(n) ? null : n;
    }
    return null;
  }

  async processAllPendingBets() {
    const pendingBets = await Bet.find({ status: 'pending' }).populate('user');
    if (!pendingBets.length) return;

    const betsByGame = {};
    for (const bet of pendingBets) {
      if (!betsByGame[bet.gameId]) betsByGame[bet.gameId] = { sport: bet.sport || 'nba', bets: [] };
      betsByGame[bet.gameId].bets.push(bet);
    }

    for (const [gameId, group] of Object.entries(betsByGame)) {
      const sport = group.sport;
      const gameData = await this.getLiveGameData(gameId, sport);
      if (!gameData) continue;
      const status = gameData.competitions?.[0]?.status;
      if (!status?.type?.completed) continue;

      for (const bet of group.bets) {
        const outcome = this.determineBetOutcome(bet, gameData);
        if (!outcome) continue;
        try {
          bet.status = outcome.status;
          bet.resolvedAt = new Date();
          bet.actualResult = outcome.actualResult;
          await bet.save();

          const user = await User.findById(bet.user);
          if (!user) continue;
          if (outcome.status === 'won') {
            const totalWinnings = bet.amount + bet.potentialWin;
            user.balance += totalWinnings;
            user.totalWon += bet.potentialWin;
          } else {
            user.totalLost += bet.amount;
          }
          user.updatedAt = new Date();
          await user.save();
        } catch (err) {
          console.error(`Error resolving bet ${bet._id}:`, err.message);
        }
      }
    }
  }

  startAutoResolution(intervalMinutes = 5) {
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


