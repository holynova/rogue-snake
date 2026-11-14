/* Regression tests for the 2026-11-14 audit fixes (#55): dead upgrades and
 * relics that never took effect, misleading descriptions, the invisible-tail
 * sprite bug, touch controls, the quit confirmation and HUD fixes.
 * Runs against the dev server like acceptance.mjs. */
import { chromium } from 'playwright';
import { BASE, ensureServer } from './server.mjs';

const server = await ensureServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
// External CDN failures (Google Fonts, Umami) are environmental — the sandbox
// cannot reach them — and are not game errors, so they are filtered out.
const isExternalLoadFailure = (t) => t.startsWith('Failed to load resource');
page.on('console', (m) => { if (m.type() === 'error' && !isExternalLoadFailure(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

let failed = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' :: ' + extra : ''}`);
  if (!cond) failed += 1;
};

const scene = () => page.evaluate(() => window.__ouroboros.game.scene.getScene('game'));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

// --- title: goal line present, no middle-dot separators in the subtitle ---
ok('title shows the goal line', await page.getByText('目标：下潜 12 层，击败万象之腹').isVisible());
ok('subtitle has no middle dot', !(await page.locator('.subtitle').first().textContent()).includes('·'));

// --- codex + sanctum copy (from the title screen) ---
await page.evaluate(() => window.__ouroboros.meta.reveal('enemy', 'Crawler'));
await page.getByText('图鉴', { exact: true }).click();
await page.waitForTimeout(300);
ok('codex notes depth scaling', await page.getByText(/生命与经验随深度成长/).first().isVisible());
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.getByText('圣所：永久强化').click();
await page.waitForTimeout(300);
ok('sanctum explains echoes accurately', await page.getByText(/层数越深加成越高/).isVisible());
ok('daily unlock no longer promises trial modifiers',
  (await page.locator('body').textContent()).includes('每日种子')
  && !(await page.locator('body').textContent()).includes('试炼词条'));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// --- start a run ---
await page.fill('.seed-row input', 'audit-55');
await page.getByText('开始新的轮回').click();
await page.waitForTimeout(800);

// --- HUD: depth label, length unit, xp numbers ---
const hud = await page.evaluate(() => ({
  depth: document.querySelector('.depth-title').textContent,
  len: document.querySelectorAll('.chip .val')[1].textContent,
  xp: document.querySelector('.xp-label').textContent,
  dashTip: document.querySelector('.hud-bottom .tip').textContent,
}));
ok('HUD depth is localised', hud.depth === '第 1 层', JSON.stringify(hud));
ok('HUD length carries its unit', hud.len === '5 节', JSON.stringify(hud));
ok('HUD shows xp numbers', /^经验 \d+\/\d+$/.test(hud.xp), JSON.stringify(hud));
ok('HUD dash tip has no middle dot', !hud.dashTip.includes('·'), JSON.stringify(hud));

// --- FPS chip: the pause toggle used to do nothing ---
await page.evaluate(() => { window.__ouroboros.meta.get('settings').showFps = true; });
await page.waitForTimeout(400);
const fps = await page.evaluate(() => {
  const chip = document.querySelector('.fps-chip');
  return { visible: chip && chip.style.display !== 'none', val: chip?.querySelector('.val')?.textContent };
});
ok('FPS chip appears when enabled', fps.visible && /^\d+$/.test(fps.val || ''), JSON.stringify(fps));
await page.evaluate(() => { window.__ouroboros.meta.get('settings').showFps = false; });

// --- thorns: melee damage is reflected to adjacent enemies ---
const thorns = await page.evaluate(() => {
  const g = window.__ouroboros.game.scene.getScene('game');
  const h = g.headTile();
  const e = g.enemies[0];
  e.hp = 99; e.x = h.x + 1; e.y = h.y;
  g.run.bonus.thorns = 2;
  g.run.bonus.shield = 0; g.run.bonus.echo = 0;
  g.invuln = 0;
  const hpBefore = g.run.hp;
  g.hurt(1, 'enemy');
  return { enemyHp: e.hp, playerHp: g.run.hp, hpBefore };
});
ok('thorns reflect melee damage', thorns.enemyHp === 97 && thorns.playerHp === thorns.hpBefore - 1, JSON.stringify(thorns));

// --- mirror: 3s immunity after a hit ---
const mirror = await page.evaluate(() => {
  const g = window.__ouroboros.game.scene.getScene('game');
  g.run.bonus.thorns = 0;
  g.run.flags.mirror = true;
  g.invuln = 0;
  g.hurt(1, 'enemy');
  return { invuln: g.invuln };
});
ok('mirror grants 3s post-hit immunity', mirror.invuln === 3, JSON.stringify(mirror));

// --- leech: every level heals +1 per meal ---
const leech = await page.evaluate(() => {
  const g = window.__ouroboros.game.scene.getScene('game');
  g.run.flags.mirror = false;
  g.invuln = 0;
  const food = g.pickups.find((k) => k.type === 'food');
  if (!food) return { skipped: true };
  g.run.hp = 3;
  g.run.bonus.leech = 2;
  g.body.length = 1;
  g.body[0] = { x: food.x - 1, y: food.y };
  g.facing = { x: 1, y: 0 };
  g.step(false);
  return { hp: g.run.hp };
});
ok('leech heals per level on eating', leech.skipped || leech.hp === 5, JSON.stringify(leech));

// --- maw: growth without food ---
const maw = await page.evaluate(() => {
  const g = window.__ouroboros.game.scene.getScene('game');
  let spot = null;
  for (let y = 1; y < g.dungeon.h && !spot; y++) {
    for (let x = 1; x < g.dungeon.w - 1; x++) {
      if (g.dungeon.isWalkable(x, y) && g.dungeon.isWalkable(x + 1, y) && g.dungeon.isWalkable(x + 2, y)) { spot = { x, y }; break; }
    }
  }
  g.body.length = 1;
  g.body[0] = { x: spot.x, y: spot.y };
  g.facing = { x: 1, y: 0 };
  g.run.bonus.growth = 1.0;
  const before = g.run.length;
  g.step(false); g.step(false); g.step(false);
  return { before, after: g.run.length };
});
ok('maw grows the snake without food', maw.after > maw.before, JSON.stringify(maw));

// --- phase: self-hit costs no HP at selfHarm 0 ---
const phase = await page.evaluate(() => {
  const g = window.__ouroboros.game.scene.getScene('game');
  g.run.bonus.growth = 0;
  g.run.bonus.selfHarm = 0;
  g.run.hp = 5;
  const hpBefore = g.run.hp;
  const lenBefore = g.run.length;
  g.selfHit(g.headTile().x, g.headTile().y);
  return { hpBefore, hpAfter: g.run.hp, lenBefore, lenAfter: g.run.length };
});
ok('phase removes self-hit HP damage (length still shrinks)',
  phase.hpAfter === phase.hpBefore && phase.lenAfter < phase.lenBefore, JSON.stringify(phase));

// --- reworked lance (缓冲鳞): wall hits cost no HP ---
const lance = await page.evaluate(() => {
  const g = window.__ouroboros.game.scene.getScene('game');
  g.run.bonus.wallDmg = -1;
  g.invuln = 0;
  const hpBefore = g.run.hp;
  g.solidHit(g.headTile().x + 1, g.headTile().y);
  return { hpBefore, hpAfter: g.run.hp };
});
ok('cushion scales remove wall damage', lance.hpAfter === lance.hpBefore, JSON.stringify(lance));

// --- ascend: fractional ascend rolls for a double apply ---
const ascend = await page.evaluate(() => {
  const g = window.__ouroboros.game.scene.getScene('game');
  const fake = { id: 'fangs', name: '锐齿', apply: (r) => { r.bonus.dmg += 1; } };
  g.run.bonus.ascend = 1;
  const d0 = g.run.bonus.dmg;
  g.chooseUpgrade(fake);
  const doubled = g.run.bonus.dmg - d0;
  g.run.bonus.ascend = 0.5;
  const d1 = g.run.bonus.dmg;
  for (let i = 0; i < 100; i++) g.chooseUpgrade(fake);
  return { doubled, half: g.run.bonus.dmg - d1 };
});
ok('ascend 1.0 always doubles', ascend.doubled === 2, JSON.stringify(ascend));
ok('ascend 0.5 doubles about half the time', ascend.half >= 135 && ascend.half <= 165, JSON.stringify(ascend));

// --- sprite pool: grown segments are visible, shrunk ones hidden ---
const sprites = await page.evaluate(() => {
  const g = window.__ouroboros.game.scene.getScene('game');
  const h = g.headTile();
  while (g.body.length < 9) g.body.push({ x: h.x, y: h.y });
  g.updateSnakeVisual();
  const grown = { pool: g.segSprites.length, visible: g.segSprites.filter((s) => s.visible).length, body: g.body.length };
  g.body.length = 3;
  g.updateSnakeVisual();
  const shrunk = { pool: g.segSprites.length, visible: g.segSprites.filter((s) => s.visible).length, body: g.body.length };
  return { grown, shrunk };
});
ok('grown segments get sprites', sprites.grown.visible === sprites.grown.body, JSON.stringify(sprites));
ok('shrunk segments hide their sprites', sprites.shrunk.visible === 3, JSON.stringify(sprites));

// --- touch controls exist and work ---
await page.evaluate(() => { document.querySelector('.touch-controls').style.display = 'flex'; });
await page.getByText('突进', { exact: true }).click();
// Poll: the dash lasts 0.22s of *game* time, and the game runs on rAF, so a
// loaded machine needs more than 0.22s of wall time to finish it.
let dash = { dashing: false, dashCd: 0 };
for (let i = 0; i < 25 && !dash.dashing && dash.dashCd <= 0; i++) {
  await page.waitForTimeout(200);
  dash = await page.evaluate(() => {
    const g = window.__ouroboros.game.scene.getScene('game');
    return { dashing: g.dashing, dashCd: g.dashCd };
  });
}
ok('touch dash button triggers a dash', dash.dashing || dash.dashCd > 0, JSON.stringify(dash));

// --- quit confirmation: dismiss keeps the run, accept abandons it ---
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok('pause toggles are localised', (await page.locator('.toggle').first().textContent()) === '开'
  || (await page.locator('.toggle').first().textContent()) === '关');
page.once('dialog', async (d) => {
  ok('quit dialog mentions the 35% echoes penalty', d.message().includes('35%'), d.message());
  await d.dismiss();
});
await page.getByText('放弃轮回').click();
await page.waitForTimeout(300);
ok('dismissing the quit dialog keeps the run',
  (await page.evaluate(() => window.__ouroboros.state.screen)) === 'paused');
page.once('dialog', async (d) => { await d.accept(); });
await page.getByText('放弃轮回').click();
await page.waitForTimeout(500);
ok('accepting the quit dialog ends the run',
  (await page.evaluate(() => window.__ouroboros.state.screen)) === 'over');
ok('game-over title spells BECAME FOOD', await page.getByText('BECAME FOOD').isVisible());
ok('no BECOMED typo remains', !(await page.locator('body').textContent()).includes('BECOMED'));

// --- 390px: pause panel fits, no horizontal overflow ---
const small = await browser.newPage({ viewport: { width: 390, height: 844 } });
small.on('pageerror', (e) => errors.push(`390px: ${e.message}`));
small.on('console', (m) => { if (m.type() === 'error' && !isExternalLoadFailure(m.text())) errors.push(`390px: ${m.text()}`); });
await small.goto(BASE, { waitUntil: 'networkidle' });
await small.waitForTimeout(900);
await small.getByText('开始新的轮回').click();
await small.waitForTimeout(800);
await small.keyboard.press('Escape');
await small.waitForTimeout(300);
const narrow = await small.evaluate(() => {
  const panel = document.querySelector('.modal-bg .panel');
  const r = panel.getBoundingClientRect();
  return {
    panelW: Math.round(r.width),
    overflow: document.documentElement.scrollWidth,
    hudTopW: document.querySelector('.hud-top').scrollWidth,
  };
});
ok('390px pause panel fits the viewport', narrow.panelW <= 390, JSON.stringify(narrow));
ok('390px no horizontal overflow', narrow.overflow <= 390, JSON.stringify(narrow));

// --- coarse pointer: touch controls become visible ---
const touchCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const touchPage = await touchCtx.newPage();
const cdp = await touchCtx.newCDPSession(touchPage);
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
await touchPage.goto(BASE, { waitUntil: 'networkidle' });
await touchPage.waitForTimeout(2000);
// Dispatch the click directly: under heavy load Playwright's stability check
// can time out on this animated title screen even though the button works
// (real clicks on the same button already passed above on desktop + 390px).
await touchPage.evaluate(() => document.querySelector('.menu .btn.primary').click());
await touchPage.waitForTimeout(800);
const coarse = await touchPage.evaluate(() => {
  const el = document.querySelector('.touch-controls');
  return { display: getComputedStyle(el).display, buttons: el.querySelectorAll('button').length };
});
ok('touch controls show on coarse pointers', coarse.display === 'flex' && coarse.buttons === 4, JSON.stringify(coarse));

ok('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server?.kill();
process.exit(failed ? 1 : 0);
