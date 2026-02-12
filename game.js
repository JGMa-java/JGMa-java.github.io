(() => {
    // ====== Canvas / DPI ======
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');

    function resize() {
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = Math.floor(canvas.clientWidth * dpr);
        canvas.height = Math.floor(canvas.clientHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', resize);

    // ====== UI refs ======
    const hud = {
        time: document.getElementById('time'),
        level: document.getElementById('level'),
        hp: document.getElementById('hp'),
        kills: document.getElementById('kills'),
        enemies: document.getElementById('enemies'),
        fps: document.getElementById('fps'),
        xpfill: document.getElementById('xpfill'),
        xptxt: document.getElementById('xptxt'),
    };

    const overlay = document.getElementById('overlay');
    const choicesEl = document.getElementById('choices');
    const menu = document.getElementById('menu');
    const startBtn = document.getElementById('startBtn');
    const howBtn = document.getElementById('howBtn');
    const resetBtn = document.getElementById('resetBtn');
    const howBox = document.getElementById('how');

    const mobile = document.getElementById('mobile');
    const stick = document.getElementById('stick');
    const stickKnob = document.getElementById('stickKnob');
    const dashBtn = document.getElementById('dashBtn');
    const pauseBtn = document.getElementById('pauseBtn');

    howBtn.addEventListener('click', () => howBox.classList.toggle('hidden'));
    resetBtn.addEventListener('click', () => {
        localStorage.removeItem('survivors_save_v1');
        alert('已清空存档（本地 localStorage）。');
    });

    // ====== Math utils ======
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const rand = (a, b) => a + Math.random() * (b - a);
    const irand = (a, b) => Math.floor(rand(a, b + 1));
    const len = (x, y) => Math.hypot(x, y);
    const norm = (x, y) => {
        const l = Math.hypot(x, y) || 1;
        return { x: x / l, y: y / l, l };
    };
    const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

    // ====== World settings ======
    const W = () => canvas.clientWidth;
    const H = () => canvas.clientHeight;

    const WORLD = {
        // Infinite plane with camera following player.
        spawnRadius: 520,
        despawnRadius: 900,
    };

    // ====== Save / meta progression (lightweight) ======
    function loadSave() {
        try {
            const s = JSON.parse(localStorage.getItem('survivors_save_v1') || 'null');
            return s && typeof s === 'object' ? s : { bestTime: 0 };
        } catch {
            return { bestTime: 0 };
        }
    }
    function saveToDisk(save) {
        localStorage.setItem('survivors_save_v1', JSON.stringify(save));
    }
    const SAVE = loadSave();

    // ====== Entities ======
    const player = {
        x: 0, y: 0,
        r: 14,
        hp: 100, hpMax: 100,
        baseSpeed: 220,
        speedMul: 1,
        armor: 0,
        regen: 0,
        magnet: 1,
        iFrames: 0,
        dash: { cd: 0, duration: 0, mult: 2.2 },

        xp: 0,
        level: 1,
        nextXp: 10,

        // stats affecting weapons
        dmgMul: 1,
        areaMul: 1,
        cdMul: 1,
        projSpeedMul: 1,
        luck: 0,
    };

    let cam = { x: 0, y: 0 };

    const enemies = [];
    const projectiles = [];
    const pickups = [];
    const fx = []; // simple particles / hit flashes

    let kills = 0;
    let elapsed = 0;
    let paused = false;
    let inLevelUp = false;
    let gameOver = false;

    // ====== Weapons system ======
    // Each weapon has level, and an update function generating bullets/aoe.
    const weapons = new Map();

    function addWeapon(name) {
        if (weapons.has(name)) return;
        weapons.set(name, { lvl: 1, timer: 0 });
    }
    function weaponLevel(name) {
        return weapons.get(name)?.lvl || 0;
    }
    function upgradeWeapon(name) {
        if (!weapons.has(name)) addWeapon(name);
        weapons.get(name).lvl = Math.min(8, weapons.get(name).lvl + 1);
    }

    // Weapon definitions (small set but representative)
    const WEAPON_DEFS = {
        knife: {
            display: '飞刀',
            tag: '直线 · 单体',
            desc: (lvl) => `向最近敌人投掷飞刀（等级 ${lvl}）。提升：伤害/数量/冷却。`,
            max: 8,
            update: (st, dt) => {
                const lvl = st.lvl;
                const baseCd = 0.85;
                const cd = baseCd * (1 - 0.05 * (lvl - 1)) * player.cdMul;
                st.timer -= dt;
                if (st.timer > 0) return;

                const target = findNearestEnemy(player.x, player.y, 620);
                if (!target) { st.timer = 0.15; return; }

                const count = 1 + (lvl >= 4 ? 1 : 0) + (lvl >= 7 ? 1 : 0);
                for (let i = 0; i < count; i++) {
                    const spread = (count === 1) ? 0 : (i - (count - 1) / 2) * 0.14;
                    const dx = target.x - player.x;
                    const dy = target.y - player.y;
                    const a = Math.atan2(dy, dx) + spread;
                    spawnProjectile({
                        x: player.x, y: player.y,
                        vx: Math.cos(a) * (520 * player.projSpeedMul),
                        vy: Math.sin(a) * (520 * player.projSpeedMul),
                        r: 4,
                        dmg: (14 + 5 * lvl) * player.dmgMul,
                        pierce: (lvl >= 6 ? 2 : 1),
                        ttl: 1.2,
                        kind: 'knife',
                    });
                }
                st.timer = cd;
            }
        },

        wand: {
            display: '魔杖',
            tag: '自动 · 追踪',
            desc: (lvl) => `发射追踪弹（等级 ${lvl}）。提升：伤害/数量/冷却/穿透。`,
            max: 8,
            update: (st, dt) => {
                const lvl = st.lvl;
                const baseCd = 1.05;
                const cd = baseCd * (1 - 0.04 * (lvl - 1)) * player.cdMul;
                st.timer -= dt;
                if (st.timer > 0) return;

                const count = 1 + (lvl >= 3 ? 1 : 0) + (lvl >= 6 ? 1 : 0);
                for (let i = 0; i < count; i++) {
                    const ang = rand(0, TAU);
                    spawnProjectile({
                        x: player.x + Math.cos(ang) * 6,
                        y: player.y + Math.sin(ang) * 6,
                        vx: Math.cos(ang) * (260 * player.projSpeedMul),
                        vy: Math.sin(ang) * (260 * player.projSpeedMul),
                        r: 5,
                        dmg: (18 + 6 * lvl) * player.dmgMul,
                        pierce: 1 + (lvl >= 7 ? 1 : 0),
                        ttl: 2.2,
                        kind: 'wand',
                        homing: 0.9 + lvl * 0.08, // steer strength
                    });
                }
                st.timer = cd;
            }
        },

        garlic: {
            display: '蒜圈',
            tag: '范围 · 近身',
            desc: (lvl) => `周身持续伤害光环（等级 ${lvl}）。提升：半径/伤害。`,
            max: 8,
            update: (st, dt) => {
                // handled as aura in enemy update
                st.timer = 0;
            }
        },

        orbit: {
            display: '环绕符文',
            tag: '环绕 · 多段',
            desc: (lvl) => `生成环绕物持续撞击敌人（等级 ${lvl}）。提升：数量/速度/伤害。`,
            max: 8,
            update: (st, dt) => {
                st.timer = 0;
            }
        },
    };

    // ====== Passive upgrades ======
    const PASSIVES = {
        maxhp: {
            display: '生命上限',
            tag: '被动',
            desc: () => `最大生命 +12%。`,
            apply: () => {
                player.hpMax = Math.round(player.hpMax * 1.12);
                player.hp = Math.min(player.hpMax, player.hp + Math.round(player.hpMax * 0.12));
            }
        },
        speed: {
            display: '移速',
            tag: '被动',
            desc: () => `移动速度 +10%。`,
            apply: () => { player.speedMul *= 1.10; }
        },
        dmg: {
            display: '伤害',
            tag: '被动',
            desc: () => `伤害 +12%。`,
            apply: () => { player.dmgMul *= 1.12; }
        },
        cd: {
            display: '冷却',
            tag: '被动',
            desc: () => `冷却 -8%（更快攻击）。`,
            apply: () => { player.cdMul *= 0.92; }
        },
        area: {
            display: '范围',
            tag: '被动',
            desc: () => `范围 +12%。`,
            apply: () => { player.areaMul *= 1.12; }
        },
        regen: {
            display: '回血',
            tag: '被动',
            desc: () => `每秒回复 +0.6 HP。`,
            apply: () => { player.regen += 0.6; }
        },
        magnet: {
            display: '吸取',
            tag: '被动',
            desc: () => `拾取范围 +18%。`,
            apply: () => { player.magnet *= 1.18; }
        },
        armor: {
            display: '护甲',
            tag: '被动',
            desc: () => `受伤减免 +1（每次受击）。`,
            apply: () => { player.armor += 1; }
        },
        projSpeed: {
            display: '弹速',
            tag: '被动',
            desc: () => `投射物速度 +12%。`,
            apply: () => { player.projSpeedMul *= 1.12; }
        }
    };

    // ====== Input ======
    const keys = new Set();
    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        keys.add(e.code);

        if (e.code === 'KeyP') togglePause();
        if (e.code === 'Escape') {
            if (inLevelUp) closeLevelUp();
        }
        if (inLevelUp) {
            if (e.code === 'Digit1') chooseUpgrade(0);
            if (e.code === 'Digit2') chooseUpgrade(1);
            if (e.code === 'Digit3') chooseUpgrade(2);
        }
        if (!inLevelUp && !paused && e.code === 'Space') dash();
    });
    window.addEventListener('keyup', (e) => keys.delete(e.code));

    // Mobile joystick
    const isTouch = matchMedia('(pointer: coarse)').matches;
    let stickState = { active: false, cx: 0, cy: 0, dx: 0, dy: 0 };
    if (isTouch) mobile.classList.remove('hidden');

    function setKnob(dx, dy) {
        const max = 44;
        const l = Math.hypot(dx, dy) || 1;
        const k = l > max ? max / l : 1;
        stickKnob.style.transform = `translate(${dx * k}px, ${dy * k}px) translate(-50%,-50%)`;
    }
    stick.addEventListener('pointerdown', (e) => {
        stickState.active = true;
        stick.setPointerCapture(e.pointerId);
        const r = stick.getBoundingClientRect();
        stickState.cx = r.left + r.width / 2;
        stickState.cy = r.top + r.height / 2;
        stickState.dx = 0; stickState.dy = 0;
        setKnob(0, 0);
    });
    stick.addEventListener('pointermove', (e) => {
        if (!stickState.active) return;
        stickState.dx = e.clientX - stickState.cx;
        stickState.dy = e.clientY - stickState.cy;
        setKnob(stickState.dx, stickState.dy);
    });
    stick.addEventListener('pointerup', () => {
        stickState.active = false;
        stickState.dx = 0; stickState.dy = 0;
        setKnob(0, 0);
    });
    dashBtn.addEventListener('click', () => dash());
    pauseBtn.addEventListener('click', () => togglePause());

    function moveInput() {
        let x = 0, y = 0;
        if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;

        if (stickState.active) {
            const n = norm(stickState.dx, stickState.dy);
            // deadzone
            const dz = 8;
            const m = clamp((n.l - dz) / 44, 0, 1);
            x += n.x * m;
            y += n.y * m;
        }
        const n = norm(x, y);
        if (Math.hypot(x, y) < 0.01) return { x: 0, y: 0 };
        return { x: n.x, y: n.y };
    }

    // ====== Spawning ======
    function spawnEnemy(type) {
        const ang = rand(0, TAU);
        const r = rand(WORLD.spawnRadius * 0.8, WORLD.spawnRadius);
        const x = player.x + Math.cos(ang) * r;
        const y = player.y + Math.sin(ang) * r;

        // difficulty scaling
        const t = elapsed;
        const hpMul = 1 + t / 70;
        const spMul = 1 + t / 220;

        const base = (type === 'runner')
            ? { r: 12, hp: 24, sp: 120, dmg: 8 }
            : { r: 14, hp: 34, sp: 78, dmg: 10 };

        enemies.push({
            x, y,
            r: base.r,
            hp: base.hp * hpMul,
            hpMax: base.hp * hpMul,
            sp: base.sp * spMul,
            dmg: base.dmg * (1 + t / 240),
            type,
            hitCD: 0,
            slow: 0,
        });
    }

    function spawnProjectile(p) {
        projectiles.push({
            ...p,
            hitSet: new Set(),
        });
    }

    function spawnPickup(x, y, kind, value) {
        pickups.push({ x, y, kind, value, r: kind === 'xp' ? 6 : 10, t: 0 });
    }

    // ====== Targeting ======
    function findNearestEnemy(x, y, maxD) {
        let best = null;
        let bd = maxD ?? Infinity;
        for (const e of enemies) {
            const d = dist(x, y, e.x, e.y);
            if (d < bd) { bd = d; best = e; }
        }
        return best;
    }

    // ====== Level up choices ======
    let currentChoices = [];
    function openLevelUp() {
        inLevelUp = true;
        paused = true;
        overlay.classList.remove('hidden');
        currentChoices = rollChoices(3);
        renderChoices(currentChoices);
    }
    function closeLevelUp() {
        inLevelUp = false;
        paused = false;
        overlay.classList.add('hidden');
    }

    function rollChoices(n) {
        const pool = [];

        // weapons (add new or upgrade existing)
        for (const [k, def] of Object.entries(WEAPON_DEFS)) {
            const lvl = weaponLevel(k);
            if (lvl === 0) {
                pool.push({ kind: 'weapon_add', key: k, name: def.display, tag: def.tag, desc: def.desc(1) });
            } else if (lvl < def.max) {
                pool.push({ kind: 'weapon_up', key: k, name: def.display, tag: def.tag, desc: def.desc(lvl + 1) });
            }
        }

        // passives
        for (const [k, def] of Object.entries(PASSIVES)) {
            pool.push({ kind: 'passive', key: k, name: def.display, tag: def.tag, desc: def.desc() });
        }

        // small luck: bias toward upgrading existing weapons
        pool.sort(() => Math.random() - 0.5);
        if (player.luck > 0) {
            pool.sort((a, b) => {
                const aw = a.kind.includes('weapon') ? -player.luck * 0.02 : 0;
                const bw = b.kind.includes('weapon') ? -player.luck * 0.02 : 0;
                return aw - bw + (Math.random() - 0.5) * 0.2;
            });
        }

        const res = [];
        const used = new Set();
        while (res.length < n && pool.length) {
            const pick = pool.splice(irand(0, pool.length - 1), 1)[0];
            const id = `${pick.kind}:${pick.key}`;
            if (used.has(id)) continue;
            used.add(id);
            res.push(pick);
        }
        // fallback
        while (res.length < n) res.push({ kind: 'passive', key: 'dmg', name: PASSIVES.dmg.display, tag: PASSIVES.dmg.tag, desc: PASSIVES.dmg.desc() });
        return res;
    }

    function renderChoices(list) {
        choicesEl.innerHTML = '';
        list.forEach((c, idx) => {
            const div = document.createElement('div');
            div.className = 'choice';
            div.innerHTML = `
        <div class="t">
          <div class="name">${idx + 1}. ${escapeHtml(c.name)}</div>
          <div class="tag">${escapeHtml(c.tag)}</div>
        </div>
        <div class="desc">${escapeHtml(c.desc)}</div>
      `;
            div.addEventListener('click', () => chooseUpgrade(idx));
            choicesEl.appendChild(div);
        });
    }

    function chooseUpgrade(i) {
        if (!inLevelUp) return;
        const c = currentChoices[i];
        if (!c) return;

        if (c.kind === 'weapon_add') addWeapon(c.key);
        if (c.kind === 'weapon_up') upgradeWeapon(c.key);
        if (c.kind === 'passive') PASSIVES[c.key].apply();

        closeLevelUp();
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }

    // ====== Game flow ======
    function resetRun() {
        enemies.length = 0;
        projectiles.length = 0;
        pickups.length = 0;
        fx.length = 0;

        player.x = 0; player.y = 0;
        player.hpMax = 100;
        player.hp = 100;
        player.baseSpeed = 220;
        player.speedMul = 1;
        player.armor = 0;
        player.regen = 0;
        player.magnet = 1;
        player.iFrames = 0;
        player.dash.cd = 0;
        player.dash.duration = 0;

        player.xp = 0;
        player.level = 1;
        player.nextXp = 10;

        player.dmgMul = 1;
        player.areaMul = 1;
        player.cdMul = 1;
        player.projSpeedMul = 1;
        player.luck = 0;

        weapons.clear();
        addWeapon('knife'); // 默认武器

        kills = 0;
        elapsed = 0;
        paused = false;
        inLevelUp = false;
        gameOver = false;

        overlay.classList.add('hidden');
    }

    function startGame() {
        menu.classList.add('hidden');
        resetRun();
    }

    startBtn.addEventListener('click', startGame);

    function togglePause() {
        if (inLevelUp) return;
        paused = !paused;
    }

    function dash() {
        if (paused || inLevelUp || gameOver) return;
        if (player.dash.cd > 0) return;
        player.dash.duration = 0.18;
        player.dash.cd = 1.0;
    }

    // ====== Combat helpers ======
    function dealDamageToEnemy(e, dmg) {
        e.hp -= dmg;
        fx.push({ x: e.x, y: e.y, t: 0, kind: 'hit' });
        if (e.hp <= 0) {
            kills++;
            // drop XP
            const amount = (Math.random() < 0.08) ? 6 : (Math.random() < 0.35 ? 3 : 1);
            spawnPickup(e.x, e.y, 'xp', amount);
            // small chance heal orb
            if (Math.random() < 0.02) spawnPickup(e.x, e.y, 'heal', 18);
            // remove
            const idx = enemies.indexOf(e);
            if (idx >= 0) enemies.splice(idx, 1);
        }
    }

    function hurtPlayer(dmg) {
        if (player.iFrames > 0) return;
        const final = Math.max(1, dmg - player.armor);
        player.hp -= final;
        player.iFrames = 0.45;
        fx.push({ x: player.x, y: player.y, t: 0, kind: 'hurt' });
        if (player.hp <= 0) {
            player.hp = 0;
            gameOver = true;
            paused = true;

            // record best time
            if (elapsed > (SAVE.bestTime || 0)) {
                SAVE.bestTime = elapsed;
                saveToDisk(SAVE);
            }
            // show menu again
            setTimeout(() => {
                menu.classList.remove('hidden');
                menu.querySelector('p.muted').textContent =
                    `上次存活：${fmtTime(elapsed)} · 最佳：${fmtTime(SAVE.bestTime || 0)} · 击杀：${kills}`;
            }, 300);
        }
    }

    // ====== Main update ======
    let spawnAcc = 0;
    let last = performance.now();
    let fpsAcc = 0, fpsFrames = 0;

    function step(dt) {
        elapsed += dt;

        // regen & timers
        player.hp = Math.min(player.hpMax, player.hp + player.regen * dt);
        player.iFrames = Math.max(0, player.iFrames - dt);
        player.dash.cd = Math.max(0, player.dash.cd - dt);
        player.dash.duration = Math.max(0, player.dash.duration - dt);

        // movement
        const input = moveInput();
        const spBase = player.baseSpeed * player.speedMul;
        const dashMul = player.dash.duration > 0 ? player.dash.mult : 1;
        player.x += input.x * spBase * dashMul * dt;
        player.y += input.y * spBase * dashMul * dt;

        // camera follow
        cam.x += (player.x - cam.x) * (1 - Math.exp(-dt * 12));
        cam.y += (player.y - cam.y) * (1 - Math.exp(-dt * 12));

        // spawn enemies scaling
        // base spawn rate increases with time; also caps amount
        const cap = Math.floor(40 + elapsed * 0.65);
        const rate = 1.6 + elapsed / 35; // spawns per second
        spawnAcc += dt * rate;
        while (spawnAcc >= 1) {
            spawnAcc -= 1;
            if (enemies.length < cap) {
                const type = (Math.random() < 0.28 + elapsed / 240) ? 'runner' : 'walker';
                spawnEnemy(type);
            }
        }

        // update weapons
        for (const [k, st] of weapons.entries()) {
            WEAPON_DEFS[k]?.update(st, dt);
        }

        // update orbit weapon rendering/collision
        const orbitLvl = weaponLevel('orbit');
        if (orbitLvl > 0) {
            const count = 1 + Math.floor((orbitLvl - 1) / 2);
            const rad = 42 * player.areaMul;
            const angSpeed = (1.6 + orbitLvl * 0.08);
            for (let i = 0; i < count; i++) {
                const a = elapsed * angSpeed + (i / count) * TAU;
                const ox = player.x + Math.cos(a) * rad;
                const oy = player.y + Math.sin(a) * rad;
                // collision
                for (const e of enemies) {
                    if (dist(ox, oy, e.x, e.y) < e.r + 8) {
                        // per-frame damage scaled
                        dealDamageToEnemy(e, (10 + orbitLvl * 3) * player.dmgMul * dt * 7);
                    }
                }
            }
        }

        // update enemies
        const garlicLvl = weaponLevel('garlic');
        const garlicR = garlicLvl > 0 ? (58 + garlicLvl * 7) * player.areaMul : 0;
        for (let i = enemies.length - 1; i >= 0; i--) {
            const e = enemies[i];

            // despawn far away (avoid infinite growth)
            if (dist(e.x, e.y, player.x, player.y) > WORLD.despawnRadius) {
                enemies.splice(i, 1);
                continue;
            }

            const dx = player.x - e.x;
            const dy = player.y - e.y;
            const n = norm(dx, dy);

            // garlic aura damage + slight slow
            if (garlicLvl > 0 && n.l < garlicR) {
                const dmg = (8 + garlicLvl * 4) * player.dmgMul;
                dealDamageToEnemy(e, dmg * dt * 4.2);
                e.slow = Math.max(e.slow, 0.25);
            }

            const slowMul = 1 - clamp(e.slow, 0, 0.6);
            e.slow = Math.max(0, e.slow - dt * 0.8);

            e.x += n.x * e.sp * slowMul * dt;
            e.y += n.y * e.sp * slowMul * dt;

            // contact damage
            if (n.l < e.r + player.r) {
                e.hitCD = Math.max(0, e.hitCD - dt);
                if (e.hitCD <= 0) {
                    e.hitCD = 0.55;
                    hurtPlayer(e.dmg);
                }
            } else {
                e.hitCD = Math.max(0, e.hitCD - dt * 0.6);
            }
        }

        // update projectiles
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            p.ttl -= dt;
            if (p.ttl <= 0) { projectiles.splice(i, 1); continue; }

            // homing
            if (p.homing) {
                const t = findNearestEnemy(p.x, p.y, 520);
                if (t) {
                    const dx = t.x - p.x, dy = t.y - p.y;
                    const n = norm(dx, dy);
                    const steer = clamp(p.homing * dt, 0, 0.22);
                    const v = norm(p.vx, p.vy);
                    const nx = v.x * (1 - steer) + n.x * steer;
                    const ny = v.y * (1 - steer) + n.y * steer;
                    const nn = norm(nx, ny);
                    const sp = v.l;
                    p.vx = nn.x * sp;
                    p.vy = nn.y * sp;
                }
            }

            p.x += p.vx * dt;
            p.y += p.vy * dt;

            // collision
            for (const e of enemies) {
                const d = dist(p.x, p.y, e.x, e.y);
                if (d < p.r + e.r) {
                    if (p.hitSet.has(e)) continue;
                    p.hitSet.add(e);
                    dealDamageToEnemy(e, p.dmg);
                    e.slow = Math.max(e.slow, p.kind === 'wand' ? 0.18 : 0.08);

                    p.pierce -= 1;
                    if (p.pierce <= 0) break;
                }
            }
            if (p.pierce <= 0) projectiles.splice(i, 1);
        }

        // pickups (magnet)
        const magnetR = 90 * player.magnet;
        for (let i = pickups.length - 1; i >= 0; i--) {
            const g = pickups[i];
            g.t += dt;

            const d = dist(g.x, g.y, player.x, player.y);
            if (d < magnetR) {
                const n = norm(player.x - g.x, player.y - g.y);
                const sp = 220 + (magnetR - d) * 3.2;
                g.x += n.x * sp * dt;
                g.y += n.y * sp * dt;
            }

            if (d < player.r + g.r) {
                if (g.kind === 'xp') {
                    addXp(g.value);
                } else if (g.kind === 'heal') {
                    player.hp = Math.min(player.hpMax, player.hp + g.value);
                }
                pickups.splice(i, 1);
            }
        }

        // fx
        for (let i = fx.length - 1; i >= 0; i--) {
            fx[i].t += dt;
            if (fx[i].t > 0.35) fx.splice(i, 1);
        }
    }

    function addXp(v) {
        player.xp += v;
        while (player.xp >= player.nextXp) {
            player.xp -= player.nextXp;
            player.level += 1;
            player.nextXp = Math.floor(10 + (player.level - 1) * 4.8);
            openLevelUp();
            // note: openLevelUp pauses; but we may have multiple levels. keep loop; choices will pop again after selection.
            break;
        }
    }

    // ====== Render ======
    function worldToScreen(x, y) {
        return {
            x: (x - cam.x) + W() / 2,
            y: (y - cam.y) + H() / 2
        };
    }

    function draw() {
        // background grid
        ctx.clearRect(0, 0, W(), H());
        drawBackground();

        // pickups
        for (const g of pickups) drawPickup(g);

        // projectiles
        for (const p of projectiles) drawProjectile(p);

        // enemies
        for (const e of enemies) drawEnemy(e);

        // orbit visuals
        drawOrbitVisuals();

        // player
        drawPlayer();

        // fx
        for (const f of fx) drawFx(f);
    }

    function drawBackground() {
        // subtle infinite grid
        const sx = W(), sy = H();
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(0, 0, sx, sy);

        const grid = 48;
        const ox = (-(cam.x % grid) + grid) % grid;
        const oy = (-(cam.y % grid) + grid) % grid;

        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        for (let x = ox; x < sx; x += grid) {
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x, sy);
            ctx.stroke();
        }
        for (let y = oy; y < sy; y += grid) {
            ctx.beginPath();
            ctx.moveTo(0, y); ctx.lineTo(sx, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawPlayer() {
        const p = worldToScreen(player.x, player.y);

        // garlic aura
        const garlicLvl = weaponLevel('garlic');
        if (garlicLvl > 0) {
            const r = (58 + garlicLvl * 7) * player.areaMul;
            ctx.save();
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, TAU);
            ctx.fillStyle = 'rgba(170,255,220,0.08)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(170,255,220,0.18)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
        }

        // player body
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, player.r, 0, TAU);
        ctx.fillStyle = player.iFrames > 0 ? 'rgba(255,204,102,0.92)' : 'rgba(255,255,255,0.92)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // direction indicator (based on movement)
        const mi = moveInput();
        if (Math.abs(mi.x) + Math.abs(mi.y) > 0.01) {
            ctx.strokeStyle = 'rgba(102,255,204,0.8)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + mi.x * 22, p.y + mi.y * 22);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawEnemy(e) {
        const p = worldToScreen(e.x, e.y);
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, e.r, 0, TAU);
        ctx.fillStyle = e.type === 'runner' ? 'rgba(255,120,120,0.92)' : 'rgba(255,180,120,0.92)';
        ctx.fill();
        // hp bar
        const w = e.r * 2.2, h = 4;
        const x = p.x - w / 2, y = p.y - e.r - 10;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(102,255,204,0.85)';
        ctx.fillRect(x, y, w * clamp(e.hp / e.hpMax, 0, 1), h);
        ctx.restore();
    }

    function drawProjectile(p) {
        const s = worldToScreen(p.x, p.y);
        ctx.save();
        ctx.beginPath();
        ctx.arc(s.x, s.y, p.r, 0, TAU);
        ctx.fillStyle = p.kind === 'wand' ? 'rgba(140,200,255,0.9)' : 'rgba(255,255,255,0.9)';
        ctx.fill();
        ctx.restore();
    }

    function drawPickup(g) {
        const s = worldToScreen(g.x, g.y);
        ctx.save();
        if (g.kind === 'xp') {
            ctx.beginPath();
            ctx.arc(s.x, s.y, g.r, 0, TAU);
            ctx.fillStyle = 'rgba(102,255,204,0.85)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.18)';
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(s.x, s.y, g.r, 0, TAU);
            ctx.fillStyle = 'rgba(255,204,102,0.88)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.18)';
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawFx(f) {
        const s = worldToScreen(f.x, f.y);
        const a = 1 - f.t / 0.35;
        ctx.save();
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 10 + f.t * 30, 0, TAU);
        ctx.strokeStyle = f.kind === 'hurt' ? 'rgba(255,107,107,0.9)' : 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }

    function drawOrbitVisuals() {
        const lvl = weaponLevel('orbit');
        if (lvl <= 0) return;
        const count = 1 + Math.floor((lvl - 1) / 2);
        const rad = 42 * player.areaMul;
        const angSpeed = (1.6 + lvl * 0.08);
        const center = worldToScreen(player.x, player.y);

        ctx.save();
        ctx.strokeStyle = 'rgba(140,200,255,0.18)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(center.x, center.y, rad, 0, TAU);
        ctx.stroke();

        for (let i = 0; i < count; i++) {
            const a = elapsed * angSpeed + (i / count) * TAU;
            const ox = center.x + Math.cos(a) * rad;
            const oy = center.y + Math.sin(a) * rad;
            ctx.beginPath();
            ctx.arc(ox, oy, 7, 0, TAU);
            ctx.fillStyle = 'rgba(140,200,255,0.92)';
            ctx.fill();
        }
        ctx.restore();
    }

    // ====== HUD ======
    function updateHUD(dt) {
        hud.time.textContent = fmtTime(elapsed);
        hud.level.textContent = String(player.level);
        hud.hp.textContent = `${Math.round(player.hp)} / ${Math.round(player.hpMax)}`;
        hud.kills.textContent = String(kills);
        hud.enemies.textContent = String(enemies.length);

        const pct = clamp(player.xp / player.nextXp, 0, 1) * 100;
        hud.xpfill.style.width = `${pct}%`;
        hud.xptxt.textContent = `XP ${Math.floor(player.xp)} / ${player.nextXp}`;

        fpsAcc += dt; fpsFrames++;
        if (fpsAcc >= 0.4) {
            hud.fps.textContent = String(Math.round(fpsFrames / fpsAcc));
            fpsAcc = 0; fpsFrames = 0;
        }
    }

    function fmtTime(sec) {
        sec = Math.max(0, sec);
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }

    // ====== Main loop ======
    function loop(now) {
        const dt = Math.min(0.033, (now - last) / 1000);
        last = now;

        if (!paused && !inLevelUp && !gameOver && menu.classList.contains('hidden')) {
            step(dt);
        }
        draw();
        updateHUD(dt);

        // if leveled up and user chose, we may have leftover xp that triggers again
        if (!inLevelUp && !paused && !gameOver && player.xp >= player.nextXp) {
            addXp(0);
        }

        requestAnimationFrame(loop);
    }

    // ====== Boot ======
    function init() {
        resize();
        resetRun();

        // Show menu best time
        menu.querySelector('p.muted').textContent =
            `移动躲怪 · 自动攻击 · 吃经验升级 · 三选一成长（最佳：${fmtTime(SAVE.bestTime || 0)}）`;

        if (isTouch) mobile.classList.remove('hidden');

        // auto start if you want:
        // startGame();
    }

    init();
    requestAnimationFrame((t) => { last = t; loop(t); });

})();