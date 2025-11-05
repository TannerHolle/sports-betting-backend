const League = require('../models/League');

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

module.exports = {
  generateInviteCode
};

