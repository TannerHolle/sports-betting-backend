// Grading logic for a single selection - shared by straight bets and parlay legs.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

const resolver = require('../services/betResolver');

// Minimal ESPN-shaped completed game
const finished = (home, away, homeScore, awayScore) => ({
  competitions: [{
    status: { type: { completed: true, name: 'STATUS_FINAL' } },
    competitors: [
      { homeAway: 'home', score: String(homeScore), team: { shortDisplayName: home } },
      { homeAway: 'away', score: String(awayScore), team: { shortDisplayName: away } }
    ]
  }]
});

const inProgress = (home, away, hs, as_) => {
  const g = finished(home, away, hs, as_);
  g.competitions[0].status.type = { completed: false, name: 'STATUS_IN_PROGRESS', state: 'in' };
  return g;
};

const bet = (betType, selection, line = null) => ({ betType, selection, line });
const grade = (b, g) => {
  const out = resolver.determineBetOutcome(b, g);
  return out && out.status;
};

// Ducks 30, Beavers 20 -> margin 10, total 50
const GAME = finished('Ducks', 'Beavers', 30, 20);

test('moneyline', async (t) => {
  await t.test('winner wins, loser loses', () => {
    assert.equal(grade(bet('moneyline', 'Ducks'), GAME), 'won');
    assert.equal(grade(bet('moneyline', 'Beavers'), GAME), 'lost');
  });
});

test('spread', async (t) => {
  await t.test('favourite covering', () => {
    assert.equal(grade(bet('spread', 'Ducks', '-7.5'), GAME), 'won');
  });
  await t.test('favourite not covering', () => {
    assert.equal(grade(bet('spread', 'Ducks', '-14.5'), GAME), 'lost');
  });
  await t.test('underdog covering the number', () => {
    assert.equal(grade(bet('spread', 'Beavers', '+14.5'), GAME), 'won');
  });
  await t.test('landing exactly on the number is a push', () => {
    assert.equal(grade(bet('spread', 'Ducks', '-10'), GAME), 'push');
    assert.equal(grade(bet('spread', 'Beavers', '+10'), GAME), 'push');
  });
  await t.test('the sign is respected, not stripped', () => {
    // -7.5 covers, +7.5 on the same team is a different (also winning) bet;
    // the point is that they are not treated as the same number
    assert.equal(grade(bet('spread', 'Beavers', '-7.5'), GAME), 'lost');
  });
});

test('total', async (t) => {
  await t.test('over and under', () => {
    assert.equal(grade(bet('total', 'Over', '45.5'), GAME), 'won');
    assert.equal(grade(bet('total', 'Under', '45.5'), GAME), 'lost');
    assert.equal(grade(bet('total', 'Over', '55.5'), GAME), 'lost');
    assert.equal(grade(bet('total', 'Under', '55.5'), GAME), 'won');
  });
  await t.test('exact total is a push', () => {
    assert.equal(grade(bet('total', 'Over', '50'), GAME), 'push');
    assert.equal(grade(bet('total', 'Under', '50'), GAME), 'push');
  });
  await t.test('o/u prefixes on the line are tolerated', () => {
    assert.equal(grade(bet('total', 'Over', 'o45.5'), GAME), 'won');
    assert.equal(grade(bet('total', 'Under', 'u45.5'), GAME), 'lost');
  });
});

test('refuses to grade what it cannot read', async (t) => {
  await t.test('unfinished games', () => {
    assert.equal(resolver.determineBetOutcome(
      bet('moneyline', 'Ducks'), inProgress('Ducks', 'Beavers', 30, 20)), null);
  });
  await t.test('missing or malformed game data', () => {
    for (const g of [null, undefined, {}, { competitions: [] }]) {
      assert.equal(resolver.determineBetOutcome(bet('moneyline', 'Ducks'), g), null);
    }
  });
  await t.test('a spread or total with no line', () => {
    assert.equal(resolver.determineBetOutcome(bet('spread', 'Ducks', null), GAME), null);
    assert.equal(resolver.determineBetOutcome(bet('total', 'Over', null), GAME), null);
  });
});

test('team name matching', async (t) => {
  await t.test('is exact after normalising, not substring', () => {
    assert.ok(resolver.teamNamesMatch('Ducks', 'Ducks'));
    assert.ok(resolver.teamNamesMatch('Texas A&M', 'Texas A and M'));
    assert.ok(resolver.teamNamesMatch('St. Johns', 'St Johns'));
    // "Miami" must not match "Miami (OH)" - that bug cost real money once
    assert.ok(!resolver.teamNamesMatch('Miami', 'Miami (OH)'));
    assert.ok(!resolver.teamNamesMatch('Ducks', 'Duck'));
  });
  await t.test('handles empty input', () => {
    assert.ok(!resolver.teamNamesMatch('', 'Ducks'));
    assert.ok(!resolver.teamNamesMatch(null, undefined));
  });
});

test('a selection matching neither team currently grades as a loss', () => {
  // Documents existing behaviour, and it is worth knowing: if a team name ever
  // fails to match (a rename, a feed change), the bettor is silently marked
  // down as a loser rather than the bet being left for a human to look at.
  const out = resolver.determineBetOutcome(bet('moneyline', 'Sharks'), GAME);
  assert.equal(out && out.status, 'lost');
});
