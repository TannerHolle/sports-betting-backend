// American odds math, shared by parlay pricing and resolution.
//
// American -> decimal:  +150 => 2.50   (win 1.5x stake, plus stake back)
//                       -200 => 1.50   (win 0.5x stake, plus stake back)
// A parlay's decimal price is the product of its legs.

const parseAmerican = (odds) => {
  if (odds === null || odds === undefined) return null;
  if (typeof odds === 'number') return Number.isFinite(odds) ? odds : null;

  const raw = String(odds).trim();
  if (/^even$/i.test(raw)) return 100;

  const n = parseInt(raw.replace(/[^0-9+-]/g, ''), 10);
  return Number.isNaN(n) ? null : n;
};

const americanToDecimal = (odds) => {
  const n = parseAmerican(odds);
  if (n === null || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
};

const decimalToAmerican = (decimal) => {
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : -Math.round(100 / (decimal - 1));
};

const formatAmerican = (n) => (n === null ? null : (n > 0 ? `+${n}` : `${n}`));

// Combined decimal price for a set of legs. Pushed legs are excluded, which is
// how sportsbooks handle them: the parlay simply shrinks by one leg.
const combineLegs = (legs = []) => {
  const priced = legs.filter(leg => leg && leg.status !== 'push');
  if (!priced.length) return null;

  let decimal = 1;
  for (const leg of priced) {
    const d = americanToDecimal(leg.odds);
    if (d === null) return null;
    decimal *= d;
  }
  return decimal;
};

// Profit (not total return) on a winning parlay, rounded to whole dollars to
// match how straight bets store potentialWin.
const calculatePayout = (legs, amount) => {
  const decimal = combineLegs(legs);
  if (decimal === null || !Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * decimal - amount);
};

module.exports = {
  parseAmerican,
  americanToDecimal,
  decimalToAmerican,
  formatAmerican,
  combineLegs,
  calculatePayout
};
