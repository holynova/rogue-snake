/* Persistent meta-progression ("Sanctum") stored in localStorage. */

const KEY = 'ouroboros.meta.v2';

export const META_BRANCHES = [
  { id: 'vitality', name: '生机', icon: '❤', desc: '每级 +1 最大生命', max: 10, cost: (l) => 12 + l * 8 },
  { id: 'fangs', name: '獠牙', icon: '✦', desc: '每级 +1 起始伤害', max: 10, cost: (l) => 14 + l * 9 },
  { id: 'swift', name: '轻身', icon: '»', desc: '每级 +4% 移动速度', max: 8, cost: (l) => 16 + l * 11 },
  { id: 'greed', name: '拾遗', icon: '◈', desc: '每级 +8% 精华获取', max: 8, cost: (l) => 10 + l * 7 },
  { id: 'aegis', name: '护佑', icon: '⬢', desc: '每级开局获得 1 点护盾', max: 3, cost: (l) => 40 + l * 45 },
  { id: 'omen', name: '预兆', icon: '☾', desc: '每级开局视野 +1', max: 6, cost: (l) => 18 + l * 10 },
];

export const UNLOCKS = [
  { id: 's_ember', name: '起始遗物：余烬', cost: 40, branch: 'startingRelic', value: 'ember' },
  { id: 's_pearl', name: '起始遗物：珠鳞', cost: 60, branch: 'startingRelic', value: 'pearl' },
  { id: 's_fang', name: '起始遗物：幼牙', cost: 90, branch: 'startingRelic', value: 'fang' },
  { id: 's_root', name: '起始遗物：根须', cost: 130, branch: 'startingRelic', value: 'root' },
  { id: 's_lamp', name: '起始遗物：提灯', cost: 70, branch: 'startingRelic', value: 'lamp' },
  { id: 'c_daily', name: '每日种子', cost: 110, branch: 'daily' },
];

const DEFAULTS = {
  echoes: 0,
  branches: { vitality: 0, fangs: 0, swift: 0, greed: 0, aegis: 0, omen: 0 },
  unlocks: [],
  bestDepth: 0,
  bestScore: 0,
  bestLength: 0,
  runs: 0,
  kills: 0,
  deaths: 0,
  totalEssence: 0,
  codex: {},
  seenRelics: {},
  settings: { muted: false, shake: true, showFps: false, critters: true },
  lastSeed: null,
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      branches: { ...DEFAULTS.branches, ...(parsed.branches || {}) },
      settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
      codex: parsed.codex || {},
      seenRelics: parsed.seenRelics || {},
      unlocks: parsed.unlocks || [],
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const meta = {
  data: read(),

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch { /* storage disabled — meta simply won't persist */ }
  },

  get(k) {
    return this.data[k];
  },

  branchLevel(id) {
    return this.data.branches[id] || 0;
  },

  canAfford(cost) {
    return this.data.echoes >= cost;
  },

  buyBranch(id) {
    const b = META_BRANCHES.find((x) => x.id === id);
    if (!b) return false;
    const lvl = this.branchLevel(id);
    if (lvl >= b.max) return false;
    const cost = b.cost(lvl);
    if (!this.canAfford(cost)) return false;
    this.data.echoes -= cost;
    this.data.branches[id] = lvl + 1;
    this.save();
    return true;
  },

  hasUnlock(id) {
    return this.data.unlocks.includes(id);
  },

  buyUnlock(id) {
    const u = UNLOCKS.find((x) => x.id === id);
    if (!u || this.hasUnlock(id)) return false;
    if (!this.canAfford(u.cost)) return false;
    this.data.echoes -= u.cost;
    this.data.unlocks.push(id);
    this.save();
    return true;
  },

  unlockValue(id) {
    const u = UNLOCKS.find((x) => x.id === id);
    return u ? u.value : null;
  },

  startingRelics() {
    const list = ['none'];
    for (const u of UNLOCKS) {
      if (u.branch === 'startingRelic' && this.hasUnlock(u.id)) list.push(u.value);
    }
    return list;
  },

  addEchoes(n) {
    this.data.echoes += Math.max(0, Math.floor(n));
  },

  recordRun(result) {
    const d = this.data;
    d.runs += 1;
    d.kills += result.kills;
    d.totalEssence += result.essence;
    if (!result.won) d.deaths += 1;
    d.bestDepth = Math.max(d.bestDepth, result.depth);
    d.bestScore = Math.max(d.bestScore, result.score);
    d.bestLength = Math.max(d.bestLength, result.length);
    this.save();
  },

  reveal(kind, id) {
    const bag = kind === 'enemy' ? this.data.codex : this.data.seenRelics;
    if (!bag[id]) {
      bag[id] = 1;
      this.save();
    }
  },

  wipe() {
    this.data = structuredClone(DEFAULTS);
    this.save();
  },
};

/** Daily deterministic seed: same for everyone on a given UTC day. */
export function dailySeed(offset = 0) {
  const day = Math.floor(Date.now() / 86400000) + offset;
  let h = 0x9e3779b9 ^ day;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function isDailyUnlocked() {
  return meta.hasUnlock('c_daily');
}
