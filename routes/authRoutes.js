const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyPassword } = require('../utils/passwordHelpers');

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const user = await User.findOne({ username: username.toLowerCase() }).populate('bets').populate('parlays');
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

module.exports = router;

