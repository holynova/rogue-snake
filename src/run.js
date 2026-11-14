import { RNG } from './rng.js';
import { UPGRADES, RELICS, STARTING_RELICS } from './data.js';
import { meta } from './meta.js';

const BASE = {
  hp: 6,
  dmg: 1,
  speed: 4.0,      // tiles per second
  length: 5,
  cap: 16,         // growth soft cap
  sight: 10,
  dashLen: 3,
  dashCd: 2.4,
};

export function createRun(opts = {}) {
  const seed = opts.seed >>> 0;
  const rng = new RNG(seed);
  const run = {
    seed,
    rng,
    depth: 1,
    maxDepth: 0,
    steps: 0,
    kills: 0,
    score: 0,
    essence: 0,
    essenceSpent: 0,
    level: 1,
    xp: 0,
    hp: BASE.hp,
    length: BASE.length,
    growth: 0,          // pending segments
    relics: [],
    upgrades: {},
    startRelic: opts.startingRelic || 'none',
    flags: {},
    bonus: {
      dmg: 0, hp: 0, spd: 1, growth: 0, leech: 0, wallDmg: 0,
      dashLen: 0, dashCd: 1, thorns: 0, digest: 0, essence: 1,
      selfHarm: 1, sight: 0, regen: 0, xp: 1, shield: 0, execute: false,
      chain: 0, loner: 0, drop: 0, cap: 0, bloodpact: 0, crit: 0, echo: 0,
      devour: 0, luck: 0, berserk: 0, ascend: 0,
    },
    echoReady: 0,
    invulnUntil: 0,
    log: [],
  };

  applyMeta(run);
  const start = STARTING_RELICS[run.startRelic];
  if (start && start.apply) start.apply(run);
  run.hp = maxHp(run);
  return run;
}

function applyMeta(run) {
  run.bonus.hp += meta.branchLevel('vitality');
  run.bonus.dmg += meta.branchLevel('fangs');
  run.bonus.spd *= 1 + meta.branchLevel('swift') * 0.04;
  run.bonus.essence *= 1 + meta.branchLevel('greed') * 0.08;
  run.bonus.shield += meta.branchLevel('aegis');
  run.bonus.sight += meta.branchLevel('omen');
}

export function maxHp(run) {
  return Math.max(2, BASE.hp + run.bonus.hp);
}

export function speed(run) {
  return BASE.speed * run.bonus.spd;
}

export function sightRadius(run) {
  return BASE.sight + run.bonus.sight;
}

export function cap(run) {
  return BASE.cap + run.bonus.cap;
}

export function dashCooldown(run) {
  return BASE.dashCd * run.bonus.dashCd;
}

export function dashLength(run) {
  return BASE.dashLen + run.bonus.dashLen;
}

export function biteDamage(run) {
  let d = BASE.dmg + run.bonus.dmg;
  d += Math.floor(run.length * run.bonus.digest);
  if (run.bonus.berserk && run.hp / maxHp(run) < 0.5) d += run.bonus.berserk;
  if (run.bonus.loner && run.length < 12) d += run.bonus.loner;
  return Math.max(1, Math.round(d));
}

export function xpForLevel(run, level = run.level) {
  return Math.round(14 + level * 9 + level * level * 1.15 + (run.depth - 1) * 4);
}

export function addXp(run, amount) {
  run.xp += Math.round(amount * run.bonus.xp);
  const levels = [];
  while (run.xp >= xpForLevel(run)) {
    run.xp -= xpForLevel(run);
    run.level += 1;
    levels.push(run.level);
  }
  return levels;
}

export function offerUpgrades(run, count = 3) {
  const pool = UPGRADES.filter((u) => (run.upgrades[u.id] || 0) < u.max);
  const picks = [];
  const available = pool.slice();
  while (picks.length < count && available.length) {
    const idx = run.rng.int(0, available.length);
    picks.push(available.splice(idx, 1)[0]);
  }
  return picks;
}

export function takeUpgrade(run, upgrade) {
  const cur = run.upgrades[upgrade.id] || 0;
  run.upgrades[upgrade.id] = cur + 1;
  // Fractional ascend (e.g. 0.5 from one 升华之鳞) rolls for a second apply,
  // so a single relic actually does something instead of rounding to nothing.
  let times = 1 + Math.floor(run.bonus.ascend);
  const frac = run.bonus.ascend - Math.floor(run.bonus.ascend);
  if (frac > 0 && run.rng.chance(frac)) times += 1;
  for (let i = 0; i < times; i++) upgrade.apply(run);
  run.hp = Math.min(run.hp, maxHp(run));
}

export function addRelic(run, relic) {
  run.relics.push(relic.id);
  relic.apply(run);
  run.hp = Math.min(run.hp, maxHp(run));
  return relic;
}

export function randomRelic(run, rng, minRarity = 1) {
  const pool = RELICS.filter((r) => r.rarity >= minRarity && !run.relics.includes(r.id));
  if (!pool.length) return null;
  return rng.weighted(pool.map((r) => ({ w: 4 / r.rarity, ...r })));
}

export function addEssence(run, n) {
  const gain = Math.max(0, Math.round(n * run.bonus.essence));
  run.essence += gain;
  return gain;
}

export function grow(run, n) {
  run.growth += n;
  const max = cap(run);
  let grew = 0;
  while (run.growth > 0 && run.length < max) {
    run.growth -= 1;
    run.length += 1;
    grew += 1;
  }
  // overflow past the soft cap converts into essence instead of vanishing
  if (run.growth > 0) {
    const spill = run.growth;
    run.growth = 0;
    addEssence(run, spill * 2);
  }
  return grew;
}

export function score(run) {
  return Math.round(
    run.depth * 120 + run.kills * 8 + run.essence * 3 + run.length * 4 + run.level * 25 + run.maxDepth * 40
  );
}

export function rewardEchoes(run, won) {
  return Math.round((run.maxDepth * 6 + run.kills * 2 + (won ? 120 : 0)) * (1 + run.maxDepth / 12));
}
