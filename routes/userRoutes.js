const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Bet = require('../models/Bet');
const { validatePassword, hashPassword, verifyPassword } = require('../utils/passwordHelpers');

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

