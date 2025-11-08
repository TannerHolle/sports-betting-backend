require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const os = require('os');
const betResolver = require('./services/betResolver');
const connectDB = require('./config/database');

// Import routes
const userRoutes = require('./routes/userRoutes');
const authRoutes = require('./routes/authRoutes');
const betRoutes = require('./routes/betRoutes');
const leagueRoutes = require('./routes/leagueRoutes');
const oddsRoutes = require('./routes/oddsRoutes');
const suggestionRoutes = require('./routes/suggestionRoutes');
const aiRoutes = require('./routes/aiRoutes');

// Import models for direct routes
const User = require('./models/User');
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), database: 'MongoDB' });
});

// Get all users (separate from /api/user/:username)
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

// Routes
app.use('/api/user', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/bets', betRoutes);
app.use('/api/leagues', leagueRoutes);
app.use('/api/odds', oddsRoutes);
app.use('/api/suggestions', suggestionRoutes);
app.use('/api/ai', aiRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Get network IP address
function getNetworkIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const startServer = async () => {
  await connectDB();
  app.listen(PORT, '0.0.0.0', () => {
    const networkIP = getNetworkIP();
    console.log(`🚀 Sports Betting Backend running on port ${PORT}`);
    console.log(`📊 Health check:`);
    console.log(`   Local:   http://localhost:${PORT}/api/health`);
    if (networkIP !== 'localhost') {
      console.log(`   Network: http://${networkIP}:${PORT}/api/health`);
    }
    console.log('💾 Database: MongoDB');
    betResolver.startAutoResolution(1);
  });
};

startServer();


