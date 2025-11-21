const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Bet = require('../models/Bet');
const { validatePassword, hashPassword, verifyPassword } = require('../utils/passwordHelpers');

// Get advanced betting statistics (must be before /:username route)
router.get('/:username/advanced-stats', async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username: username.toLowerCase() }).populate('bets');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 1. Calculate win percentage by bet type for user's bets, grouped by sport
    const completedBets = user.bets.filter(bet => 
      bet.status === 'won' || bet.status === 'lost' || bet.status === 'push'
    );

    // Group by sport
    const statsByBetTypeBySport = {};
    const userSports = new Set();

    completedBets.forEach(bet => {
      if (!bet.sport) return;
      const sport = bet.sport;
      userSports.add(sport);
      
      if (!statsByBetTypeBySport[sport]) {
        statsByBetTypeBySport[sport] = {
          moneyline: { won: 0, lost: 0, push: 0, total: 0 },
          spread: { won: 0, lost: 0, push: 0, total: 0 },
          total: { won: 0, lost: 0, push: 0, total: 0 }
        };
      }
      
      if (statsByBetTypeBySport[sport][bet.betType]) {
        statsByBetTypeBySport[sport][bet.betType][bet.status]++;
        statsByBetTypeBySport[sport][bet.betType].total++;
      }
    });

    // Calculate percentages for each sport
    const winPercentageByTypeBySport = {};
    for (const sport of userSports) {
      const statsByBetType = statsByBetTypeBySport[sport];
      winPercentageByTypeBySport[sport] = {};
      
      Object.keys(statsByBetType).forEach(betType => {
        const stats = statsByBetType[betType];
        const nonPushTotal = stats.total - stats.push;
        if (nonPushTotal > 0) {
          winPercentageByTypeBySport[sport][betType] = {
            winRate: ((stats.won / nonPushTotal) * 100).toFixed(1),
            won: stats.won,
            lost: stats.lost,
            push: stats.push,
            total: stats.total
          };
        } else {
          winPercentageByTypeBySport[sport][betType] = {
            winRate: '0.0',
            won: 0,
            lost: 0,
            push: stats.push,
            total: stats.total
          };
        }
      });
    }

    // Calculate overall (all sports combined)
    const overallStatsByBetType = {
      moneyline: { won: 0, lost: 0, push: 0, total: 0 },
      spread: { won: 0, lost: 0, push: 0, total: 0 },
      total: { won: 0, lost: 0, push: 0, total: 0 }
    };

    completedBets.forEach(bet => {
      if (overallStatsByBetType[bet.betType]) {
        overallStatsByBetType[bet.betType][bet.status]++;
        overallStatsByBetType[bet.betType].total++;
      }
    });

    const winPercentageByType = {};
    Object.keys(overallStatsByBetType).forEach(betType => {
      const stats = overallStatsByBetType[betType];
      const nonPushTotal = stats.total - stats.push;
      if (nonPushTotal > 0) {
        winPercentageByType[betType] = {
          winRate: ((stats.won / nonPushTotal) * 100).toFixed(1),
          won: stats.won,
          lost: stats.lost,
          push: stats.push,
          total: stats.total
        };
      } else {
        winPercentageByType[betType] = {
          winRate: '0.0',
          won: 0,
          lost: 0,
          push: stats.push,
          total: stats.total
        };
      }
    });

    winPercentageByTypeBySport.all = winPercentageByType;

    // 2. All games in system - use line and scores from completed bets, grouped by sport
    const allCompletedBets = await Bet.find({ 
      status: { $in: ['won', 'lost', 'push'] },
      actualResult: { $exists: true, $ne: null },
      line: { $exists: true, $ne: null }
    });

    // Group outcomes by sport
    const gameOutcomesBySport = {};
    const allSports = new Set();
    const processedGamesBySport = {}; // Track processed games per sport

    for (const bet of allCompletedBets) {
      if (!bet.actualResult || !bet.gameId || !bet.line || !bet.sport) continue;
      
      const sport = bet.sport;
      allSports.add(sport);
      
      if (!gameOutcomesBySport[sport]) {
        gameOutcomesBySport[sport] = {
          total: { over: 0, under: 0, push: 0, total: 0 },
          spread: { covered: 0, push: 0, total: 0 }
        };
        processedGamesBySport[sport] = new Set();
      }
      
      const gameOutcomes = gameOutcomesBySport[sport];
      const processedGames = processedGamesBySport[sport];
      
      const homeScore = parseInt(bet.actualResult.homeScore) || 0;
      const awayScore = parseInt(bet.actualResult.awayScore) || 0;
      const totalPoints = parseInt(bet.actualResult.totalPoints) || 0;
      const line = parseFloat(bet.line);

      if (isNaN(line)) continue;

      // For total bets - one outcome per game
      if (bet.betType === 'total' && !processedGames.has(`total_${bet.gameId}`)) {
        processedGames.add(`total_${bet.gameId}`);
        
        if (!isNaN(totalPoints)) {
          gameOutcomes.total.total++;
          if (totalPoints > line) {
            gameOutcomes.total.over++;
          } else if (totalPoints < line) {
            gameOutcomes.total.under++;
          } else {
            gameOutcomes.total.push++;
          }
        }
      }

      // For spread bets - one outcome per game
      if (bet.betType === 'spread' && !processedGames.has(`spread_${bet.gameId}`)) {
        processedGames.add(`spread_${bet.gameId}`);
        
        if (!isNaN(homeScore) && !isNaN(awayScore)) {
          const homeTeamName = bet.actualResult.homeTeam || '';
          const selection = bet.selection || '';
          
          // Determine if bet was on home team
          const betOnHome = homeTeamName && selection && (
            selection.toLowerCase() === homeTeamName.toLowerCase() ||
            homeTeamName.toLowerCase().includes(selection.toLowerCase()) ||
            selection.toLowerCase().includes(homeTeamName.toLowerCase())
          );
          
          // Normalize line to home team perspective
          const homeTeamLine = betOnHome ? line : -line;
          
          gameOutcomes.spread.total++;
          
          // Add the spread line to home team score to see if they cover
          const adjustedHome = homeScore + homeTeamLine;
          
          if (adjustedHome === awayScore) {
            gameOutcomes.spread.push++; // Push
          } else if (homeTeamLine < 0) {
            // Home team is favorite (negative spread)
            if (adjustedHome > awayScore) {
              gameOutcomes.spread.covered++; // Favorite covered
            }
          } else {
            // Away team is favorite (positive spread means home is underdog)
            if (adjustedHome < awayScore) {
              gameOutcomes.spread.covered++; // Favorite (away) covered
            }
          }
        }
      }
    }

    // Calculate percentages for each sport
    const gameOutcomes = {};
    for (const sport of allSports) {
      const outcomes = gameOutcomesBySport[sport];
      const totalNonPush = outcomes.total.total - outcomes.total.push;
      const spreadNonPush = outcomes.spread.total - outcomes.spread.push;
      
      gameOutcomes[sport] = {
        total: {
          overPercentage: totalNonPush > 0 ? ((outcomes.total.over / totalNonPush) * 100).toFixed(1) : '0.0',
          underPercentage: totalNonPush > 0 ? ((outcomes.total.under / totalNonPush) * 100).toFixed(1) : '0.0',
          overCount: outcomes.total.over,
          underCount: outcomes.total.under,
          pushCount: outcomes.total.push,
          totalGames: outcomes.total.total
        },
        spread: {
          coveredPercentage: spreadNonPush > 0 ? ((outcomes.spread.covered / spreadNonPush) * 100).toFixed(1) : '0.0',
          coveredCount: outcomes.spread.covered,
          pushCount: outcomes.spread.push,
          totalGames: outcomes.spread.total
        }
      };
    }

    // Also calculate overall (all sports combined)
    const overallOutcomes = {
      total: { over: 0, under: 0, push: 0, total: 0 },
      spread: { covered: 0, push: 0, total: 0 }
    };
    
    for (const sport of allSports) {
      const outcomes = gameOutcomesBySport[sport];
      overallOutcomes.total.over += outcomes.total.over;
      overallOutcomes.total.under += outcomes.total.under;
      overallOutcomes.total.push += outcomes.total.push;
      overallOutcomes.total.total += outcomes.total.total;
      overallOutcomes.spread.covered += outcomes.spread.covered;
      overallOutcomes.spread.push += outcomes.spread.push;
      overallOutcomes.spread.total += outcomes.spread.total;
    }
    
    const totalNonPush = overallOutcomes.total.total - overallOutcomes.total.push;
    const spreadNonPush = overallOutcomes.spread.total - overallOutcomes.spread.push;
    
    gameOutcomes.all = {
      total: {
        overPercentage: totalNonPush > 0 ? ((overallOutcomes.total.over / totalNonPush) * 100).toFixed(1) : '0.0',
        underPercentage: totalNonPush > 0 ? ((overallOutcomes.total.under / totalNonPush) * 100).toFixed(1) : '0.0',
        overCount: overallOutcomes.total.over,
        underCount: overallOutcomes.total.under,
        pushCount: overallOutcomes.total.push,
        totalGames: overallOutcomes.total.total
      },
      spread: {
        coveredPercentage: spreadNonPush > 0 ? ((overallOutcomes.spread.covered / spreadNonPush) * 100).toFixed(1) : '0.0',
        coveredCount: overallOutcomes.spread.covered,
        pushCount: overallOutcomes.spread.push,
        totalGames: overallOutcomes.spread.total
      }
    };

    // Combine all sports from user bets and game outcomes
    const allAvailableSports = new Set([...userSports, ...allSports]);
    
    res.json({
      winPercentageByType,
      winPercentageByTypeBySport,
      gameOutcomes,
      availableSports: Array.from(allAvailableSports).sort()
    });
  } catch (error) {
    console.error('Error fetching advanced stats:', error);
    res.status(500).json({ error: 'Failed to load advanced statistics' });
  }
});

// Get user by username
router.get('/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).populate('bets');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const userResponse = user.toObject();
    delete userResponse.password;
    res.json(userResponse);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

// Create new user
router.post('/', async (req, res) => {
  try {
    // Log request body for debugging
    console.log('Received user creation request:', { 
      body: req.body, 
      hasUsername: !!req.body?.username, 
      hasPassword: !!req.body?.password 
    });
    
    const { username, password, name, email, phoneNumber } = req.body;
    
    // Validate request body exists
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    
    // Validate username and password are provided and not empty
    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({ error: 'Username is required and must be a non-empty string' });
    }
    
    // Validate username length and characters
    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long' });
    }
    if (trimmedUsername.length > 30) {
      return res.status(400).json({ error: 'Username must be no more than 30 characters long' });
    }
    
    if (!password || typeof password !== 'string' || password.length === 0) {
      return res.status(400).json({ error: 'Password is required and must be a non-empty string' });
    }
    
    // Validate name
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required and must be a non-empty string' });
    }
    
    // Validate email
    if (!email || typeof email !== 'string' || email.trim().length === 0) {
      return res.status(400).json({ error: 'Email is required and must be a non-empty string' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Validate phone number
    if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim().length === 0) {
      return res.status(400).json({ error: 'Phone number is required and must be a non-empty string' });
    }
    
    // Validate password strength
    const pv = validatePassword(password);
    if (!pv.valid) {
      return res.status(400).json({ error: pv.error });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ username: { $regex: new RegExp(`^${trimmedUsername.toLowerCase()}$`, 'i') } });
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Create new user
    const hashedPassword = await hashPassword(password);
    const newUser = new User({
      username: trimmedUsername.toLowerCase(),
      password: hashedPassword,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phoneNumber: phoneNumber.trim(),
      balance: 1000,
      totalWagered: 0,
      totalWon: 0,
      totalLost: 0,
      bets: []
    });

    await newUser.save();
    const userResponse = newUser.toObject();
    delete userResponse.password;
    res.status(201).json(userResponse);
  } catch (error) {
    console.error('Error creating user:', error);
    
    // Handle Mongoose validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(e => e.message).join(', ');
      return res.status(400).json({ error: `Validation error: ${errors}` });
    }
    
    // Handle duplicate key error (unique constraint)
    if (error.code === 11000 || error.code === 11001) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    
    // Handle other errors
    res.status(500).json({ error: 'Failed to create user', details: error.message });
  }
});

// Update user
router.put('/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const userData = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    Object.assign(user, userData);
    user.updatedAt = new Date();
    await user.save();

    const userResponse = user.toObject();
    delete userResponse.password;
    res.json(userResponse);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Place bet
router.post('/:username/bet', async (req, res) => {
  try {
    const { username } = req.params;
    const betData = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { gameId, betType, selection, amount, odds, line, potentialWin, sport, gameData } = betData;
    if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

    const bet = new Bet({
      user: user._id,
      gameId,
      betType,
      selection,
      amount,
      odds,
      line,
      potentialWin,
      sport,
      status: 'pending',
      gameData
    });

    await bet.save();

    user.balance -= amount;
    user.totalWagered += amount;
    user.bets.push(bet._id);
    user.updatedAt = new Date();
    await user.save();

    res.json({ success: true, bet, user });
  } catch (error) {
    console.error('Error placing bet:', error);
    res.status(500).json({ error: 'Failed to place bet' });
  }
});

// Update bet
router.put('/:username/bet/:betId', async (req, res) => {
  try {
    const { username, betId } = req.params;
    const { status, actualResult } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const bet = await Bet.findOne({ _id: betId, user: user._id });
    if (!bet) return res.status(404).json({ error: 'Bet not found' });

    bet.status = status;
    bet.resolvedAt = new Date();
    bet.actualResult = actualResult;
    await bet.save();

    if (status === 'won') {
      const totalWinnings = bet.amount + bet.potentialWin;
      user.balance += totalWinnings;
      user.totalWon += bet.potentialWin;
    } else if (status === 'push') {
      user.balance += bet.amount;
    } else if (status === 'lost') {
      user.totalLost += bet.amount;
    }

    user.updatedAt = new Date();
    await user.save();

    res.json({ success: true, user });
  } catch (error) {
    console.error('Error resolving bet:', error);
    res.status(500).json({ error: 'Failed to resolve bet' });
  }
});

// Delete bet
router.delete('/:username/bet/:betId', async (req, res) => {
  try {
    const { username, betId } = req.params;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const bet = await Bet.findOne({ _id: betId, user: user._id });
    if (!bet) return res.status(404).json({ error: 'Bet not found' });

    // Only allow cancellation of pending bets
    if (bet.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending bets can be cancelled' });
    }

    // Refund the bet amount to user's balance
    user.balance += bet.amount;
    user.totalWagered -= bet.amount; // Subtract from total wagered since bet is cancelled
    
    // Remove bet from user's bets array
    user.bets = user.bets.filter(betRef => betRef.toString() !== betId);
    user.updatedAt = new Date();
    await user.save();

    // Delete the bet
    await Bet.deleteOne({ _id: betId });

    res.json({ success: true, user });
  } catch (error) {
    console.error('Error cancelling bet:', error);
    res.status(500).json({ error: 'Failed to cancel bet' });
  }
});

// Get user's leagues
router.get('/:username/leagues', async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const League = require('../models/League');
    const { generateInviteCode } = require('../utils/leagueHelpers');
    
    // Get user's leagues
    const leagues = await League.find({ _id: { $in: user.leagues } })
      .populate('creator', 'username')
      .populate('members', 'username')
      .sort({ createdAt: -1 });
    
    // Generate invite codes for any leagues that don't have one (for backwards compatibility)
    for (const league of leagues) {
      if (!league.inviteCode) {
        league.inviteCode = await generateInviteCode();
        await league.save();
      }
    }
    
    // Fetch again to get updated codes
    const updatedLeagues = await League.find({ _id: { $in: user.leagues } })
      .populate('creator', 'username')
      .populate('members', 'username')
      .sort({ createdAt: -1 });
    
    res.json(updatedLeagues);
  } catch (error) {
    console.error('Error fetching user leagues:', error);
    res.status(500).json({ error: 'Failed to load leagues' });
  }
});

module.exports = router;

