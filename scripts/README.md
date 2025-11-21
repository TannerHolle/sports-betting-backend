# Daily Game Outcomes Script

This script runs nightly to fetch odds and results for all games, storing them in the database for use in the advanced statistics section.

## What It Does

1. **Fetches Odds**: Gets betting odds from The Odds API for all games scheduled for a specific date
2. **Fetches Results**: Gets final scores from ESPN API for completed games
3. **Calculates Outcomes**: Determines if spreads were covered, if totals went over/under, etc.
4. **Stores Data**: Saves everything to the `GameOutcome` collection in MongoDB

## Usage

### Run for Yesterday (Default)
```bash
node backend/scripts/dailyGameOutcomes.js
```

### Run for a Specific Date
```bash
node backend/scripts/dailyGameOutcomes.js 2024-01-15
```

### Using npm script
```bash
npm run daily-outcomes
# or with a date
npm run daily-outcomes -- 2024-01-15
```

## Setting Up a Scheduled Task

### On Fly.io (Recommended for Production)

Fly.io offers several options for scheduled tasks. Here are the best approaches:

#### Option 1: Scheduled Machines (Simplest)

1. Add the process to your `fly.toml`:
```toml
# Process for daily game outcomes (runs as scheduled task)
[[processes]]
  name = "daily-outcomes"
  cmd = "node scripts/dailyGameOutcomes.js"
```

2. Create a scheduled machine using Fly.io CLI:
```bash
fly machine run --name daily-outcomes-$(date +%s) \
  --process daily-outcomes \
  --schedule daily \
  --region lax \
  --vm-size shared-cpu-1x \
  backend-late-smoke-5186
```

Or use the Fly.io dashboard to create a scheduled machine that runs daily.

#### Option 2: Using Supercronic (More Flexible)

1. Create a `crontab` file in your backend directory:
```
0 2 * * * node scripts/dailyGameOutcomes.js
```

2. Update your `Dockerfile` to install Supercronic:
```dockerfile
# Add after your base image setup
RUN apt-get update && apt-get install -y curl
RUN curl -L https://github.com/aptible/supercronic/releases/download/v0.2.27/supercronic-linux-amd64 -o /usr/local/bin/supercronic
RUN chmod +x /usr/local/bin/supercronic
COPY crontab /etc/crontab
```

3. Add a cron process to `fly.toml`:
```toml
[[processes]]
  name = "cron"
  cmd = "supercronic /etc/crontab"
```

**Note**: Fly.io schedules use UTC time. Adjust the hour accordingly (e.g., `0 2 * * *` is 2 AM UTC).

### On Linux/Mac (crontab)

1. Open your crontab:
```bash
crontab -e
```

2. Add this line to run the script every night at 2 AM:
```bash
0 2 * * * cd /path/to/sports-betting/backend && /usr/bin/node scripts/dailyGameOutcomes.js >> /path/to/sports-betting/backend/logs/daily-outcomes.log 2>&1
```

3. Or if you're using npm:
```bash
0 2 * * * cd /path/to/sports-betting/backend && /usr/bin/npm run daily-outcomes >> /path/to/sports-betting/backend/logs/daily-outcomes.log 2>&1
```

**Note**: Replace `/path/to/sports-betting` with your actual project path, and `/usr/bin/node` with your Node.js path (find it with `which node`).

### On Windows (Task Scheduler)

1. Open Task Scheduler
2. Create a new task
3. Set trigger to "Daily" at 2:00 AM
4. Set action to run a program:
   - Program: `node.exe` (or full path to node.exe)
   - Arguments: `backend/scripts/dailyGameOutcomes.js`
   - Start in: `C:\path\to\sports-betting\backend`

### Using PM2 (Process Manager)

If you're using PM2 to manage your Node.js processes:

1. Create a PM2 ecosystem file or add to existing one:
```javascript
{
  "apps": [
    {
      "name": "daily-outcomes",
      "script": "backend/scripts/dailyGameOutcomes.js",
      "cron_restart": "0 2 * * *",
      "autorestart": false,
      "watch": false
    }
  ]
}
```

2. Start it:
```bash
pm2 start ecosystem.config.js --only daily-outcomes
```

## Environment Variables

Make sure these are set in your `.env` file:

- `MONGODB_URI`: Your MongoDB connection string
- `ODDS_API_KEY`: Your The Odds API key (for fetching betting odds)

## Output

The script will:
- Log progress to the console
- Create/update `GameOutcome` documents in MongoDB
- Show summary of games processed, created, and updated

## Troubleshooting

- **No games found**: The script runs for yesterday by default. Games might not be available yet if run too early.
- **API errors**: Check your API keys and rate limits
- **Database errors**: Verify your MongoDB connection string
- **Missing results**: Some games might not have ESPN data immediately after completion

## Data Structure

Each `GameOutcome` document contains:
- Game metadata (ID, sport, date, teams)
- Odds data (spread, total, moneyline)
- Final results (scores, completion status)
- Calculated outcomes (spread covered, over/under, etc.)

This data is then used by the advanced statistics endpoint to show comprehensive betting statistics across all games, not just games where bets were placed.

