import Phaser from 'phaser';
import {
  TILE, MAP_W, MAP_H, T_STAIR, COLORS, DEPTHS,
} from '../config.js';
import { buildAllTextures } from '../art.js';
import { Dungeon, DIRS } from '../dungeon.js';
import { RNG } from '../rng.js';
import { audio } from '../audio.js';
import * as Run from '../run.js';
import { ENEMIES } from '../data.js';
import { meta } from '../meta.js';
import { ui } from '../ui.js';

const TINT_SEEN = 0x49546e;
const TINT_UNSEEN = 0x000000;
const TINT_VIS = 0xf2f6ff;

const DEPTH_NAMES = [
  '腐锈回廊', '苔痕水牢', '骨窖层', '钟塔底', '狱卒前庭',
  '熔渣矿脉', '静默花园', '镜厅', '破碎圣所', '血月祭坛',
  '无尽之喉', '万象之腹',
];

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  init(data) {
    this.run = data.run;
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.void);
    this.tilesIndex = buildAllTextures(this);
    this.alive = true;
    this.busy = false;
    this.drafting = false;
    this.clock = 0;
    this.realAcc = 0;
    this.fovT = 0;
    this.fieldT = 0;
    this.hitStop = 0;
    this.invuln = 0;
    this.dashT = 0;
    this.dashCd = 0;
    this.dashing = false;
    this.acc = 0;
    this.timers = [];
    this.decors = [];
    this.hpCache = -1;
    this.stepsSinceRegen = 0;

    this.queue = [];
    this.facing = { x: 1, y: 0 };
    this.acc = 0;
    this.body = [];
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];

    this.decorLayer = this.add.container(0, 0).setDepth(1);
    this.itemLayer = this.add.container(0, 0).setDepth(4);
    this.actorLayer = this.add.container(0, 0).setDepth(5);
    this.fxLayer = this.add.container(0, 0).setDepth(8);

    this.setupInput();
    this.enterFloor(1, true);

    this.events.once('shutdown', () => this.tweens.killAll());
  }

  setupInput() {
    const kb = this.input.keyboard;
    kb.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE', 'TAB', 'ESC', 'E', 'M', 'W', 'A', 'S', 'D', 'Q', 'R', 'ONE', 'TWO', 'THREE']);
    const dir = (x, y) => () => this.turn(x, y);
    kb.on('keydown-UP', dir(0, -1));
    kb.on('keydown-W', dir(0, -1));
    kb.on('keydown-DOWN', dir(0, 1));
    kb.on('keydown-S', dir(0, 1));
    kb.on('keydown-LEFT', dir(-1, 0));
    kb.on('keydown-A', dir(-1, 0));
    kb.on('keydown-D', dir(1, 0));
    kb.on('keydown-SPACE', () => this.tryDash());
    kb.on('keydown-E', () => this.interact());
    kb.on('keydown-Q', () => this.blast());
    kb.on('keydown-ESC', () => this.game.events.emit('ui', 'pause'));
    kb.on('keydown-TAB', () => this.game.events.emit('ui', 'codex'));
    kb.on('keydown-M', () => this.game.events.emit('ui', 'mute'));
    this.input.on('pointerdown', (p) => this.steerTo(p.worldX, p.worldY));
  }

  /* ------------------------------ floor ------------------------------ */

  enterFloor(depth, first = false) {
    const run = this.run;
    run.depth = depth;
    run.maxDepth = Math.max(run.maxDepth, depth);
    const rng = new RNG(run.seed + depth * 9176 + 31);
    this.floorRng = rng;
    this.dungeon = new Dungeon().generate(depth, rng);
    this.dungeon.floodFrom(this.dungeon.spawn);

    const n = this.dungeon.w * this.dungeon.h;
    this.visible = new Uint8Array(n);
    this.explored = new Uint8Array(n);
    this.lastTint = new Int32Array(n).fill(-2);

    this.renderFloorTiles();

    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.tweens.killAll();
    this.decorLayer.removeAll(true);
    this.itemLayer.removeAll(true);
    this.actorLayer.removeAll(true);
    this.fxLayer.removeAll(true);

    // snake body rebuilt for the new floor
    const s = this.dungeon.spawn;
    const place = this.placeSnake(run.length);
    this.body = place.body;
    this.facing = place.dir;
    this.queue = [];
    this.acc = 0;
    this.invuln = 1.2;
    this.dashing = false;
    this.dashCd = 0;
    this.lastMoveClock = 0;
    this.buildSnakeSprites();

    this.spawnEnemies(depth, rng);
    this.spawnPickups(depth, rng);
    this.buildDecor(rng);
    this.buildPortal();

    this.light = this.add.image(0, 0, 'glow')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0x5cff9e)
      .setAlpha(0.3)
      .setDepth(2);

    // Per-floor one-shot hints (stair cost / exit open) reset each floor so
    // the cost shown is always the current floor's.
    this.stairHintT = 0;
    this.stairOpenT = false;
    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.dungeon.w * TILE, this.dungeon.h * TILE);
    this.cam.centerOn(s.x * TILE, s.y * TILE);
    this.cam.setZoom(1.14);
    this.cam.startFollow(this.headSprite, true, 0.13, 0.13);

    // per-floor relic effects
    if (run.flags.healOnFloor) run.hp = Math.min(run.hp + run.flags.healOnFloor, Run.maxHp(run));
    if (run.flags.root) run.hp = Math.min(run.hp + run.flags.root, Run.maxHp(run));
    if (run.flags.ember && depth > 1) run.bonus.dmg += run.flags.ember;
    if (run.flags.risingPower) run.bonus.dmg += 1;
    if (run.flags.shieldPer5 && depth % 5 === 0) run.bonus.shield += 1;

    this.recomputeFov();
    this.hpCache = run.hp;
    const name = DEPTH_NAMES[Math.min(depth - 1, DEPTH_NAMES.length - 1)];
    ui.setDepthName(name);
    this.pushHud();
    this.banner(first ? 'OUROBOROS' : `深度 ${depth}`, name, first ? '#7cffb2' : '#7fd8ff');
    audio.configure({ depth, boss: depth % 5 === 0, danger: 0 });
  }

  // Lay the body along whichever axis has enough clear floor, so a run never
  // starts embedded in a wall.
  placeSnake(len) {
    const d = this.dungeon;
    const s = d.spawn;
    let best = { dir: { x: 1, y: 0 }, n: -1 };
    for (const dir of DIRS) {
      let n = 0;
      while (n < len + 2 && d.isWalkable(s.x - dir.x * (n + 1), s.y - dir.y * (n + 1))) n++;
      if (n > best.n) best = { dir, n };
    }
    const dir = best.dir;
    const body = [];
    // body[0] is the tail, body[len-1] is the head pinned to the spawn tile
    for (let i = len - 1; i >= 0; i--) {
      const x = s.x - dir.x * i;
      const y = s.y - dir.y * i;
      body.push(d.isWalkable(x, y) ? { x, y } : { x: s.x, y: s.y });
    }
    return { body, dir };
  }

  renderFloorTiles() {
    const data = [];
    for (let y = 0; y < this.dungeon.h; y++) {
      const row = [];
      for (let x = 0; x < this.dungeon.w; x++) row.push(this.tilesIndex[this.dungeon.at(x, y)] ?? 0);
      data.push(row);
    }
    this.tilemap = this.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
    if (!this.tileset) this.tileset = this.tilemap.addTilesetImage('tiles', 'tiles', TILE, TILE, 0, 0);
    this.layer = this.tilemap.createLayer(0, this.tileset, 0, 0);
    this.layer.setDepth(0);
  }

  buildPortal() {
    const e = this.dungeon.exit;
    this.portalIcon = this.add.image(e.x * TILE + TILE / 2, e.y * TILE + TILE / 2, 'portal')
      .setDepth(3)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.8)
      .setTint(COLORS.accent);
    this.itemLayer.add(this.portalIcon);
  }

  buildSnakeSprites() {
    this.segSprites = this.body.map((seg) => {
      const img = this.add.image(seg.x * TILE, seg.y * TILE, 'snake_body');
      this.actorLayer.add(img);
      return img;
    });
    const h = this.headTile();
    this.headSprite = this.add.image(h.x * TILE, h.y * TILE, 'snake_head').setDepth(6).setScale(1.12);
    this.actorLayer.add(this.headSprite);
    this.updateSnakeVisual();
  }

  updateSnakeVisual() {
    const n = this.body.length;
    // The sprite pool is built once per floor; growing mid-floor (food,
    // 巨颚) used to leave the new tail segments invisible, and shrinking
    // left ghost segments behind. Grow the pool on demand, hide the rest.
    while (this.segSprites.length < n) {
      const img = this.add.image(0, 0, 'snake_body');
      this.actorLayer.add(img);
      this.segSprites.push(img);
    }
    for (let i = n; i < this.segSprites.length; i++) this.segSprites[i].setVisible(false);
    for (let i = 0; i < n; i++) {
      const seg = this.body[n - 1 - i];
      const img = this.segSprites[i];
      if (!img) continue;
      img.setVisible(true);
      img.setPosition(seg.x * TILE, seg.y * TILE);
      const t = i / Math.max(1, n - 1);
      const color = Phaser.Display.Color.HSVToRGB((148 + t * 26) / 360, 0.7, 0.62 - t * 0.2);
      img.setTint(color.color);
      img.setScale(1.04 - t * 0.2);
      img.setDepth(6 - t * 0.8);
    }
    if (this.headSprite) {
      const head = this.body[n - 1];
      this.headSprite.setPosition(head.x * TILE, head.y * TILE);
      this.headSprite.rotation = Math.atan2(this.facing.y, this.facing.x);
      const hurt = this.invuln > 0 && Math.floor(this.clock * 14) % 2 === 0;
      if (hurt) this.headSprite.setTintFill(0xffffff);
      else this.headSprite.setTint(0x86ffbe);
    }
  }

  headTile() {
    return this.body[this.body.length - 1];
  }

  buildDecor(rng) {
    this.decors = [];
    for (let i = 0; i < 46; i++) {
      const p = this.dungeon.randomFloor(rng);
      const img = this.add.image(p.x * TILE + rng.int(-5, 5), p.y * TILE + rng.int(-5, 5), 'rubble_deco');
      img.setAlpha(rng.float(0.2, 0.45))
        .setScale(rng.float(0.6, 1.15))
        .setRotation(rng.float(0, 6.28))
        .setTint(rng.pick([0x33405e, 0x223050, 0x40323a, 0x2a3a44]));
      img.setDepth(0.5);
      this.decorLayer.add(img);
      this.decors.push({ spr: img, x: p.x, y: p.y });
    }
  }

  /* ------------------------------ spawning ------------------------------ */

  spawnEnemies(depth, rng) {
    const d = this.dungeon;
    const budget = Math.floor(4 + depth * 1.5);
    // a warden every fifth floor, and the Devourer on the last one
    const isBoss = depth % 5 === 0 || depth >= DEPTHS;
    const pool = ['crawler', 'crawler', 'wraith'];
    if (depth >= 2) pool.push('spitter');
    if (depth >= 3) pool.push('bloater');
    if (depth >= 5) pool.push('husk');
    const weights = pool.map((id) => ({ id, w: id === 'husk' ? 1.4 + depth * 0.12 : 4 }));

    const used = [this.headTile(), d.exit];
    let placed = 0;
    let guard = 0;
    while (placed < budget && guard++ < 500) {
      const id = rng.weighted(weights).id;
      const p = d.randomFloor(rng, used, 12, 7);
      if (used.some((u) => u.x === p.x && u.y === p.y)) continue;
      if (this.enemyAt(p.x, p.y) || this.isOccupied(p.x, p.y)) continue;
      const scaleHp = 1 + (depth - 1) * 0.12;
      this.makeEnemy(ENEMIES[id], p.x, p.y, Math.max(1, Math.round(ENEMIES[id].hp * scaleHp)), depth);
      used.push(p);
      placed++;
    }
    if (isBoss) {
      const def = depth >= DEPTHS ? ENEMIES.devourer : ENEMIES.warden;
      const p = d.bossPos || d.exit;
      this.makeEnemy(def, p.x, p.y, def.hp + Math.floor(depth * 1.8), depth);
      this.after(0.45, () => {
        audio.sfx('boss');
        this.shake(16, 600);
        this.banner('BOSS', def.name, '#ff4d6d');
      });
    }
  }

  makeEnemy(def, x, y, hp, depth) {
    const spr = this.add.image(x * TILE, y * TILE, def.tex).setDepth(5.5);
    this.actorLayer.add(spr);
    const e = {
      def, x, y, hp, maxHp: hp, spr,
      acc: Math.random() * 0.6, flash: 0,
      lastShot: 0.8 + Math.random() * 2, summonT: def.summons ? def.summons.every : 0,
      wob: Math.random() * 6.28, depth,
    };
    this.enemies.push(e);
    meta.reveal('enemy', def.en);
    return e;
  }

  spawnPickups(depth, rng) {
    const used = [this.headTile()];
    for (let i = 0; i < 3 + Math.floor(depth * 0.6); i++) {
      const p = this.dungeon.randomFloor(rng, used, 2, 1);
      this.addPickup('food', p.x, p.y);
    }
    for (let i = 0; i < 2 + Math.floor(depth * 0.5); i++) {
      const p = this.dungeon.randomFloor(rng, used, 2, 1);
      this.addPickup('shard', p.x, p.y);
    }
    if (rng.chance(0.55)) {
      const p = this.dungeon.randomFloor(rng, used, 5, 3);
      this.addPickup('heart', p.x, p.y);
    }
    if (depth >= 2 && rng.chance(0.4 + depth * 0.02)) {
      const p = this.dungeon.randomFloor(rng, used, 8, 5);
      this.addPickup('chest', p.x, p.y);
    }
    if (depth >= 4 && rng.chance(0.35)) {
      const p = this.dungeon.randomFloor(rng, used, 6, 4);
      this.addPickup('bomb', p.x, p.y);
    }
  }

  addPickup(type, x, y) {    const texMap = { food: 'food', shard: 'shard', heart: 'heart', chest: 'chest', relic: 'pedestal', bomb: 'bolt' };
    const tintMap = { food: 0xff5c7a, shard: 0x6ee7ff, heart: 0xff4d6d, chest: 0xffd166, relic: 0xffd166, bomb: 0xfff1a8 };
    const spr = this.add.image(x * TILE, y * TILE, texMap[type]).setDepth(4.4).setTint(tintMap[type]);
    this.itemLayer.add(spr);
    const p = { type, x, y, spr, bob: Math.random() * 6.28 };
    this.pickups.push(p);
    this.tweens.add({ targets: spr, y: spr.y - 4, duration: 850, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    return p;
  }

  /* ------------------------------ queries ------------------------------ */

  enemyAt(x, y) {
    return this.enemies.find((e) => e.hp > 0 && e.x === x && e.y === y);
  }

  isOccupied(x, y) {
    return this.pickups.some((p) => p.x === x && p.y === y);
  }

  pickupAt(x, y) {
    return this.pickups.find((p) => p.x === x && p.y === y);
  }

  removePickup(p) {
    const i = this.pickups.indexOf(p);
    if (i === -1) return;
    this.pickups.splice(i, 1);
    this.tweens.killTweensOf(p.spr);
    this.itemLayer.remove(p.spr);
    p.spr.destroy();
  }

  /* ------------------------------ input ------------------------------ */

  /* Turn input is buffered, never dropped.
   *
   * A snake may only turn at a tile boundary, so a key press has to wait for
   * the next step. The rule that makes that wait feel instant:
   *
   *   - duplicate of the pending turn      -> ignored
   *   - 180° off the pending turn          -> REPLACES the pending turn
   *     (this is the "I changed my mind" case; treating it as an illegal
   *      reversal and swallowing it is what makes steering feel broken)
   *   - anything else                       -> queued as a second turn,
   *     or overwrites the last slot so a burst of input always resolves to
   *     the newest intent
   */
  turn(x, y) {
    if (this.busy || !this.alive) return;
    const d = { x, y };
    const last = this.queue.length ? this.queue[this.queue.length - 1] : this.facing;
    if (last.x === d.x && last.y === d.y) return;          // already going there
    if (last.x === -d.x && last.y === -d.y) {              // correction, not a reversal
      if (this.queue.length) this.queue[this.queue.length - 1] = d;
      return;                                              // nothing pending ⇒真·掉头, illegal
    }
    if (this.queue.length < 2) this.queue.push(d);
    else this.queue[this.queue.length - 1] = d;           // newest intent wins
    audio.sfx('ui');
    this.onTurnIntent?.(d);
  }

  // A turn that is queued while the head is already at a wall must survive the
  // bounce — only the turn that would re-enter the wall itself is discarded.
  pruneIntoWall() {
    const h = this.headTile();
    this.queue = this.queue.filter((d) => this.dungeon.isWalkable(h.x + d.x, h.y + d.y));
  }

  steerTo(wx, wy) {
    const h = this.headTile();
    const dx = Math.round(wx / TILE) - h.x;
    const dy = Math.round(wy / TILE) - h.y;
    if (Math.abs(dx) > Math.abs(dy)) this.turn(Math.sign(dx), 0);
    else this.turn(0, Math.sign(dy));
  }

  tryDash() {
    if (this.busy || !this.alive || this.dashing || this.dashCd > 0) return;
    const dir = this.queue.length ? this.queue[0] : this.facing;
    this.setFacing(dir);
    if (this.queue.length === 1) this.queue.shift();
    this.dashing = true;
    this.dashT = 0.22;
    this.dashAcc = 0;
    this.invuln = Math.max(this.invuln, 0.3);
    audio.sfx('dash');
    const h = this.headTile();
    this.ringAt(h.x, h.y, 0x7cffb2, TILE * 1.6);
  }

  setFacing(d) {
    this.facing = { x: d.x, y: d.y };
    if (this.headSprite) this.headSprite.rotation = Math.atan2(d.y, d.x);
  }

  interact() {
    if (!this.alive || this.busy) return;
    const h = this.headTile();
    if (this.pickupAt(h.x, h.y)) return;
    const d = this.dungeon;
    if (h.x !== d.exit.x || h.y !== d.exit.y) return;
    const remaining = this.enemies.filter((e) => e.hp > 0).length;
    if (remaining === 0) {
      this.descend();
      return;
    }
    const cost = 30 + remaining * 8;
    if (this.run.essence >= cost) {
      this.run.essence -= cost;
      this.floatAt(h.x, h.y, `-${cost} 精华`, COLORS.gold);
      this.descend();
    } else {
      this.floatAt(h.x, h.y, `突破需 ${cost} 精华`, COLORS.danger);
      audio.sfx('deny');
    }
  }

  blast() {
    if (this.busy || !this.alive) return;
    const h = this.headTile();
    if (this.run.essence < 25) {
      audio.sfx('deny');
      this.floatAt(h.x, h.y, '需要 25 精华', COLORS.dim);
      return;
    }
    this.blastAt(h.x, h.y, 0x7fd8ff);
  }

  blastAt(x, y, color) {
    const run = this.run;
    run.essence -= 25;
    audio.sfx('explode');
    this.shake(11, 340);
    this.ringAt(x, y, color, TILE * 3.6);
    this.burst(x, y, color, 24);
    for (const e of [...this.enemies]) {
      if (Math.abs(e.x - x) + Math.abs(e.y - y) <= 3) this.damageEnemy(e, 6, { silent: true });
    }
  }

  descend() {
    audio.sfx('portal');
    this.busy = true;
    this.cameras.main.fadeOut(340, 0, 0, 0);
    this.after(0.36, () => {
      this.cameras.main.fadeIn(340, 0, 0, 0);
      const next = this.run.depth + 1;
      if (next > DEPTHS) {
        this.alive = false;
        this.busy = true;
        this.game.events.emit('run:end', { won: true });
        return;
      }
      this.enterFloor(next);
      this.busy = false;
    });
  }

  /* ------------------------------ main loop ------------------------------ */

  // Fixed-timestep driver: the simulation advances in 1/60s slices so a slow
  // frame rate slows the *rendering*, never the game speed.
  update(t, dtms) {
    if (!this.alive) return;
    this.realAcc = (this.realAcc || 0) + Math.min(dtms, 250) / 1000;
    const FIXED = 1 / 60;
    let guard = 0;
    while (this.realAcc >= FIXED && guard++ < 10) {
      this.realAcc -= FIXED;
      this.tick(FIXED);
      if (!this.alive) break;
    }
  }

  // Small deterministic timer queue (replaces Phaser's Clock so the whole
  // simulation — including delayed transitions — is driven by the fixed step).
  after(seconds, fn) {
    this.timers = this.timers || [];
    this.timers.push({ at: this.clock + seconds, fn });
  }

  runTimers() {
    if (!this.timers || !this.timers.length) return;
    const due = this.timers.filter((t) => t.at <= this.clock);
    if (!due.length) return;
    this.timers = this.timers.filter((t) => t.at > this.clock);
    for (const t of due) t.fn();
  }

  tick(dt) {
    this.clock += dt;
    this.runTimers();
    if (this.drafting) {
      this.pushHud();
      return;
    }

    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }

    this.dashCd = Math.max(0, this.dashCd - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.hpCache !== this.run.hp) {
      this.hpCache = this.run.hp;
      this.pushHud();
    }

    if (this.dashing) {
      this.dashT -= dt;
      this.dashAcc += (dt / 0.22) * Run.dashLength(this.run);
      let guard = 0;
      while (this.dashAcc >= 1 && guard++ < 4 && this.alive) {
        this.dashAcc -= 1;
        this.step(true);
      }
      if (this.dashT <= 0 || !this.alive) {
        this.dashing = false;
        this.dashCd = Run.dashCooldown(this.run);
        this.pushHud();
      }
    } else {
      this.acc += dt * Run.speed(this.run);
      let guard = 0;
      while (this.acc >= 1 && guard++ < 4 && this.alive) {
        this.acc -= 1;
        this.step(false);
      }
      this.acc = Math.min(this.acc, 1.5);
    }

    if (!this.alive) return;

    if (this.clock - (this.lastMoveClock ?? 0) > 1.1 && !this.busy) this.desperationReverse();

    this.updateEnemies(dt);
    this.updateProjectiles(dt);

    this.fieldT -= dt;
    if (this.fieldT <= 0) {
      this.fieldT = 0.4;
      this.dungeon.floodFrom(this.headTile());
    }
    this.fovT -= dt;
    if (this.fovT <= 0) {
      this.fovT = 0.07;
      this.recomputeFov();
      this.updateFx(dt);
    }
    this.pushHud();
  }

  step(fromDash) {
    const run = this.run;
    const d = this.dungeon;
    if (this.queue.length) this.setFacing(this.queue.shift());
    const dir = this.facing;
    const h = this.headTile();
    const nx = h.x + dir.x;
    const ny = h.y + dir.y;
    run.steps += 1;
    this.stepsSinceRegen += 1;

    let growing = run.length < Run.cap(run);
    if (growing && run.bonus.growth > 0 && this.floorRng.chance(run.bonus.growth)) run.growth += 1;
    // Pending growth from 巨颚 converts immediately; without this it only
    // materialised on the next food pickup, contradicting its description.
    if (run.growth > 0) Run.grow(run, 0);

    if (!d.isWalkable(nx, ny)) {
      this.solidHit(nx, ny);
      return;
    }

    let selfHit = false;
    const first = growing ? 0 : 1;   // index 0 vacates on the same step
    for (let i = first; i < this.body.length; i++) {
      if (this.body[i].x === nx && this.body[i].y === ny) {
        selfHit = true;
        break;
      }
    }

    this.body.push({ x: nx, y: ny });
    while (this.body.length > run.length) this.body.shift();
    this.updateSnakeVisual();

    this.lastMoveClock = this.clock;
    if (selfHit) this.selfHit(nx, ny);
    this.consumePickup(nx, ny);
    if (this.enemyAt(nx, ny)) this.headBump(nx, ny, fromDash);
    if (nx === d.exit.x && ny === d.exit.y) this.onStairs();
    this.regenTick();
    if (this.body.length < 2) this.body.push({ ...h });
  }

  // Running into stone stops you dead. You keep the tile you were on, so you
  // can always turn — and if you never do, a desperation reversal kicks in.
  solidHit(nx, ny) {
    const run = this.run;
    this.shake(6, 180);
    audio.sfx('hurt');
    this.burst(nx, ny, 0x9fb0c8, 7);
    // 缓冲鳞 makes wallDmg negative; a zero-or-less hit still stumbles you
    // (shake + sound above) but no longer costs HP.
    const wallDmg = 1 + run.bonus.wallDmg;
    if (wallDmg > 0) this.hurt(wallDmg, 'wall');
    this.pruneIntoWall();
    this.acc = 0.15;          // a short stumble, not a lock-up
  }

  // Fired when the head has been pinned for too long: guarantees a player who
  // is trapped in a dead end can always escape.
  desperationReverse() {
    this.lastMoveClock = this.clock;
    this.reverse();
    this.pruneIntoWall();
    this.hurt(1, 'self');
    this.floatAt(this.headTile().x, this.headTile().y, '强行转身', 0xff9f6d, 16);
  }

  // Crossing your own scales burns HP and forces you to digest part of the
  // body, but you keep moving — length is a resource, not a prison.
  selfHit(nx, ny) {
    const run = this.run;
    this.shake(9, 260);
    audio.sfx('hurt');
    this.burst(nx, ny, 0xff4d6d, 12);
    if (!run.flags.immortal) {
      const loss = Math.max(3, Math.floor(run.length * 0.2));
      run.length = Math.max(3, run.length - loss);
      run.growth = 0;
      this.trimBody();
    }
    // 虚化 drops selfHarm to 0; hurt() clamps to >=1, so skip the call
    // entirely instead of asking it to deal 0 damage.
    const selfDmg = Math.max(0, run.bonus.selfHarm);
    if (selfDmg > 0) this.hurt(selfDmg, 'self');
  }

  trimBody() {
    while (this.body.length > this.run.length) this.body.shift();
    if (this.body.length < 3) {
      const h = this.headTile();
      while (this.body.length < 3) this.body.push({ x: h.x, y: h.y });
    }
    this.updateSnakeVisual();
  }

  reverse() {
    const nx = -this.facing.x;
    const ny = -this.facing.y;
    this.queue = this.queue.filter((d) => !(d.x === nx && d.y === ny));
    this.facing = { x: nx, y: ny };
    this.setFacing(this.facing);
  }

  /* ------------------------------ combat ------------------------------ */

  consumePickup(x, y) {
    const p = this.pickupAt(x, y);
    if (!p) return;
    const run = this.run;
    switch (p.type) {
      case 'food': {
        Run.grow(run, 1);
        // 愈合: every level heals +1 per meal (the old code healed 1 at best
        // and only on a coin flip at level 1, so levels 2-4 did nothing).
        if (run.bonus.leech > 0) run.hp = Math.min(Run.maxHp(run), run.hp + run.bonus.leech);
        this.burst(x, y, 0xff5c7a, 12);
        audio.sfx('eat');
        this.floatAt(x, y, '+1 节', 0xff8a4c, 14);
        if (run.flags.coin && this.floorRng.chance(0.25)) Run.addEssence(run, 3);
        break;
      }
      case 'shard': {
        const gain = Math.round((5 + run.depth * 1.6) * run.bonus.xp);
        const levels = Run.addXp(run, gain);
        this.burst(x, y, 0x6ee7ff, 11);
        audio.sfx('xp');
        this.floatAt(x, y, `+${gain} XP`, 0x6ee7ff, 14);
        this.removePickup(p);
        if (levels.length) this.levelUp(levels);
        return;
      }
      case 'heart': {
        run.hp = Math.min(Run.maxHp(run), run.hp + 2);
        this.burst(x, y, 0xff4d6d, 12);
        audio.sfx('pickup');
        this.floatAt(x, y, '+2 HP', 0xff4d6d, 14);
        break;
      }
      case 'bomb': {
        this.removePickup(p);
        this.blastAt(x, y, 0xfff1a8);
        return;
      }
      case 'chest':
      case 'relic': {
        this.openChest(p);
        return;
      }
      default:
        break;
    }
    this.removePickup(p);
  }

  headBump(x, y, fromDash) {
    const e = this.enemyAt(x, y);
    if (!e) return;
    const run = this.run;
    if (fromDash) {
      this.damageEnemy(e, 999, { crush: true });
      this.burst(x, y, 0xffffff, 18);
      this.shake(6, 160);
      return;
    }
    this.damageEnemy(e, Run.biteDamage(run), { bite: true });
    if (e.hp > 0) {
      // enemy survives the exchange — you are pushed back
      this.hurt(e.def.dmg, 'enemy');
      if (this.alive) this.recoil();
    }
  }

  // Bounced off a creature that fought back: step the head back to safety
  // without leaving a duplicate segment behind.
  recoil() {
    if (this.body.length < 2) return;
    this.body.pop();
    const prev = this.body[this.body.length - 1];
    this.body.push({ x: prev.x, y: prev.y });
    while (this.body.length > this.run.length) this.body.shift();
    this.updateSnakeVisual();
  }

  damageEnemy(e, amount, opts = {}) {
    if (!e || e.hp <= 0) return;
    if (!opts.silent && !opts.crush) audio.sfx('chomp');
    const run = this.run;
    let dmg = amount;
    if (opts.bite) {
      if (run.bonus.crit && this.floorRng.chance(run.bonus.crit)) dmg *= 2;
      if (run.bonus.execute && dmg < e.hp * 0.5) dmg *= 2;
    }
    e.hp -= dmg;
    e.flash = 0.13;
    if (!opts.silent) this.floatAt(e.x, e.y, `-${dmg}`, 0xffe08a, 15);
    if (e.hp <= 0) {
      this.killEnemy(e);
    } else if (opts.bite && run.bonus.bloodpact) {
      run.hp = Math.min(Run.maxHp(run), run.hp + run.bonus.bloodpact);
    }
  }

  killEnemy(e) {
    const run = this.run;
    const i = this.enemies.indexOf(e);
    if (i !== -1) this.enemies.splice(i, 1);
    this.actorLayer.remove(e.spr);
    e.spr.destroy();
    run.kills += 1;
    this.burst(e.x, e.y, e.def.color, e.def.boss ? 60 : 18);
    this.shake(e.def.boss ? 18 : 4, e.def.boss ? 800 : 120);
    audio.sfx(e.def.boss ? 'die' : 'chomp');

    const xp = Math.round(e.def.xp * (1 + (run.depth - 1) * 0.07));
    const levels = Run.addXp(run, xp);
    Run.addEssence(run, e.def.essence);
    if (run.flags.killEssence) Run.addEssence(run, run.flags.killEssence);
    if (run.bonus.devour) run.hp = Math.min(Run.maxHp(run), run.hp + run.bonus.devour);
    if (e.def.onDeath && e.def.onDeath.healPlayer) run.hp = Math.min(Run.maxHp(run), run.hp + e.def.onDeath.healPlayer);
    if (e.def.onDeath && e.def.onDeath.explode) {
      this.ringAt(e.x, e.y, 0xffd166, TILE * e.def.onDeath.explode.radius * 1.6);
      this.burst(e.x, e.y, 0xffd166, 26);
      audio.sfx('explode');
      this.shake(10, 360);
      const h = this.headTile();
      if (Math.abs(h.x - e.x) + Math.abs(h.y - e.y) <= e.def.onDeath.explode.radius * 1.5) {
        this.hurt(e.def.onDeath.explode.dmg, 'explosion');
      }
    }
    if (run.bonus.chain) {
      for (const o of [...this.enemies]) {
        if (Math.abs(o.x - e.x) + Math.abs(o.y - e.y) <= 2) this.damageEnemy(o, run.bonus.chain, { silent: true });
      }
    }
    if (run.bonus.drop && this.floorRng.chance(run.bonus.drop)) this.addPickup('food', e.x, e.y);
    if (run.flags.coin && this.floorRng.chance(0.15)) Run.addEssence(run, 5);
    meta.reveal('enemy', e.def.en);
    this.floatAt(e.x, e.y, `+${xp}`, COLORS.accent, 14);
    if (levels.length) this.levelUp(levels);
    if (e.def.boss) this.onBossDead(e);
  }

  onBossDead(e) {
    this.banner('BOSS 已被击败', e.def.name, COLORS.gold);
    for (let i = 0; i < 3; i++) {
      const p = this.dungeon.randomFloor(this.floorRng, [this.headTile()], 2, 1);
      this.addPickup(i === 0 ? 'chest' : i === 1 ? 'relic' : 'heart', p.x, p.y);
    }
  }

  hurt(amount, source) {
    const run = this.run;
    if (this.invuln > 0) return;
    const dmg = Math.max(1, Math.round(amount));

    if (run.bonus.echo > 0 && run.hp - dmg <= 0) {
      run.bonus.echo -= 1;
      run.hp = 3;
      this.invuln = 1.4;
      audio.sfx('level');
      const h = this.headTile();
      this.burst(h.x, h.y, 0xffffff, 34);
      this.floatAt(h.x, h.y, '残响', 0xffffff, 22);
      this.pushHud();
      return;
    }
    if (run.bonus.shield > 0) {
      run.bonus.shield -= 1;
      audio.sfx('pickup');
      const h = this.headTile();
      this.burst(h.x, h.y, 0x7fd8ff, 16);
      this.floatAt(h.x, h.y, '格挡', 0x7fd8ff, 18);
      this.pushHud();
      return;
    }
    run.hp -= dmg;
    // 镜鳞: 3 seconds of immunity after taking a hit (default 0.6s).
    this.invuln = run.flags.mirror ? 3 : 0.6;
    // 荆棘鳞 / 棘刺鳞衣: melee hits reflect damage to adjacent enemies.
    if (source === 'enemy' && run.bonus.thorns > 0) {
      const h = this.headTile();
      for (const e of [...this.enemies]) {
        if (e.hp > 0 && Math.abs(e.x - h.x) + Math.abs(e.y - h.y) <= 1) {
          this.damageEnemy(e, run.bonus.thorns, { silent: true });
        }
      }
      this.floatAt(h.x, h.y, `反弹 ${run.bonus.thorns}`, 0x7cffb2, 15);
    }
    this.hitStop = 0.07;
    this.shake(11, 320);
    this.cameras.main.flash(90, 90, 12, 22);
    audio.sfx('hurt');
    const h = this.headTile();
    this.burst(h.x, h.y, 0xff4d6d, 16);
    this.floatAt(h.x, h.y, `-${dmg}`, 0xff4d6d, 20);
    this.pushHud();
    if (run.hp <= 0) this.die();
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    audio.stopMusic(0.9);
    audio.sfx('die');
    this.shake(20, 1000);
    const h = this.headTile();
    for (let i = 0; i < 7; i++) {
      this.after(i * 0.1, () => this.burst(h.x, h.y, i % 2 ? 0x7cffb2 : 0xff4d6d, 22));
    }
    this.after(1.2, () => this.game.events.emit('run:end', { won: false }));
  }

  regenTick() {
    const run = this.run;
    if (!run.bonus.regen) return;
    if (this.stepsSinceRegen < 25) return;
    this.stepsSinceRegen = 0;
    if (run.hp < Run.maxHp(run)) {
      run.hp = Math.min(Run.maxHp(run), run.hp + run.bonus.regen);
      this.floatAt(this.headTile().x, this.headTile().y, `+${run.bonus.regen} HP`, 0x7cffb2, 14);
    }
  }

  /* ------------------------------ relics / stairs ------------------------------ */

  onStairs() {
    const remaining = this.enemies.filter((e) => e.hp > 0).length;
    if (remaining > 0 && !this.stairHintT) {
      this.stairHintT = this.clock + 2.5;
      const cost = 30 + remaining * 8;
      this.floatAt(this.dungeon.exit.x, this.dungeon.exit.y, `清空敌人才可离开，或按 E 花 ${cost} 精华突破`, COLORS.danger, 14);
    }
    if (remaining === 0 && !this.stairOpenT) {
      this.stairOpenT = true;
      this.floatAt(this.dungeon.exit.x, this.dungeon.exit.y, '出口已开启', COLORS.accent, 20);
      audio.sfx('pickup');
    }
  }

  openChest(p) {
    const run = this.run;
    this.removePickup(p);
    audio.sfx('relic');
    const boost = this.floorRng.chance(0.12 * (1 + run.bonus.luck * 0.5));
    const minR = p.type === 'relic' ? 2 : run.depth >= 7 ? 2 : 1;
    const rarityFloor = Math.min(3, minR + (boost ? 1 : 0));
    const relic = Run.randomRelic(run, this.floorRng, rarityFloor);
    const levels = Run.addXp(run, 8 + run.depth * 2);
    Run.addEssence(run, 10 + run.depth * 3);
    this.ringAt(p.x, p.y, 0xffd166, TILE * 2.8);
    this.burst(p.x, p.y, 0xffd166, 26);
    if (relic) {
      Run.addRelic(run, relic);
      meta.reveal('relic', relic.id);
      this.banner(`遗物：${relic.name}`, relic.desc, '#ffd166');
      this.floatAt(p.x, p.y, relic.icon || '◆', 0xffd166, 40);
    } else {
      this.floatAt(p.x, p.y, '空箱子', COLORS.dim, 16);
    }
    if (levels.length) this.levelUp(levels);
  }

  levelUp(levels) {
    audio.sfx('level');
    const h = this.headTile();
    for (const l of levels) this.floatAt(h.x, h.y, `LEVEL ${l}`, COLORS.gold, 30);
    this.ringAt(h.x, h.y, 0xffd166, TILE * 3);
    this.busy = true;
    this.drafting = true;
    this.game.events.emit('levelup', { levels, run: this.run, options: Run.offerUpgrades(this.run, 3) });
  }

  chooseUpgrade(up) {
    Run.takeUpgrade(this.run, up);
    this.run.hp = Math.min(this.run.hp, Run.maxHp(this.run));
    audio.sfx('uiok');
    this.busy = false;
    this.drafting = false;
    this.invuln = Math.max(this.invuln, 0.8);
    this.trimBody();
    this.pushHud();
    this.floatAt(this.headTile().x, this.headTile().y, up.name, COLORS.accent, 24);
  }

  /* ------------------------------ enemies ------------------------------ */

  updateEnemies(dt) {
    const h = this.headTile();
    for (const e of [...this.enemies]) {
      if (e.hp <= 0) continue;
      e.wob += dt * 3;
      if (e.flash > 0) {
        e.flash -= dt;
        e.spr.setTintFill(0xffffff);
        if (e.flash <= 0) e.spr.clearTint();
      }
      if (e.def.ranged) {
        e.lastShot -= dt;
        if (e.lastShot <= 0) {
          e.lastShot = e.def.ranged.cd;
          if (this.hasLineOfSight(e, h)) this.enemyShoot(e, h);
        }
      }
      if (e.def.summons) {
        e.summonT -= dt;
        if (e.summonT <= 0) {
          e.summonT = e.def.summons.every;
          for (let i = 0; i < e.def.summons.count; i++) {
            const p = this.dungeon.randomFloor(this.floorRng, [e], 2, 1);
            const t = ENEMIES[e.def.summons.type];
            this.makeEnemy(t, p.x, p.y, t.hp, e.depth);
            this.ringAt(p.x, p.y, 0xb98bff, TILE * 1.8);
          }
          this.floatAt(e.x, e.y, '召唤', 0xb98bff, 18);
        }
      }
      e.acc += dt * e.def.speed;
      let guard = 0;
      while (e.acc >= 1 && guard++ < 3) {
        e.acc -= 1;
        this.enemyStep(e, h);
      }
      e.spr.setPosition(e.x * TILE, e.y * TILE);
    }
  }

  enemyStep(e, h) {
    const d = this.dungeon;
    const dist = Math.abs(e.x - h.x) + Math.abs(e.y - h.y);
    let options = e.def.ai === 'keepaway' && dist <= 3
      ? this.stepsAway(e, h)
      : this.stepsToward(e, h);
    if (!options || !options.length) {
      options = DIRS.filter((dd) => (e.def.phase || d.isWalkable(e.x + dd.x, e.y + dd.y)));
      if (!options.length) return;
    }
    const free = options.filter((dd) => !this.enemyAt(e.x + dd.x, e.y + dd.y));
    const pool = free.length ? free : options;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const nx = e.x + pick.x;
    const ny = e.y + pick.y;
    if (!e.def.phase && !d.isWalkable(nx, ny)) return;
    if (nx === h.x && ny === h.y) {
      // caught: the enemy lands a hit but cannot occupy the head tile
      this.hurt(e.def.dmg, 'enemy');
      return;
    }
    e.x = nx;
    e.y = ny;
  }

  stepsToward(e, h) {
    const d = this.dungeon;
    const here = d.distanceTo(e.x, e.y);
    const out = [];
    for (const dd of DIRS) {
      const nx = e.x + dd.x, ny = e.y + dd.y;
      if (!(e.def.phase || d.isWalkable(nx, ny))) continue;
      const nd = d.distanceTo(nx, ny);
      if (here < 0 || nd < here) out.push(dd);
      else if (Math.random() < 0.1) out.push(dd);
    }
    return out;
  }

  stepsAway(e, h) {
    const d = this.dungeon;
    const here = d.distanceTo(e.x, e.y);
    const out = [];
    for (const dd of DIRS) {
      const nx = e.x + dd.x, ny = e.y + dd.y;
      if (!d.isWalkable(nx, ny)) continue;
      if (here < 0 || d.distanceTo(nx, ny) > here) out.push(dd);
    }
    return out;
  }

  hasLineOfSight(e, h) {
    let x0 = e.x, y0 = e.y;
    const x1 = h.x, y1 = h.y;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let guard = 0;
    while (guard++ < 220) {
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
      if (x0 === x1 && y0 === y1) return true;
      if (!this.dungeon.isWalkable(x0, y0)) return false;
    }
    return false;
  }

  enemyShoot(e, h) {
    const dx = h.x - e.x, dy = h.y - e.y;
    const base = Math.atan2(dy, dx);
    const spread = e.def.ranged.spread || 0;
    const n = spread || 1;
    for (let i = 0; i < n; i++) {
      const a = base + (n > 1 ? (i / (n - 1) - 0.5) * 0.72 : 0);
      this.spawnBolt(e.x, e.y, Math.cos(a) * e.def.ranged.speed, Math.sin(a) * e.def.ranged.speed, e.def.dmg, e.def.color);
    }
    audio.sfx('shoot');
  }

  spawnBolt(x, y, vx, vy, dmg, color) {
    const spr = this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, 'bolt')
      .setDepth(6.5).setTint(color).setBlendMode(Phaser.BlendModes.ADD).setScale(1.4);
    this.actorLayer.add(spr);
    this.projectiles.push({ x, y, vx, vy, dmg, spr, life: 4 });
  }

  updateProjectiles(dt) {
    for (const p of [...this.projectiles]) {
      p.life -= dt;
      let dead = false;
      const sub = 3;
      for (let s = 0; s < sub && !dead; s++) {
        p.x += (p.vx * dt) / sub;
        p.y += (p.vy * dt) / sub;
        const tx = Math.floor(p.x);
        const ty = Math.floor(p.y);
        if (p.life <= 0 || !this.dungeon.inBounds(tx, ty) || !this.dungeon.isWalkable(tx, ty)) {
          this.burst(tx, ty, p.spr.tintTopLeft, 4);
          dead = true;
        } else {
          const h = this.headTile();
          if (tx === h.x && ty === h.y) {
            this.hurt(p.dmg, 'bolt');
            dead = true;
          }
        }
      }
      if (dead) this.killBolt(p);
      else p.spr.setPosition(p.x * TILE, p.y * TILE);
    }
  }

  killBolt(p) {
    const i = this.projectiles.indexOf(p);
    if (i !== -1) this.projectiles.splice(i, 1);
    this.actorLayer.remove(p.spr);
    p.spr.destroy();
  }

  /* ------------------------------ FOV ------------------------------ */

  recomputeFov() {
    if (!this.dungeon) return;
    const d = this.dungeon;
    this.visible.fill(0);
    const h = this.headTile();
    const radius = Run.sightRadius(this.run) + (this.run.flags.permanentMap ? 3 : 0);
    const rays = 480;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      const dx = Math.cos(a), dy = Math.sin(a);
      for (let r = 0.5; r <= radius; r += 0.3) {
        const x = Math.floor(h.x + dx * r);
        const y = Math.floor(h.y + dy * r);
        if (!d.inBounds(x, y)) break;
        const idx = d.idx(x, y);
        this.visible[idx] = 1;
        this.explored[idx] = 1;
        if (!d.isWalkable(x, y)) break;
      }
    }
    this.applyFovTints();
    this.applyEntityVisibility();
    if (this.light && this.headSprite) {
      this.light.setPosition(this.headSprite.x, this.headSprite.y);
      this.light.setScale((radius * TILE) / 64 * 1.2);
      this.light.setAlpha(this.invuln > 0 ? 0.2 : 0.3);
    }
  }

  applyFovTints() {
    if (!this.layer) return;
    const d = this.dungeon;
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        const idx = d.idx(x, y);
        const tint = this.visible[idx] ? TINT_VIS : this.explored[idx] ? TINT_SEEN : TINT_UNSEEN;
        if (this.lastTint[idx] === tint) continue;
        this.lastTint[idx] = tint;
        const tile = this.layer.getTileAt(x, y);
        if (tile) tile.tint = tint;
      }
    }
  }

  applyEntityVisibility() {
    const d = this.dungeon;
    const seen = (x, y) => d.inBounds(x, y) && this.visible[d.idx(x, y)] === 1;
    for (const e of this.enemies) {
      e.spr.setVisible(seen(e.x, e.y));
      if (e.def.phase) e.spr.setAlpha(this.visible[d.idx(e.x, e.y)] ? 0.6 : 1);
    }
    for (const p of this.pickups) p.spr.setVisible(seen(p.x, p.y));
    for (const p of this.projectiles) p.spr.setVisible(seen(Math.floor(p.x), Math.floor(p.y)));
    for (const dec of this.decors) dec.spr.setVisible(seen(dec.x, dec.y));
    if (this.portalIcon) this.portalIcon.setVisible(seen(d.exit.x, d.exit.y));
  }

  /* ------------------------------ fx ------------------------------ */

  burst(x, y, color, count) {
    const px = x * TILE + TILE / 2;
    const py = y * TILE + TILE / 2;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 60;
      const img = this.add.image(px, py, 'spark').setTint(color).setDepth(7.5).setScale(Math.random() * 1.3 + 0.5);
      this.fxLayer.add(img);
      this.tweens.add({
        targets: img,
        x: px + Math.cos(a) * sp,
        y: py + Math.sin(a) * sp,
        alpha: 0,
        scale: 0.1,
        duration: 280 + Math.random() * 320,
        ease: 'Cubic.Out',
        onComplete: () => img.destroy(),
      });
    }
  }

  ringAt(x, y, color, radius) {
    const img = this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, 'glow')
      .setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDepth(7.4).setScale(0.2).setAlpha(0.85);
    this.fxLayer.add(img);
    this.tweens.add({
      targets: img,
      scale: radius / 64,
      alpha: 0,
      duration: 430,
      ease: 'Cubic.Out',
      onComplete: () => img.destroy(),
    });
  }

  floatAt(x, y, text, color, size = 16) {
    const t = this.add.text(x * TILE + TILE / 2, y * TILE, text, {
      fontFamily: 'Chakra Petch, "Noto Sans SC", monospace',
      fontSize: `${size}px`,
      color: `#${(color || 0xffffff).toString(16).padStart(6, '0')}`,
      stroke: '#04060c',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(20);
    this.fxLayer.add(t);
    this.tweens.add({
      targets: t,
      y: t.y - 28,
      alpha: 0,
      duration: 820,
      ease: 'Cubic.Out',
      onComplete: () => t.destroy(),
    });
  }

  shake(intensity, duration) {
    if (!meta.get('settings').shake) return;
    this.cameras.main.shake(duration, intensity / 1000);
  }

  banner(title, sub, color) {
    this.game.events.emit('banner', { title, sub, color: color || '#7cffb2' });
  }

  updateFx(dt) {
    if (this.portalIcon) {
      this.portalIcon.rotation += dt * 0.9;
      const remaining = this.enemies.filter((e) => e.hp > 0).length;
      this.portalIcon.setAlpha(0.55 + Math.sin(this.clock * 3.4) * 0.2);
      this.portalIcon.setTint(remaining ? 0xff4d6d : 0x7cffb2);
    }
  }

  /* ------------------------------ hud bridge ------------------------------ */

  pushHud() {
    ui.sync({
      hp: this.run.hp,
      maxHp: Run.maxHp(this.run),
      shield: this.run.bonus.shield,
      level: this.run.level,
      xp: this.run.xp,
      xpNext: Run.xpForLevel(this.run),
      depth: this.run.depth,
      length: this.run.length,
      essence: this.run.essence,
      score: Run.score(this.run),
      dashCd: this.dashCd,
      dashMax: Run.dashCooldown(this.run),
      damage: Run.biteDamage(this.run),
      showFps: meta.get('settings').showFps,
      fps: Math.round(this.game.loop.actualFps),
      enemies: this.enemies.filter((e) => e.hp > 0).length,
      hunt: this.nearestEnemy(),
      relics: this.run.relics,
    });
  }

  // Direction to the closest living enemy — hunting a dark floor without it
  // is pure busywork.
  nearestEnemy() {
    const h = this.headTile();
    let best = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const dx = e.x - h.x;
      const dy = e.y - h.y;
      const dist = Math.hypot(dx, dy);
      if (dist < bestD) {
        bestD = dist;
        best = { dx, dy, dist: Math.round(dist), boss: !!e.def.boss };
      }
    }
    return best;
  }
}
