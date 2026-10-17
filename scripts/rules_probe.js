// Runs the dashboard's own decision rules (web/rules.js) over web/forecast.json and prints the results as JSON,
// so scripts/validate_data.py can prove the Tableau export gives exactly the same answers.
// Usage: node scripts/rules_probe.js            (reads web/forecast.json)
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.resolve(__dirname, "..");
const F = JSON.parse(fs.readFileSync(path.join(root, "web", "forecast.json"), "utf8"));
const sandbox = { F, sum: (a) => a.reduce((x, y) => x + y, 0), state: { brief: { rules: { invest: 0.7, risk: 0.7, floor: 4.0 } } }, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "web", "rules.js"), "utf8") + "\n;this.derive = derive; this.decide = decide;", sandbox);
const out = F.segments.map((s) => {
  sandbox.derive(s);
  const a = sandbox.decide(s), d = s.d;
  return { id: s.id, pm: d.pm, last12: d.last12, prior12: d.prior12, fc12: d.fc12, lo12: d.lo12, hi12: d.hi12, growth: d.growth, pGrowth: d.pGrowth,
    rNow: d.rNow, dR: d.dR, grade: d.grade, action: a.key, tentative: a.tentative };
});
process.stdout.write(JSON.stringify(out));
