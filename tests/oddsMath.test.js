// Run with: npm test   (node's built-in runner, no dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAmerican, americanToDecimal, decimalToAmerican,
  formatAmerican, combineLegs, calculatePayout
} = require('../utils/oddsMath');

const leg = (odds, status = 'pending') => ({ odds, status });
const close = (actual, expected, tol = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tol, `${actual} !== ${expected}`);

test('parseAmerican', async (t) => {
  await t.test('reads signed strings and numbers', () => {
    assert.equal(parseAmerican('+150'), 150);
    assert.equal(parseAmerican('-110'), -110);
    assert.equal(parseAmerican('150'), 150);
    assert.equal(parseAmerican(-105), -105);
  });
  await t.test('treats EVEN as +100', () => {
    assert.equal(parseAmerican('EVEN'), 100);
    assert.equal(parseAmerican('even'), 100);
  });
  await t.test('returns null for junk', () => {
    for (const bad of [null, undefined, '', 'abc', NaN, Infinity]) {
      assert.equal(parseAmerican(bad), null, `expected null for ${String(bad)}`);
    }
  });
});

test('americanToDecimal', async (t) => {
  await t.test('underdogs', () => {
    close(americanToDecimal('+150'), 2.5);
    close(americanToDecimal('+100'), 2.0);
    close(americanToDecimal('+900'), 10.0);
  });
  await t.test('favourites', () => {
    close(americanToDecimal('-200'), 1.5);
    close(americanToDecimal('-110'), 1 + 100 / 110);
    close(americanToDecimal('-105'), 1 + 100 / 105);
  });
  await t.test('EVEN is 2.0', () => close(americanToDecimal('EVEN'), 2.0));
  await t.test('rejects zero and junk', () => {
    assert.equal(americanToDecimal(0), null);
    assert.equal(americanToDecimal('abc'), null);
    assert.equal(americanToDecimal(null), null);
  });
});

test('decimalToAmerican', async (t) => {
  await t.test('known values', () => {
    assert.equal(decimalToAmerican(2.5), 150);
    assert.equal(decimalToAmerican(1.5), -200);
    assert.equal(decimalToAmerican(2.0), 100);
  });
  await t.test('a decimal of 1 or less has no american equivalent', () => {
    assert.equal(decimalToAmerican(1), null);
    assert.equal(decimalToAmerican(0.5), null);
    assert.equal(decimalToAmerican(NaN), null);
  });
  await t.test('round-trips through decimal', () => {
    for (const odds of ['+150', '-200', '-110', '+900', '-105', '+250', 'EVEN']) {
      const back = decimalToAmerican(americanToDecimal(odds));
      close(americanToDecimal(back), americanToDecimal(odds), 0.02);
    }
  });
});

test('formatAmerican keeps the leading sign', () => {
  assert.equal(formatAmerican(150), '+150');
  assert.equal(formatAmerican(-110), '-110');
  assert.equal(formatAmerican(null), null);
});

test('combineLegs', async (t) => {
  await t.test('multiplies the legs', () => {
    close(combineLegs([leg('+150'), leg('-200')]), 3.75);
  });
  await t.test('excludes pushed legs', () => {
    // a two-leg parlay with one push prices as the surviving single
    close(combineLegs([leg('-110'), leg('-110', 'push')]), americanToDecimal('-110'));
  });
  await t.test('all legs pushed returns null (refund, not a price)', () => {
    assert.equal(combineLegs([leg('-110', 'push'), leg('+150', 'push')]), null);
  });
  await t.test('null on empty or unreadable odds', () => {
    assert.equal(combineLegs([]), null);
    assert.equal(combineLegs(), null);
    assert.equal(combineLegs([leg('-110'), leg('abc')]), null);
  });
  await t.test('ignores null entries rather than throwing', () => {
    assert.equal(combineLegs([null, undefined]), null);
  });
});

test('calculatePayout returns profit, not total return', async (t) => {
  await t.test('two -110 legs on $100 pays $264', () => {
    assert.equal(calculatePayout([leg('-110'), leg('-110')], 100), 264);
  });
  await t.test('three -110 legs on $100 pays $596', () => {
    assert.equal(calculatePayout([leg('-110'), leg('-110'), leg('-110')], 100), 596);
  });
  await t.test('+150 with -200 on $100 pays $275', () => {
    assert.equal(calculatePayout([leg('+150'), leg('-200')], 100), 275);
  });
  await t.test('a pushed leg re-prices to the survivors', () => {
    // the exact case the resolver hit: 2 legs, one pushes -> pays like a single
    assert.equal(calculatePayout([leg('-110'), leg('-110', 'push')], 100), 91);
  });
  await t.test('scales with stake, to within whole-dollar rounding', () => {
    // Payouts round to whole dollars, so doubling the stake can land a dollar
    // off double the payout. Assert the property, not one combination's artifact.
    for (const odds of [['-110', '+150'], ['-200', '-110'], ['+900', '+250']]) {
      const legs = odds.map(o => leg(o));
      const at100 = calculatePayout(legs, 100);
      const at200 = calculatePayout(legs, 200);
      assert.ok(Math.abs(at200 - 2 * at100) <= 1,
        `${odds.join(' x ')}: $200 paid ${at200}, expected about ${2 * at100}`);
    }
  });
  await t.test('rejects non-positive or non-finite stakes', () => {
    const legs = [leg('-110'), leg('-110')];
    for (const bad of [0, -50, NaN, Infinity, null, undefined, 'abc']) {
      assert.equal(calculatePayout(legs, bad), null, `expected null for stake ${String(bad)}`);
    }
  });
  await t.test('null when any leg is unpriceable', () => {
    assert.equal(calculatePayout([leg('-110'), leg('abc')], 100), null);
  });
});

test('a parlay always pays more than its legs bet singly', () => {
  const legs = [leg('-110'), leg('-110')];
  const parlay = calculatePayout(legs, 100);
  const single = calculatePayout([leg('-110')], 100);
  assert.ok(parlay > single * 2, `${parlay} should beat ${single * 2}`);
});

test('longshot pricing stays sane', () => {
  // 5 x +900 is astronomically unlikely; make sure nothing overflows or rounds to 0
  const legs = Array.from({ length: 5 }, () => leg('+900'));
  const payout = calculatePayout(legs, 1);
  assert.ok(Number.isFinite(payout) && payout > 0, `got ${payout}`);
  assert.equal(payout, Math.round(Math.pow(10, 5) - 1));
});
