require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const oddsDatabase = require('./services/oddsDatabase');
const { checkAndUpdateOdds } = require('./middleware/oddsMiddleware');
const betResolver = require('./services/betResolver');

const connectDB = require('./config/database');
const User = require('./models/User');
const Bet = require('./models/Bet');
const League = require('./models/League');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Log middleware setup
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/user') {
    console.log('Middleware - Content-Type:', req.headers['content-type']);
    console.log('Middleware - Body keys:', req.body ? Object.keys(req.body) : 'no body');
  }
  next();
});

// Password helpers
const validatePassword = (password) => {
  if (!password || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }
  if (!/(?=.*[A-Z])/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }
  if (!/(?=.*\d)/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  return { valid: true };
};

const hashPassword = async (password) => {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
};

const verifyPassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), database: 'MongoDB' });
});

app.get('/api/user/:username', async (req, res) => {
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

app.post('/api/user', async (req, res) => {
  try {
    // Log request body for debugging
    console.log('Received user creation request:', { 
      body: req.body, 
      hasUsername: !!req.body?.username, 
      hasPassword: !!req.body?.password 
    });
    
    const { username, password } = req.body;
    
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

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const isValidPassword = await verifyPassword(password, user.password);
    if (!isValidPassword) return res.status(401).json({ error: 'Invalid username or password' });

    const userResponse = user.toObject();
    delete userResponse.password;
    res.json(userResponse);
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.put('/api/user/:username', async (req, res) => {
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

app.post('/api/user/:username/bet', async (req, res) => {
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

app.put('/api/user/:username/bet/:betId', async (req, res) => {
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

app.delete('/api/user/:username/bet/:betId', async (req, res) => {
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

app.get('/api/users', async (req, res) => {
  try {
    const { leagueId } = req.query;
    
    let users;
    if (leagueId) {
      // Filter by league members
      const league = await League.findById(leagueId);
      if (!league) {
        return res.status(404).json({ error: 'League not found' });
      }
      // Get member IDs directly (they're ObjectIds in the array)
      const memberIds = league.members;
      users = await User.find({ _id: { $in: memberIds } }).populate('bets');
    } else {
      // Get all users
      users = await User.find({}).populate('bets');
    }
    
    res.json(users.map(u => { const o = u.toObject(); delete o.password; return o; }));
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// Helper function to generate a unique invite code
const generateInviteCode = async () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding confusing characters like I, O, 0, 1
  let code = '';
  let isUnique = false;
  
  while (!isUnique) {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    const existing = await League.findOne({ inviteCode: code });
    if (!existing) {
      isUnique = true;
    }
  }
  
  return code;
};

// League endpoints
app.post('/api/leagues', async (req, res) => {
  try {
    const { name, username } = req.body;
    
    if (!name || !username) {
      return res.status(400).json({ error: 'League name and username are required' });
    }
    
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if league name already exists (unique per creator)
    const existingLeague = await League.findOne({ name: name.trim(), creator: user._id });
    if (existingLeague) {
      return res.status(409).json({ error: 'You already have a league with this name' });
    }
    
    // Generate unique invite code
    const inviteCode = await generateInviteCode();
    
    const league = new League({
      name: name.trim(),
      creator: user._id,
      members: [user._id],
      inviteCode: inviteCode
    });
    
    await league.save();
    
    // Add league to user's leagues
    user.leagues.push(league._id);
    await user.save();
    
    const leagueResponse = await League.findById(league._id)
      .populate('creator', 'username')
      .populate('members', 'username');
    
    res.status(201).json(leagueResponse);
  } catch (error) {
    console.error('Error creating league:', error);
    res.status(500).json({ error: 'Failed to create league', details: error.message });
  }
});

// Join by League ID (MongoDB ObjectId)
app.post('/api/leagues/:leagueId/join', async (req, res) => {
  try {
    const { leagueId } = req.params;
    const { username } = req.body;
    
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const league = await League.findById(leagueId);
    if (!league) {
      return res.status(404).json({ error: 'League not found' });
    }
    
    // Check if user is already a member
    if (league.members.some(m => m.toString() === user._id.toString())) {
      return res.status(409).json({ error: 'User is already a member of this league' });
    }
    
    // Add user to league
    league.members.push(user._id);
    await league.save();
    
    // Add league to user's leagues
    if (!user.leagues.some(l => l.toString() === league._id.toString())) {
      user.leagues.push(league._id);
      await user.save();
    }
    
    const leagueResponse = await League.findById(league._id)
      .populate('creator', 'username')
      .populate('members', 'username');
    
    res.json(leagueResponse);
  } catch (error) {
    console.error('Error joining league:', error);
    res.status(500).json({ error: 'Failed to join league', details: error.message });
  }
});

// Join by invite code (easier shareable code)
app.post('/api/leagues/join-by-code', async (req, res) => {
  try {
    const { inviteCode, username } = req.body;
    
    if (!inviteCode || !username) {
      return res.status(400).json({ error: 'Invite code and username are required' });
    }
    
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const league = await League.findOne({ inviteCode: inviteCode.toUpperCase() });
    if (!league) {
      return res.status(404).json({ error: 'Invalid invite code. Please check and try again.' });
    }
    
    // Check if user is already a member
    if (league.members.some(m => m.toString() === user._id.toString())) {
      return res.status(409).json({ error: 'You are already a member of this league' });
    }
    
    // Add user to league
    league.members.push(user._id);
    await league.save();
    
    // Add league to user's leagues
    if (!user.leagues.some(l => l.toString() === league._id.toString())) {
      user.leagues.push(league._id);
      await user.save();
    }
    
    const leagueResponse = await League.findById(league._id)
      .populate('creator', 'username')
      .populate('members', 'username');
    
    res.json(leagueResponse);
  } catch (error) {
    console.error('Error joining league by code:', error);
    res.status(500).json({ error: 'Failed to join league', details: error.message });
  }
});

app.get('/api/user/:username/leagues', async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
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

app.get('/api/leagues', async (req, res) => {
  try {
    // Get all leagues (for discovery - could add pagination later)
    const leagues = await League.find({})
      .populate('creator', 'username')
      .populate('members', 'username')
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.json(leagues);
  } catch (error) {
    console.error('Error fetching leagues:', error);
    res.status(500).json({ error: 'Failed to load leagues' });
  }
});

app.get('/api/leagues/:leagueId', async (req, res) => {
  try {
    const { leagueId } = req.params;
    const league = await League.findById(leagueId)
      .populate('creator', 'username')
      .populate('members', 'username');
    if (!league) {
      return res.status(404).json({ error: 'League not found' });
    }
    res.json(league);
  } catch (error) {
    console.error('Error fetching league:', error);
    res.status(500).json({ error: 'Failed to load league' });
  }
});

// Odds API endpoints
app.get('/api/odds/:sport', checkAndUpdateOdds, async (req, res) => {
  try {
    const { sport } = req.params;
    const validSports = ['nba', 'ncaa-basketball', 'ncaa-football'];
    if (!validSports.includes(sport)) {
      return res.status(400).json({ error: 'Invalid sport. Supported sports: nba, ncaa-basketball, ncaa-football' });
    }
    const odds = await oddsDatabase.getOddsForSport(sport);
    res.json(odds);
  } catch (error) {
    console.error('Error fetching odds:', error);
    res.status(500).json({ error: 'Failed to load odds' });
  }
});

app.get('/api/odds', checkAndUpdateOdds, async (req, res) => {
  try {
    const allOdds = await oddsDatabase.getAllOdds();
    res.json(allOdds);
  } catch (error) {
    console.error('Error fetching all odds:', error);
    res.status(500).json({ error: 'Failed to load odds' });
  }
});

app.get('/api/odds/last-update', async (req, res) => {
  try {
    const lastUpdate = await oddsDatabase.getLastUpdateTime();
    res.json({ lastUpdated: lastUpdate });
  } catch (error) {
    console.error('Error fetching last update time:', error);
    res.status(500).json({ error: 'Failed to get last update time' });
  }
});

app.post('/api/odds/force-update', async (req, res) => {
  try {
    const oddsService = require('./services/oddsService');
    const freshOdds = await oddsService.fetchAllOdds();
    const processedOdds = {};
    for (const [sport, oddsData] of Object.entries(freshOdds)) {
      processedOdds[sport] = oddsService.processOddsData(oddsData, sport);
    }
    await oddsDatabase.updateOdds(processedOdds);
    res.json({ success: true, message: 'Odds updated successfully' });
  } catch (error) {
    console.error('Error force updating odds:', error);
    res.status(500).json({ error: 'Failed to force update odds', details: error.message });
  }
});

app.post('/api/bets/force-resolve', async (req, res) => {
  try {
    await betResolver.processAllPendingBets();
    res.json({ success: true, message: 'Bets resolved successfully' });
  } catch (error) {
    console.error('Error force resolving bets:', error);
    res.status(500).json({ error: 'Failed to resolve bets', details: error.message });
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const startServer = async () => {
  await connectDB();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Sports Betting Backend running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log('💾 Database: MongoDB');
    betResolver.startAutoResolution(1);
  });
};

startServer();


