const express = require('express');
const router = express.Router();
const League = require('../models/League');
const User = require('../models/User');
const { generateInviteCode } = require('../utils/leagueHelpers');

// Create league
router.post('/', async (req, res) => {
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
router.post('/:leagueId/join', async (req, res) => {
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
router.post('/join-by-code', async (req, res) => {
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

// Get all leagues
router.get('/', async (req, res) => {
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

// Get league by ID
router.get('/:leagueId', async (req, res) => {
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

module.exports = router;

