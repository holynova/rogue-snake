/* ------------------------------------------------------------------ *
 * DOM user interface: title, HUD, level-up draft, sanctum, codex,
 * pause and results. Kept out of the canvas so text stays crisp and
 * the layout can be responsive.
 * ------------------------------------------------------------------ */

import { ENEMIES, RELICS, UPGRADES, STARTING_RELICS } from './data.js';
import { META_BRANCHES, UNLOCKS, meta, isDailyUnlocked } from './meta.js';
import { seedLabel } from './rng.js';
import { REPO_URL } from './config.js';
import { audio } from './audio.js';

function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) {
    if (kid === null || kid === undefined) continue;
    n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return n;
}

const hex = (c) => `#${(c >>> 0).toString(16).padStart(6, '0')}`;

function footLinks() {
  return el('div', { class: 'foot-links' }, [
    el('a', { class: 'link', href: REPO_URL, target: '_blank', rel: 'noopener', text: 'GitHub' }),
    el('span', { class: 'dot', text: '/' }),
    el('span', { class: 'dim', text: 'MIT 协议' }),
    el('span', { class: 'dot', text: '/' }),
    el('a', { class: 'link', href: `${REPO_URL}/stargazers`, target: '_blank', rel: 'noopener', text: 'Star ★' }),
  ]);
}

class UI {
  constructor() {
    this.root = null;
    this.hud = null;
    this.screen = null;
    this.levelUpSel = 0;
  }

  mount(parent) {
    this.root = el('div', { id: 'ui' });
    this.hud = this.buildHud();
    this.root.appendChild(this.hud);
    this.bannerEl = el('div', { id: 'banner' }, [
      el('div', { class: 'bt' }),
      el('div', { class: 'bs' }),
    ]);
    this.root.appendChild(this.bannerEl);
    this.screenHost = el('div', { class: 'pass', id: 'screen-host' });
    this.root.appendChild(this.screenHost);
    parent.appendChild(this.root);
    return this;
  }

  /* ------------------------------ HUD ------------------------------ */

  buildHud() {
    const r = {};
    r.root = el('div', { id: 'hud' });
    r.hpHearts = el('div', { class: 'hearts' });
    r.hpBar = el('div', { class: 'bar hp' }, [el('i', { style: 'width:100%' })]);
    r.hpChip = el('div', { class: 'chip' }, [
      el('span', { class: 'lbl', text: 'HP' }),
      r.hpHearts,
      r.hpBar,
      el('span', { class: 'val', text: '0/0' }),
    ]);
    r.hpVal = r.hpChip.querySelector('.val');

    r.lenChip = el('div', { class: 'chip' }, [
      el('span', { class: 'lbl', text: '长度' }),
      el('span', { class: 'val', text: '5' }),
    ]);
    r.lenVal = r.lenChip.querySelector('.val');
    r.dmgChip = el('div', { class: 'chip' }, [
      el('span', { class: 'lbl', text: '撕咬' }),
      el('span', { class: 'val', text: '1' }),
    ]);
    r.dmgVal = r.dmgChip.querySelector('.val');

    r.topLeft = el('div', { class: 'cluster' }, [r.hpChip, el('div', { class: 'row' }, [r.lenChip, r.dmgChip])]);

    r.depthNum = el('div', { class: 'depth-title', text: 'DEPTH 1' });
    r.depthName = el('div', { class: 'depth-name', text: '' });
    r.enemyCount = el('div', { class: 'enemy-count', text: '' });
    r.compass = el('div', { class: 'compass', title: '最近敌人' }, [
      el('span', { class: 'arrow', text: '➤' }),
      el('span', { class: 'cd', text: '' }),
    ]);
    r.topMid = el('div', { class: 'cluster mid' }, [r.depthNum, r.depthName, el('div', { class: 'row', style: 'gap:8px' }, [r.enemyCount, r.compass])]);

    r.escChip = el('div', { class: 'chip' }, [
      el('span', { class: 'lbl', text: '精华' }),
      el('span', { class: 'val gold', text: '0' }),
    ]);
    r.escVal = r.escChip.querySelector('.val');
    r.scoreChip = el('div', { class: 'chip' }, [
      el('span', { class: 'lbl', text: '分数' }),
      el('span', { class: 'val', text: '0' }),
    ]);
    r.scoreVal = r.scoreChip.querySelector('.val');
    r.lvChip = el('div', { class: 'chip' }, [
      el('span', { class: 'lbl', text: '等级' }),
      el('span', { class: 'val ice', text: '1' }),
    ]);
    r.lvVal = r.lvChip.querySelector('.val');
    r.fpsChip = el('div', { class: 'chip fps-chip', style: 'display:none' }, [
      el('span', { class: 'lbl', text: 'FPS' }),
      el('span', { class: 'val', text: '' }),
    ]);
    r.topRight = el('div', { class: 'cluster right' }, [
      el('div', { class: 'row' }, [r.escChip, r.lvChip, r.scoreChip, r.fpsChip]),
    ]);

    r.relics = el('div', { class: 'relic-strip' });
    r.dashBar = el('div', { class: 'bar dash ready' }, [el('i', { style: 'width:100%' })]);
    r.dashTip = el('div', { class: 'tip', text: '空格 突进' });
    r.xpBar = el('div', { class: 'bar xp' }, [el('i', { style: 'width:0%' })]);
    r.xpLabel = el('div', { class: 'tip xp-label', text: '' });
    // Touch controls: without these a touch-only player can steer (tap) but
    // can never dash, interact or descend — the run is unwinnable on mobile.
    // Shown only on coarse pointers via CSS.
    const scene = () => window.__ouroboros?.game?.scene?.getScene('game');
    const touchBtn = (label, fn) => el('button', {
      class: 'btn touch-btn',
      onclick: (e) => { e.preventDefault(); fn(); },
    }, [label]);
    r.touchControls = el('div', { class: 'touch-controls' }, [
      touchBtn('突进', () => scene()?.tryDash()),
      touchBtn('交互', () => scene()?.interact()),
      touchBtn('冲击波', () => scene()?.blast()),
      touchBtn('暂停', () => window.__ouroboros?.pause?.()),
    ]);
    r.bottom = el('div', { class: 'hud-bottom' }, [
      el('div', { class: 'row', style: 'justify-content:space-between;align-items:flex-end' }, [
        r.relics,
        el('div', { class: 'cluster right' }, [
          el('div', { class: 'row', style: 'gap:8px;align-items:center' }, [r.dashTip, r.dashBar]),
        ]),
      ]),
      r.touchControls,
      el('div', { class: 'row', style: 'justify-content:space-between' }, [r.xpLabel, el('span', { class: 'tip', text: 'ESC 暂停 / TAB 图鉴' })]),
      r.xpBar,
    ]);

    r.root.appendChild(el('div', { class: 'hud-top' }, [r.topLeft, r.topMid, r.topRight]));
    r.root.appendChild(r.bottom);
    r.root.classList.add('pass');
    return r.root;
  }

  cacheHud() {
    this.h = {
      hearts: this.hud.querySelector('.hearts'),
      hpVal: this.hud.querySelectorAll('.chip .val')[0],
      lenVal: this.hud.querySelectorAll('.chip .val')[1],
      dmgVal: this.hud.querySelectorAll('.chip .val')[2],
      escVal: this.hud.querySelectorAll('.chip .val')[3],
      lvVal: this.hud.querySelectorAll('.chip .val')[4],
      scoreVal: this.hud.querySelectorAll('.chip .val')[5],
      depthNum: this.hud.querySelector('.depth-title'),
      depthName: this.hud.querySelector('.depth-name'),
      enemyCount: this.hud.querySelector('.enemy-count'),
      compass: this.hud.querySelector('.compass'),
      compassArrow: this.hud.querySelector('.compass .arrow'),
      compassDist: this.hud.querySelector('.compass .cd'),
      relics: this.hud.querySelector('.relic-strip'),
      dashBar: this.hud.querySelector('.bar.dash'),
      dashFill: this.hud.querySelector('.bar.dash > i'),
      hpBar: this.hud.querySelector('.bar.hp'),
      hpFill: this.hud.querySelector('.bar.hp > i'),
      xpFill: this.hud.querySelector('.bar.xp > i'),
      xpLabel: this.hud.querySelector('.hud-bottom .xp-label'),
      fpsChip: this.hud.querySelector('.fps-chip'),
      fpsVal: this.hud.querySelector('.fps-chip .val'),
    };
    this._lastHearts = -1;
    this._lastRelics = '';
  }

  sync(d) {
    if (!this.hud || this.hud.style.display === 'none') return;
    if (!this.h) this.cacheHud();
    const h = this.h;
    const total = d.maxHp;
    if (this._lastHearts !== total || this._lastHp !== d.hp || this._lastShield !== d.shield) {
      this._lastHearts = total; this._lastHp = d.hp; this._lastShield = d.shield;
      const wide = total > 14;
      h.hearts.style.display = wide ? 'none' : '';
      h.hpBar.style.display = wide ? '' : 'none';
      h.hearts.innerHTML = '';
      if (wide) {
        h.hpFill.style.width = `${Math.max(0, Math.min(100, (d.hp / total) * 100))}%`;
      } else {
        for (let i = 0; i < total; i++) {
          h.hearts.appendChild(el('i', { class: `heart${i < d.hp ? '' : ' empty'}` }));
        }
        for (let i = 0; i < Math.min(4, d.shield); i++) {
          h.hearts.appendChild(el('i', { class: 'heart shield' }));
        }
      }
    }
    h.hpVal.textContent = `${Math.max(0, d.hp)}/${total}${d.shield ? ` +${d.shield}` : ''}`;
    h.lenVal.textContent = `${d.length} 节`;
    h.dmgVal.textContent = d.damage;
    h.escVal.textContent = d.essence;
    h.lvVal.textContent = d.level;
    h.scoreVal.textContent = d.score;
    h.depthNum.textContent = `第 ${d.depth} 层`;
    h.enemyCount.textContent = d.enemies > 0 ? `残敌 ${d.enemies}` : '区域已清空，前往出口';
    if (d.hunt) {
      h.compass.style.display = '';
      h.compassArrow.style.transform = `rotate(${Math.atan2(d.hunt.dy, d.hunt.dx) + Math.PI / 2}rad)`;
      h.compassDist.textContent = `${d.hunt.dist} 格`;
      h.compass.classList.toggle('boss', !!d.hunt.boss);
    } else {
      h.compass.style.display = 'none';
    }
    h.xpFill.style.width = `${Math.min(100, (d.xp / d.xpNext) * 100)}%`;
    if (h.xpLabel) h.xpLabel.textContent = `经验 ${d.xp}/${d.xpNext}`;
    if (h.fpsChip) {
      h.fpsChip.style.display = d.showFps ? '' : 'none';
      if (d.showFps) h.fpsVal.textContent = String(d.fps);
    }
    const ready = d.dashCd <= 0;
    h.dashBar.classList.toggle('ready', ready);
    h.dashFill.style.width = `${ready ? 100 : 100 - (d.dashCd / d.dashMax) * 100}%`;
    const key = d.relics.join(',');
    if (key !== this._lastRelics) {
      this._lastRelics = key;
      h.relics.innerHTML = '';
      for (const id of d.relics) {
        const rel = RELICS.find((r) => r.id === id);
        if (!rel) continue;
        h.relics.appendChild(
          el('div', { class: 'relic-pip', 'data-r': rel.rarity, 'data-name': `${rel.name}：${rel.desc}`, title: `${rel.name}：${rel.desc}` }, [rel.icon || '◆'])
        );
      }
    }
  }

  setDepthName(name) {
    if (this.h) this.h.depthName.textContent = name;
  }

  setHudVisible(v) {
    this.hud.style.display = v ? '' : 'none';
    this.hud.classList.toggle('pass', !v);
    if (v && !this.h) this.cacheHud();
  }

  /* ------------------------------ banner ------------------------------ */

  banner({ title, sub, color }) {
    const bt = this.bannerEl.querySelector('.bt');
    const bs = this.bannerEl.querySelector('.bs');
    bt.textContent = title;
    bt.style.color = color;
    bs.textContent = sub || '';
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
  }

  /* ------------------------------ screens ------------------------------ */

  closeScreen() {
    this.screenHost.innerHTML = '';
    this.screen = null;
  }

  open(name, node) {
    this.closeScreen();
    this.screen = name;
    this.screenHost.classList.remove('pass');
    this.screenHost.appendChild(node);
  }

  isOpen() {
    return this.screen !== null;
  }

  /* ---- title ---- */
  showTitle({ seed, startingRelic, onStart, onSanctum, onCodex }) {
    const d = meta.data;
    const relicIds = meta.startingRelics();
    const seedInput = el('input', {
      type: 'text',
      value: seedLabel(seed),
      spellcheck: 'false',
      placeholder: '输入种子或留空随机',
      onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
    });
    const dailyBtn = isDailyUnlocked()
      ? el('button', { class: 'btn sm ghost', onclick: () => { audio.sfx('ui'); onStart('daily'); } }, ['每日种子'])
      : null;

    const relicName = el('span', { class: 'dim', style: 'font-size:11.5px;line-height:1.5;text-align:left', text: STARTING_RELICS[relicIds.includes(startingRelic) ? startingRelic : relicIds[0]].desc });
    const relicTabs = el('div', { class: 'row', style: 'gap:6px;justify-content:center' },
      relicIds.map((id) => el('button', {
        class: `btn sm${id === startingRelic ? ' primary' : ''}`,
        'data-id': id,
        onclick: (ev) => {
          audio.sfx('ui');
          startingRelic = id;
          [...relicTabs.children].forEach((c) => c.className = `btn sm${c.dataset.id === id ? ' primary' : ''}`);
          relicName.textContent = STARTING_RELICS[id].desc;
          void ev;
        },
      }, [`${STARTING_RELICS[id].icon || '◇'} ${STARTING_RELICS[id].name}`])));

    const node = el('div', { class: 'screen title-screen' }, [
      el('div', { class: 'title-wrap' }, [
        el('h1', { class: 'logo', text: 'OUROBOROS' }),
        el('p', { class: 'subtitle', text: '衔尾者 — 贪食蛇 × Roguelike' }),
        el('p', { class: 'goal-line', text: '目标：下潜 12 层，击败万象之腹' }),
        el('div', { class: 'menu' }, [
          el('button', {
            class: 'btn primary',
            onclick: () => { audio.resume(); audio.sfx('uiok'); onStart(seedInput.value, startingRelic); },
          }, ['开始新的轮回']),
          el('button', { class: 'btn', onclick: () => { audio.sfx('ui'); onSanctum(); } }, ['圣所：永久强化']),
          el('button', { class: 'btn', onclick: () => { audio.sfx('ui'); onCodex(); } }, ['图鉴']),
        ]),
        el('div', { class: 'seed-row' }, [seedInput, dailyBtn].filter(Boolean)),
        el('div', { class: 'stack', style: 'margin-top:18px;justify-items:center;max-width:460px' }, [
          el('div', { class: 'tip', text: '起始遗物' }),
          relicTabs,
          relicName,
        ]),
        el('div', { class: 'best-line dim' }, [
          '最深 ',
          el('b', { class: 'num accent', text: String(d.bestDepth) }),
          ' 层，最高分 ',
          el('b', { class: 'num gold', text: String(d.bestScore) }),
          '，最长 ',
          el('b', { class: 'num ice', text: String(d.bestLength) }),
          ' 节，轮回 ',
          el('b', { class: 'num', text: String(d.runs) }),
          ' 次，回响 ',
          el('b', { class: 'num gold', text: String(d.echoes) }),
        ]),
        footLinks(),
        el('div', { class: 'hint-keys' }, [
          el('div', { html: '<kbd>W A S D</kbd> / <kbd>方向键</kbd> 转向' }),
          el('div', { html: '<kbd>SPACE</kbd> 突进（无敌帧，碾碎敌人）' }),
          el('div', { html: '<kbd>E</kbd> 交互 / 突破出口' }),
          el('div', { html: '<kbd>Q</kbd> 消耗 25 精华引爆冲击波' }),
          el('div', { html: '<kbd>TAB</kbd> 图鉴，<kbd>M</kbd> 静音' }),
          el('div', { html: '<kbd>ESC</kbd> 暂停' }),
        ]),
      ]),
    ]);
    this.open('title', node);
    this.setHudVisible(false);
    // Don't pop the on-screen keyboard on touch devices.
    if (window.matchMedia('(pointer:fine)').matches) setTimeout(() => seedInput.focus(), 120);
  }

  /* ---- sanctum ---- */
  showSanctum({ onBack, onWipe }) {
    const render = () => {
      const nodes = META_BRANCHES.map((b) => {
        const lvl = meta.branchLevel(b.id);
        const cost = lvl >= b.max ? null : b.cost(lvl);
        const can = cost !== null && meta.data.echoes >= cost;
        return el('div', { class: `node${lvl > 0 ? ' owned' : ''}` }, [
          el('div', { class: 'top' }, [
            el('span', { class: 'ico', text: b.icon }),
            el('span', { class: 'nm', text: b.name }),
            el('span', { class: 'dim num', style: 'margin-left:auto;font-size:12px', text: `${lvl}/${b.max}` }),
          ]),
          el('div', { class: 'ds', text: b.desc }),
          el('div', { class: 'pips' }, Array.from({ length: b.max }, (_, i) => el('i', { class: i < lvl ? 'on' : '' }))),
          cost === null
            ? el('button', { class: 'btn sm', disabled: 'true' }, ['已满级'])
            : el('button', {
                class: `btn sm${can ? ' primary' : ''}`,
                disabled: can ? null : 'true',
                onclick: () => {
                  if (meta.buyBranch(b.id)) { audio.sfx('uiok'); render(); } else audio.sfx('deny');
                },
              }, [`升级（${cost} 回响）`]),
        ]);
      });

      const unlocks = UNLOCKS.map((u) => {
        const owned = meta.hasUnlock(u.id);
        const can = !owned && meta.data.echoes >= u.cost;
        return el('div', { class: `node${owned ? ' owned' : ''}` }, [
          el('div', { class: 'top' }, [
            el('span', { class: 'ico', text: owned ? '✔' : '✦' }),
            el('span', { class: 'nm', text: u.name }),
          ]),
          owned
            ? el('button', { class: 'btn sm', disabled: 'true' }, ['已解锁'])
            : el('button', {
                class: `btn sm${can ? ' primary' : ''}`,
                disabled: can ? null : 'true',
                onclick: () => { if (meta.buyUnlock(u.id)) { audio.sfx('uiok'); render(); } else audio.sfx('deny'); },
              }, [`解锁（${u.cost} 回响）`]),
        ]);
      });

      return el('div', { class: 'screen' }, [
        el('div', { class: 'panel wrap stack' }, [
          el('div', { class: 'row', style: 'justify-content:space-between' }, [
            el('div', {}, [
              el('h2', { class: 'ttl', text: '圣所 SANCTUM' }),
              el('div', { class: 'dim', style: 'font-size:12px;letter-spacing:.1em', text: '轮回之间留下的回响，可换取永久强化' }),
            ]),
            el('div', { class: 'row' }, [
              el('div', { class: 'echoes', text: `◈ ${meta.data.echoes} 回响` }),
              el('button', { class: 'btn sm', onclick: () => { audio.sfx('ui'); onBack(); } }, ['返回']),
            ]),
          ]),
          el('div', {}, [el('div', { class: 'tip', style: 'margin-bottom:8px', text: '永久能力' }), el('div', { class: 'grid-b' }, nodes)]),
          el('div', {}, [el('div', { class: 'tip', style: 'margin-bottom:8px', text: '解锁' }), el('div', { class: 'grid-b' }, unlocks)]),
          el('div', { class: 'row', style: 'justify-content:space-between;margin-top:6px' }, [
            el('span', { class: 'tip', text: '回响按深度、击杀与通关结算，层数越深加成越高' }),
            el('button', {
              class: 'btn sm ghost danger',
              onclick: () => {
                if (confirm('确定要抹除全部圣所进度吗？此操作不可撤销。')) { meta.wipe(); render(); }
              },
            }, ['抹除进度']),
          ]),
        ]),
      ]);
    };
    this.open('sanctum', render());
    this.setHudVisible(false);
  }

  /* ---- codex ---- */
  showCodex({ onBack, tab = 'enemy' }) {
    const render = (active) => {
      const mkTab = (id, label) =>
        el('button', {
          class: `btn sm${active === id ? ' primary' : ''}`,
          onclick: () => { audio.sfx('ui'); render(id); },
        }, [label]);

      let entries = [];
      if (active === 'enemy') {
        entries = Object.values(ENEMIES).map((e) => ({
          seen: !!meta.data.codex[e.en],
          sw: hex(e.color),
          icon: '◈',
          name: `${e.name}  ${e.en}`,
          desc: `${e.desc}\nHP ${e.hp}，伤害 ${e.dmg}，速度 ${e.speed} 格/秒，经验 ${e.xp}（生命与经验随深度成长）`,
        }));
      } else if (active === 'relic') {
        entries = RELICS.map((r) => ({
          seen: !!meta.data.seenRelics[r.id],
          sw: r.rarity === 3 ? '#b98bff' : r.rarity === 2 ? '#7fd8ff' : '#ffd166',
          icon: r.icon || '◆',
          name: r.name,
          desc: `${r.desc}\n稀有度 ${'★'.repeat(r.rarity)}`,
        }));
      } else if (active === 'upgrade') {
        entries = UPGRADES.map((u) => ({
          seen: true,
          sw: '#7cffb2',
          icon: u.icon || '✦',
          name: u.name,
          desc: `${u.desc}\n最大等级 ${u.max}`,
        }));
      } else {
        entries = Object.values(STARTING_RELICS).filter((s) => s.id !== 'none').map((s) => ({
          seen: meta.startingRelics().includes(s.id),
          sw: '#e8f0ff',
          icon: s.icon || '◆',
          name: s.name,
          desc: s.desc,
        }));
      }

      return el('div', { class: 'screen' }, [
        el('div', { class: 'panel wrap stack' }, [
          el('div', { class: 'row', style: 'justify-content:space-between' }, [
            el('h2', { class: 'ttl', text: '图鉴 CODEX' }),
            el('button', { class: 'btn sm', onclick: () => { audio.sfx('ui'); onBack(); } }, ['返回']),
          ]),
          el('div', { class: 'codex-tabs' }, [
            mkTab('enemy', '敌人'),
            mkTab('relic', '遗物'),
            mkTab('upgrade', '升级'),
            mkTab('start', '起始遗物'),
          ]),
          el('div', { class: 'codex-list' }, entries.map((e) =>
            el('div', { class: `entry${e.seen ? '' : ' locked'}` }, [
              el('div', { class: 'sw', style: `background:${e.sw}22;color:${e.sw};border:1px solid ${e.sw}55` }, [e.icon]),
              el('div', { class: 'tx' }, [
                el('div', { class: 'nm', text: e.seen ? e.name : '???' }),
                el('div', { class: 'ds', text: e.seen ? e.desc : '尚未遭遇' }),
              ]),
            ])
          )),
        ]),
      ]);
    };
    this.open('codex', render(tab));
    this.setHudVisible(false);
  }

  /* ---- pause ---- */
  showPause({ onResume, onCodex, onSanctum, onQuit, onSetting }) {
    const s = meta.get('settings');
    // `invert` rows display the enabled state (e.g. 音效 is the !muted flag)
    const rowToggle = (label, key, invert = false) => {
      const shown = (v) => (invert ? !v : v);
      let cur = shown(s[key]);
      const btn = el('button', { class: `toggle${cur ? ' on' : ''}`, text: cur ? '开' : '关' });
      btn.addEventListener('click', () => {
        const v = !meta.get('settings')[key];
        onSetting(key, v);
        cur = shown(v);
        btn.className = `toggle${cur ? ' on' : ''}`;
        btn.textContent = cur ? '开' : '关';
        audio.sfx('ui');
      });
      return el('div', { class: 'settings-row' }, [el('span', { text: label }), btn]);
    };

    const node = el('div', { class: 'modal-bg' }, [
      el('div', { class: 'panel stack', style: 'min-width:min(380px, 100%)' }, [
        el('h2', { class: 'ttl', text: '暂停 PAUSED' }),
        el('div', { class: 'dim', style: 'font-size:12px;letter-spacing:.1em', text: '时间已停止' }),
        el('div', {}, [rowToggle('音效', 'muted', true), rowToggle('画面震动', 'shake'), rowToggle('显示 FPS', 'showFps')]),
        el('div', { class: 'kbd-help' }, [
          el('div', {}, [el('span', { text: '移动' }), el('span', { html: '<kbd>WASD</kbd> <kbd>↑↓←→</kbd>' })]),
          el('div', {}, [el('span', { text: '突进（无敌，碾碎敌人）' }), el('span', { html: '<kbd>SPACE</kbd>' })]),
          el('div', {}, [el('span', { text: '交互 / 突破' }), el('span', { html: '<kbd>E</kbd>' })]),
          el('div', {}, [el('span', { text: '冲击波（25 精华）' }), el('span', { html: '<kbd>Q</kbd>' })]),
          el('div', {}, [el('span', { text: '图鉴' }), el('span', { html: '<kbd>TAB</kbd>' })]),
        ]),
        footLinks(),
        el('div', { class: 'row', style: 'margin-top:6px' }, [
          el('button', { class: 'btn primary', onclick: () => { audio.sfx('uiok'); onResume(); } }, ['继续']),
          el('button', { class: 'btn', onclick: () => { audio.sfx('ui'); onCodex(); } }, ['图鉴']),
          el('button', { class: 'btn', onclick: () => { audio.sfx('ui'); onSanctum(); } }, ['圣所']),
          el('button', { class: 'btn ghost', onclick: () => { audio.sfx('ui'); if (confirm('放弃本次轮回？只能保留 35% 的回响。')) onQuit(); } }, ['放弃轮回']),
        ]),
      ]),
    ]);
    this.open('pause', node);
  }

  /* ---- level up ---- */
  showLevelUp({ run, options }, onPick) {
    this.levelUpSel = 0;
    const cards = [];
    const node = el('div', { class: 'modal-bg' }, [
      el('div', { class: 'panel stack wide' }, [
        el('div', { class: 'center' }, [
          el('h2', { class: 'ttl', text: '升级 LEVEL UP' }),
          el('div', { class: 'dim', style: 'font-size:12px;letter-spacing:.2em', text: `等级 ${run.level}，选择一项强化` }),
        ]),
        el('div', { class: 'cards' }, options.map((u, i) => {
          const lvl = run.upgrades[u.id] || 0;
          const card = el('div', {
            class: `card${i === 0 ? ' sel' : ''}`,
            onclick: () => pick(i),
            onmouseenter: () => sel(i),
          }, [
            el('div', { class: 'key', text: String(i + 1) }),
            el('div', { class: 'ico', text: u.icon || '✦' }),
            el('div', { class: 'nm', text: u.name }),
            el('div', { class: 'ds', text: u.desc }),
            el('div', { class: 'lvl', text: `${lvl} / ${u.max}` }),
          ]);
          cards.push(card);
          return card;
        })),
        el('div', { class: 'tip center', text: '按 1 / 2 / 3 选择，或用鼠标点击' }),
      ]),
    ]);

    const sel = (i) => {
      this.levelUpSel = i;
      cards.forEach((c, k) => c.classList.toggle('sel', k === i));
    };
    const pick = (i) => {
      if (!options[i]) return;
      audio.sfx('uiok');
      this.closeScreen();
      onPick(options[i]);
    };
    this._levelUpKeys = (e) => {
      if (!this.screen || this.screen !== 'levelup') return;
      if (['1', '2', '3'].includes(e.key)) pick(Number(e.key) - 1);
      else if (e.key === 'ArrowRight') sel(Math.min(options.length - 1, this.levelUpSel + 1));
      else if (e.key === 'ArrowLeft') sel(Math.max(0, this.levelUpSel - 1));
      else if (e.key === 'Enter') pick(this.levelUpSel);
    };
    window.addEventListener('keydown', this._levelUpKeys);
    this.open('levelup', node);
  }

  clearLevelUpKeys() {
    if (this._levelUpKeys) window.removeEventListener('keydown', this._levelUpKeys);
    this._levelUpKeys = null;
  }

  /* ---- results ---- */
  showGameOver({ won, run, echoes, bests }, handlers) {
    const stat = (k, v, big) => el('div', { class: `stat${big ? ' big' : ''}` }, [
      el('div', { class: 'k', text: k }),
      el('div', { class: 'v', text: String(v) }),
    ]);
    const newBest = run.maxDepth >= bests.depth && run.maxDepth > 0;
    const node = el('div', { class: 'screen' }, [
      el('div', { class: 'panel wrap stack center', style: 'max-width:820px' }, [
        el('h1', { class: 'logo', style: `color:${won ? 'var(--gold)' : 'var(--danger)'};font-size:clamp(30px,6vw,64px)`, text: won ? 'VICTORY' : 'BECAME FOOD' }),
        el('p', { class: 'subtitle', text: won ? '万象之腹已被填满，轮回结束' : `你成为了别人的食物，止步第 ${run.maxDepth} 层，种子 ${seedLabel(run.seed)}` }),
        el('div', { class: 'result-grid' }, [
          stat('最深深度', run.maxDepth, true),
          stat('分数', run.score, true),
          stat('获得回响', `+${echoes}`, true),
          stat('最终长度', run.length),
          stat('等级', run.level),
          stat('击杀', run.kills),
          stat('精华', run.essence),
          stat('遗物', run.relics.length),
        ]),
        el('div', { class: 'dim', style: 'font-size:12.5px;letter-spacing:.08em', text: `本局遗物：${run.relics.map((id) => (RELICS.find((r) => r.id === id) || {}).name).filter(Boolean).join('、') || '无'}` }),
        newBest ? el('div', { class: 'gold', style: 'letter-spacing:.2em;font-size:13px', text: '◆ 新纪录 ◆' }) : null,
        footLinks(),
        el('div', { class: 'row', style: 'justify-content:center;margin-top:8px' }, [
          el('button', { class: 'btn primary', onclick: () => { audio.sfx('uiok'); handlers.retry(); } }, ['再来一次 (R)']),
          el('button', { class: 'btn', onclick: () => { audio.sfx('ui'); handlers.sanctum(); } }, ['圣所']),
          el('button', { class: 'btn', onclick: () => { audio.sfx('ui'); handlers.codex(); } }, ['图鉴']),
          el('button', { class: 'btn ghost', onclick: () => { audio.sfx('ui'); handlers.title(); } }, ['返回标题']),
        ]),
      ]),
    ]);
    this.clearLevelUpKeys();
    this.open('over', node);
    this.setHudVisible(false);
  }

  hide() {
    this.clearLevelUpKeys();
    this.closeScreen();
    this.screenHost.classList.add('pass');
  }
}

export const ui = new UI();
