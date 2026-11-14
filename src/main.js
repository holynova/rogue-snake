import Phaser from 'phaser';
import { VIEW_W, VIEW_H, COLORS } from './config.js';
import { GameScene } from './scenes/GameScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { ui } from './ui.js';
import { audio } from './audio.js';
import { meta, dailySeed } from './meta.js';
import { randomSeed, parseSeed } from './rng.js';
import { createRun, rewardEchoes, score } from './run.js';
import { RELICS } from './data.js';

const app = document.getElementById('app');
ui.mount(app);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: VIEW_W,
  height: VIEW_H,
  parent: app,
  backgroundColor: COLORS.void,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, powerPreference: 'high-performance' },
  scene: [MenuScene, GameScene],
  audio: { noAudio: true },
});

game.scene.start('menu');
document.getElementById('boot')?.classList.add('hide');

audio.init();
audio.setMuted(!!meta.get('settings').muted);

const state = {
  screen: 'title',
  prev: 'title',
  run: null,
  startingRelic: 'none',
  lastResult: null,
};

const DEPTH_NAMES = [
  '腐锈回廊', '苔痕水牢', '骨窖层', '钟塔底', '狱卒前庭',
  '熔渣矿脉', '静默花园', '镜厅', '破碎圣所', '血月祭坛',
  '无尽之喉', '万象之腹',
];

function setScreen(s) {
  state.screen = s;
  game.registry.set('screen', s);
  ui.setHudVisible(s === 'playing' || s === 'paused' || s === 'codex' || s === 'sanctum');
}

function goTitle() {
  audio.stopMusic(0.4);
  game.scene.stop('game');
  game.scene.start('menu');
  state.startingRelic = meta.startingRelics()[0];
  ui.showTitle({
    seed: meta.get('lastSeed') ?? randomSeed(),
    startingRelic: state.startingRelic,
    onStart: (seedText, relic) => startRun(seedText, relic || state.startingRelic),
    onSanctum: () => openSanctum('title'),
    onCodex: () => openCodex('title'),
  });
  setScreen('title');
}

function startRun(seedText, startingRelic) {
  audio.resume();
  const seed = seedText === 'daily'
    ? dailySeed()
    : (parseSeed(seedText) ?? randomSeed());
  meta.data.lastSeed = seed;
  meta.save();
  launchRun(seed, startingRelic);
}

function launchRun(seed, startingRelic) {
  const run = createRun({ seed, startingRelic });
  state.run = run;
  state.lastResult = null;
  audio.stopMusic(0.2);
  game.scene.stop('menu');
  ui.hide();
  ui.setHudVisible(true);
  ui.setDepthName(DEPTH_NAMES[0]);
  game.scene.start('game', { run });
  setScreen('playing');
}

function pause() {
  if (state.screen !== 'playing') return;
  game.scene.pause('game');
  setScreen('paused');
  ui.showPause({
    onResume: resume,
    onCodex: () => openCodex('paused'),
    onSanctum: () => openSanctum('paused'),
    onQuit: quitRun,
    onSetting: (key, value) => {
      meta.get('settings')[key] = value;
      meta.save();
      if (key === 'muted') audio.setMuted(value);
    },
  });
}

function resume() {
  ui.hide();
  game.scene.resume('game');
  setScreen('playing');
}

function quitRun() {
  game.scene.stop('game');
  finishRun({ won: false, abandoned: true });
}

function openCodex(from) {
  state.prev = from || state.screen;
  if (state.screen === 'playing') game.scene.pause('game');
  setScreen('codex');
  ui.showCodex({ onBack: backFromOverlay });
}

function openSanctum(from) {
  state.prev = from || state.screen;
  if (state.screen === 'playing') game.scene.pause('game');
  setScreen('sanctum');
  ui.showSanctum({ onBack: backFromOverlay });
}

function backFromOverlay() {
  if (state.prev === 'playing') resume();
  else if (state.prev === 'paused') pause();
  else if (state.prev === 'over') showResults();
  else goTitle();
}

function showResults() {
  const r = state.lastResult;
  if (!r) return goTitle();
  ui.showGameOver(
    { won: r.won, run: r.run, echoes: r.echoes, bests: { depth: meta.get('bestDepth') } },
    {
      retry: () => launchRun(r.run.seed, state.startingRelic),
      sanctum: () => openSanctum('over'),
      codex: () => openCodex('over'),
      title: () => goTitle(),
    }
  );
  setScreen('over');
}

function finishRun({ won, abandoned = false }) {
  const run = state.run;
  if (!run) return goTitle();
  const full = rewardEchoes(run, won);
  const echoes = abandoned ? Math.round(full * 0.35) : full;
  meta.recordRun({ won: won && !abandoned, depth: run.maxDepth, score: score(run), kills: run.kills, essence: run.essence, length: run.length });
  meta.addEchoes(echoes);
  meta.save();
  state.lastResult = { won: won && !abandoned, run, echoes };
  audio.stopMusic(0.6);
  showResults();
}

/* ------------------------------ bridge events ------------------------------ */

game.events.on('levelup', (payload) => {
  const scene = game.scene.getScene('game');
  if (!scene || !payload.run) return;
  ui.showLevelUp(payload, (up) => scene.chooseUpgrade(up));
});

game.events.on('run:end', (payload) => {
  setTimeout(() => finishRun(payload), payload.won ? 1000 : 0);
});

game.events.on('banner', (b) => ui.banner(b));
game.events.on('depthname', (n) => ui.setDepthName(n));

/* ------------------------------ global keys ------------------------------ */

window.addEventListener('keydown', (e) => {
  audio.resume();
  if (e.key === 'Escape') {
    if (state.screen === 'playing') pause();
    else if (state.screen === 'paused') resume();
    else if (state.screen === 'codex' || state.screen === 'sanctum') backFromOverlay();
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    if (state.screen === 'codex') backFromOverlay();
    else if (['playing', 'paused', 'over', 'title'].includes(state.screen)) openCodex(state.screen);
    return;
  }
  if (e.key === 'm' || e.key === 'M') {
    const v = !meta.get('settings').muted;
    meta.get('settings').muted = v;
    meta.save();
    audio.setMuted(v);
    return;
  }
  if ((e.key === 'r' || e.key === 'R') && state.screen === 'over' && state.lastResult) {
    launchRun(state.lastResult.run.seed, state.startingRelic);
  }
});

document.addEventListener('pointerdown', () => audio.resume(), { once: true });

goTitle();

window.__ouroboros = { game, ui, state, meta, RELICS, DEPTH_NAMES, pause, resume };
