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

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Password helpers
const validatePassword = (password) => {
  if (!password || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }
  if (!/(?=.*[a-z])/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter' };
  }
  if (!/(?=.*[A-Z])/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }
  if (!/(?=.*\d)/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  if (!/(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/.test(password)) {
    return { valid: false, error: 'Password must contain at least one special character' };
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
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    const pv = validatePassword(password);
    if (!pv.valid) return res.status(400).json({ error: pv.error });

    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(409).json({ error: 'Username already exists' });

    const hashedPassword = await hashPassword(password);
    const newUser = new User({
      username,
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
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const user = await User.findOne({ username });
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

app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}).populate('bets');
    res.json(users.map(u => { const o = u.toObject(); delete o.password; return o; }));
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to load users' });
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
  app.listen(PORT, () => {
    console.log(`🚀 Sports Betting Backend running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log('💾 Database: MongoDB');
    betResolver.startAutoResolution(1);
  });
};

startServer();


