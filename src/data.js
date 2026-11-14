/* Static content tables: enemies, level-up upgrades, relics. */

export const ENEMIES = {
  crawler: {
    name: '蚀爬者', en: 'Crawler', tex: 'e_crawler', hp: 3, dmg: 1, speed: 1.55, size: 1,
    ai: 'chase', xp: 6, essence: 2, color: 0xff8a4c,
    desc: '闻到你的鳞片气味直线扑来。最常见的猎手。',
  },
  spitter: {
    name: '吐酸者', en: 'Spitter', tex: 'e_spitter', hp: 3, dmg: 1, speed: 0.85, size: 1,
    ai: 'keepaway', xp: 9, essence: 3, color: 0xb98bff, ranged: { cd: 2.1, speed: 5.2, range: 7 },
    desc: '保持距离并吐出腐蚀弹。逼迫你保持移动。',
  },
  bloater: {
    name: '胀爆体', en: 'Bloater', tex: 'e_bloater', hp: 4, dmg: 2, speed: 1.1, size: 1,
    ai: 'chase', xp: 11, essence: 4, color: 0xffd166,
    onDeath: { explode: { radius: 2.2, dmg: 2 } },
    desc: '死亡时剧烈膨胀，炸开一片伤害。',
  },
  wraith: {
    name: '穿墙影', en: 'Wraith', tex: 'e_wraith', hp: 2, dmg: 1, speed: 0.95, size: 1,
    ai: 'chase', phase: true, xp: 8, essence: 3, color: 0x7fd8ff,
    desc: '无视墙壁的幽影。狭窄走廊里无法阻挡它。',
  },
  husk: {
    name: '腐甲巨仆', en: 'Husk', tex: 'e_husk', hp: 9, dmg: 2, speed: 0.8, size: 1,
    ai: 'chase', xp: 22, essence: 9, color: 0xff4d6d,
    onDeath: { healPlayer: 1 },
    desc: '厚重的甲壳，正面硬吃也能撑住。',
  },
  warden: {
    name: '狱卒长', en: 'Warden', tex: 'e_warden', hp: 46, dmg: 2, speed: 0.95, size: 2,
    ai: 'chase', xp: 90, essence: 40, color: 0xff2e63, boss: true,
    ranged: { cd: 1.5, speed: 4.4, spread: 3, range: 9 },
    summons: { every: 6, type: 'crawler', count: 2 },
    desc: '每五层镇守的狱卒。扇形弹幕与召唤援军。',
  },
  devourer: {
    name: '万象之腹', en: 'Devourer', tex: 'e_devourer', hp: 190, dmg: 3, speed: 1.0, size: 2,
    ai: 'chase', xp: 400, essence: 160, color: 0xb14bff, boss: true, final: true,
    ranged: { cd: 1.15, speed: 4.8, spread: 5, range: 12 },
    summons: { every: 8, type: 'bloater', count: 2 },
    onDeath: { healPlayer: 4 },
    desc: '吞噬整条回廊的终末之影。',
  },
};

/* ------------------------------ upgrades ------------------------------ */
/* apply(run, level) mutates the run stats. */
export const UPGRADES = [
  { id: 'fangs', name: '锐齿', icon: '✦', desc: '撕咬伤害 +1', max: 6, apply: (r) => (r.bonus.dmg += 1) },
  { id: 'bulk', name: '鳞甲', icon: '❖', desc: '最大生命 +2 并回复 2', max: 6, apply: (r) => { r.bonus.hp += 2; r.hp = Math.min(r.maxHp(), r.hp + 2); } },
  { id: 'vigor', name: '疾行', icon: '»', desc: '移动速度 +6%', max: 5, apply: (r) => (r.bonus.spd *= 1.06) },
  { id: 'maw', name: '巨颚', icon: '◉', desc: '每移动一格有 8% 概率长 1 节（不吃食物也能变长）', max: 4, apply: (r) => (r.bonus.growth += 0.08) },
  { id: 'mend', name: '愈合', icon: '✚', desc: '每次进食额外回复 1 点生命', max: 4, apply: (r) => (r.bonus.leech += 1) },
  { id: 'lance', name: '缓冲鳞', icon: '◎', desc: '撞墙不再受到伤害', max: 1, apply: (r) => (r.bonus.wallDmg -= 1) },
  { id: 'dash1', name: '突进强化', icon: '⚡', desc: '冲刺距离 +1 格', max: 3, apply: (r) => (r.bonus.dashLen += 1) },
  { id: 'dashcd', name: '相位折叠', icon: '◈', desc: '冲刺冷却 -12%', max: 4, apply: (r) => (r.bonus.dashCd *= 0.88) },
  { id: 'thorns', name: '荆棘鳞', icon: '✻', desc: '受到近战伤害时反弹 2 点', max: 3, apply: (r) => (r.bonus.thorns += 2) },
  { id: 'digest', name: '消化', icon: '☲', desc: '长度的 8% 转化为等量伤害加成（取整）', max: 4, apply: (r) => (r.bonus.digest += 0.08) },
  { id: 'greed', name: '贪婪', icon: '◊', desc: '精华获取 +25%', max: 3, apply: (r) => (r.bonus.essence *= 1.25) },
  { id: 'phase', name: '虚化', icon: '◌', desc: '自撞不再扣生命（仍会缩短身体）', max: 1, apply: (r) => (r.bonus.selfHarm -= 1) },
  { id: 'sight', name: '灵视', icon: '◉', desc: '视野半径 +3', max: 3, apply: (r) => (r.bonus.sight += 3) },
  { id: 'regen', name: '代谢', icon: '⟳', desc: '每 25 步回复 1 点生命', max: 4, apply: (r) => (r.bonus.regen += 1) },
  { id: 'xpnet', name: '汲魂', icon: '✶', desc: '经验获取 +20%', max: 4, apply: (r) => (r.bonus.xp *= 1.2) },
  { id: 'shell', name: '硬壳', icon: '⬢', desc: '获得 1 点护盾，每点抵挡一次伤害', max: 3, apply: (r) => (r.bonus.shield += 1) },
  { id: 'swiftkill', name: '裁决', icon: '☠', desc: '伤害低于敌人剩余生命一半时伤害翻倍', max: 1, apply: (r) => (r.bonus.execute = true) },
  { id: 'chain', name: '连锁', icon: '↯', desc: '击杀时向周围敌人溅射 2 点伤害', max: 2, apply: (r) => (r.bonus.chain += 2) },
  { id: 'loner', name: '孤鳞', icon: '◈', desc: '长度低于 12 时伤害 +2', max: 2, apply: (r) => (r.bonus.loner += 2) },
  { id: 'hoard', name: '拾荒', icon: '⚱', desc: '击杀有 18% 概率掉落食物', max: 3, apply: (r) => (r.bonus.drop += 0.18) },
  { id: 'overgrow', name: '疯长', icon: '❋', desc: '长度上限 +8（长蛇得分更高）', max: 5, apply: (r) => (r.bonus.cap += 8) },
  { id: 'leech2', name: '血契', icon: '❤', desc: '撕咬敌人时回复 1 点生命', max: 3, apply: (r) => (r.bonus.bloodpact += 1) },
  { id: 'crit', name: '要害', icon: '✧', desc: '25% 概率造成 2 倍撕咬伤害', max: 4, apply: (r) => (r.bonus.crit += 0.25) },
  { id: 'echo', name: '残响', icon: '◐', desc: '致命伤害来临时，生命值回到 3 点（每级一次）', max: 2, apply: (r) => (r.bonus.echo += 1) },
];

/* ------------------------------ relics ------------------------------ */
export const RELICS = [
  { id: 'heartstone', name: '心石', icon: '❤', rarity: 1, desc: '进入新层时回复 1 点生命', apply: (r) => (r.flags.healOnFloor = (r.flags.healOnFloor || 0) + 1) },
  { id: 'emberheart', name: '烬心', icon: '✦', rarity: 1, desc: '最大生命 +3', apply: (r) => (r.bonus.hp += 3) },
  { id: 'quickstep', name: '疾行靴', icon: '»', rarity: 1, desc: '移动速度 +10%', apply: (r) => (r.bonus.spd *= 1.1) },
  { id: 'brittle', name: '脆鳞', icon: '◊', rarity: 1, desc: '撕咬伤害 +2，但最大生命 -2', apply: (r) => { r.bonus.dmg += 2; r.bonus.hp -= 2; r.hp = Math.min(r.hp, r.maxHp()); } },
  { id: 'longtail', name: '长尾', icon: '⌇', rarity: 1, desc: '长度上限 +12', apply: (r) => (r.bonus.cap += 12) },
  { id: 'greedstone', name: '聚财石', icon: '◈', rarity: 1, desc: '精华获取 +20%', apply: (r) => (r.bonus.essence *= 1.2) },
  { id: 'darksight', name: '暗视', icon: '◉', rarity: 1, desc: '视野半径 +4', apply: (r) => (r.bonus.sight += 4) },
  { id: 'fangsage', name: '牙仙石', icon: '⌁', rarity: 2, desc: '撕咬伤害 +1，经验 +10%', apply: (r) => { r.bonus.dmg += 1; r.bonus.xp *= 1.1; } },
  { id: 'shieldcore', name: '盾核', icon: '⬢', rarity: 2, desc: '获得时 +1 护盾，此后每 5 层再补 1 点', apply: (r) => { r.bonus.shield += 1; r.flags.shieldPer5 = true; } },
  { id: 'thornmail', name: '棘刺鳞衣', icon: '✻', rarity: 2, desc: '反弹伤害 +3', apply: (r) => (r.bonus.thorns += 3) },
  { id: 'chronoclock', name: '时之沙漏', icon: '◷', rarity: 2, desc: '冲刺冷却 -25%', apply: (r) => (r.bonus.dashCd *= 0.75) },
  { id: 'voidgullet', name: '虚渊之喉', icon: '◍', rarity: 2, desc: '吞噬：击杀回复 1 点生命', apply: (r) => (r.bonus.devour += 1) },
  { id: 'gildedfang', name: '鎏金獠牙', icon: '✵', rarity: 2, desc: '伤害 +1，每次击杀额外获得 2 精华', apply: (r) => { r.bonus.dmg += 1; r.flags.killEssence = (r.flags.killEssence || 0) + 2; } },
  { id: 'mirrorward', name: '镜鳞', icon: '◇', rarity: 2, desc: '受到伤害后 3 秒内免疫', apply: (r) => (r.flags.mirror = true) },
  { id: 'farsight', name: '远眺之瞳', icon: '◉', rarity: 2, desc: '视野半径 +10', apply: (r) => { r.bonus.sight += 7; r.flags.permanentMap = true; } },
  { id: 'bloodmoon', name: '血月石', icon: '☾', rarity: 2, desc: '生命低于 50% 时伤害 +3', apply: (r) => (r.bonus.berserk = (r.bonus.berserk || 0) + 3) },
  { id: 'siphon', name: '汲血符文', icon: '♆', rarity: 3, desc: '每次撕咬回复 1 点生命', apply: (r) => (r.bonus.bloodpact += 1) },
  { id: 'devourermaw', name: '万物之颚', icon: '◈', rarity: 3, desc: '击杀溅射伤害 +4，击杀回复 2 生命', apply: (r) => { r.bonus.chain += 4; r.bonus.devour += 2; } },
  { id: 'ascension', name: '升华之鳞', icon: '✧', rarity: 3, desc: '此后获得的升级有 50% 概率双倍生效', apply: (r) => (r.bonus.ascend = (r.bonus.ascend || 0) + 0.5) },
  { id: 'kingsmandate', name: '王之敕令', icon: '☠', rarity: 3, desc: '伤害 +4，但最大生命 -4', apply: (r) => { r.bonus.dmg += 4; r.bonus.hp -= 4; r.hp = Math.min(r.hp, r.maxHp()); } },
  { id: 'eternalgullet', name: '永恒之腹', icon: '♾', rarity: 3, desc: '移动时缓慢回复生命，且长度不再缩短', apply: (r) => { r.flags.immortal = true; r.bonus.regen += 1; } },
  { id: 'luckcoin', name: '幸运硬币', icon: '✺', rarity: 1, desc: '宝箱品质提升，进食与击杀有时额外获得精华', apply: (r) => { r.bonus.luck += 1; r.flags.coin = true; } },
  { id: 'ruinheart', name: '废墟之心', icon: '❂', rarity: 2, desc: '每深入一层获得 1 点永久伤害加成', apply: (r) => (r.flags.risingPower = true) },
];

export const STARTING_RELICS = {
  none: { id: 'none', name: '无', desc: '不携带任何遗物。纯粹地依靠自己。' },
  ember: { id: 'ember', name: '余烬', icon: '✦', desc: '每深入一层，伤害 +1', apply: (r) => (r.flags.ember = (r.flags.ember || 0) + 1) },
  pearl: { id: 'pearl', name: '珠鳞', icon: '◈', desc: '开局护盾 +1，最大生命 +1', apply: (r) => { r.bonus.shield += 1; r.bonus.hp += 1; } },
  fang: { id: 'fang', name: '幼牙', icon: '⌁', desc: '开局伤害 +1', apply: (r) => (r.bonus.dmg += 1) },
  root: { id: 'root', name: '根须', icon: '⌇', desc: '每层开始时回复 2 点生命', apply: (r) => (r.flags.root = (r.flags.root || 0) + 2) },
  lamp: { id: 'lamp', name: '提灯', icon: '✶', desc: '视野 +4，精华获取 +10%', apply: (r) => { r.bonus.sight += 4; r.bonus.essence *= 1.1; } },
};
