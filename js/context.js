// Some characters cannot be told apart alone: O and 0, I and 1, S and 5.
// Their neighbours settle it. In a word of letters the round one is an O; in
// a number it is a zero.

const isDigit = (label) => label >= '0' && label <= '9';
const SWITCH = Math.log(10); // what changing between letters and digits inside a word costs

// `word` is a list of characters, each { guesses: [{ label, p }, ...] } with
// every label the network knows, or { fixed: label } for one the writer chose.
// Returns the label to show for each.
export function settle(word) {
  // For each character: its best letter and best digit, with their costs.
  const options = word.map((ch) => {
    if (ch.fixed != null) return [isDigit(ch.fixed) ? null : { label: ch.fixed, cost: 0 }, isDigit(ch.fixed) ? { label: ch.fixed, cost: 0 } : null];
    const best = [null, null];
    for (const g of ch.guesses) {
      const k = isDigit(g.label) ? 1 : 0;
      if (!best[k] || g.p > best[k].p) best[k] = g;
    }
    return best.map((g) => g && { label: g.label, cost: -Math.log(Math.max(g.p, 1e-9)) });
  });
  // The cheapest way through, choosing letter (0) or digit (1) at each character.
  let cost = [0, 0];
  const came = [];
  options.forEach((opt, i) => {
    const next = [Infinity, Infinity], from = [0, 0];
    for (const k of [0, 1]) {
      if (!opt[k]) continue;
      for (const j of [0, 1]) {
        const c = cost[j] + opt[k].cost + (i > 0 && j !== k ? SWITCH : 0);
        if (c < next[k]) { next[k] = c; from[k] = j; }
      }
    }
    cost = next;
    came.push(from);
  });
  const out = [];
  let k = cost[0] <= cost[1] ? 0 : 1;
  for (let i = options.length - 1; i >= 0; i--) { out[i] = options[i][k].label; k = came[i][k]; }
  return out;
}
