(() => {
    // ====== Canvas / DPI ======
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    const minimapCanvas = document.getElementById('minimap');
    const minimapCtx = minimapCanvas.getContext('2d');

    function resize() {
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = Math.floor(canvas.clientWidth * dpr);
        canvas.height = Math.floor(canvas.clientHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const miniDpr = Math.max(1, window.devicePixelRatio || 1);
        const miniW = Math.max(80, minimapCanvas.clientWidth);
        const miniH = Math.max(80, minimapCanvas.clientHeight);
        minimapCanvas.width = Math.floor(miniW * miniDpr);
        minimapCanvas.height = Math.floor(miniH * miniDpr);
        minimapCtx.setTransform(miniDpr, 0, 0, miniDpr, 0, 0);
    }
    window.addEventListener('resize', resize);

    // ====== UI refs ======
    const hud = {
        time: document.getElementById('time'),
        level: document.getElementById('level'),
        hp: document.getElementById('hp'),
        hpfill: document.getElementById('hpfill'),
        kills: document.getElementById('kills'),
        enemies: document.getElementById('enemies'),
        fps: document.getElementById('fps'),
        combo: document.getElementById('combo'),
        rage: document.getElementById('rage'),
        crit: document.getElementById('crit'),
        xpfill: document.getElementById('xpfill'),
        xptxt: document.getElementById('xptxt'),
        event: document.getElementById('event'),
    };

    const overlay = document.getElementById('overlay');
    const ovTitle = document.getElementById('ovTitle');
    const rewardCinematic = document.getElementById('rewardCinematic');
    const choicesEl = document.getElementById('choices');
    const hudRoot = document.getElementById('hud');
    const minimapWrapEl = document.getElementById('minimapWrap');
    const menu = document.getElementById('menu');
    const startBtn = document.getElementById('startBtn');
    const howBtn = document.getElementById('howBtn');
    const resetBtn = document.getElementById('resetBtn');
    const soundBtn = document.getElementById('soundBtn');
    const musicBtn = document.getElementById('musicBtn');
    const volumeRange = document.getElementById('volumeRange');
    const volumeTxt = document.getElementById('volumeTxt');
    const howBox = document.getElementById('how');
    const diffRow = document.getElementById('diffRow');
    const diffBtns = [...document.querySelectorAll('.diffBtn')];
    const menuDesc = menu.querySelector('p.muted');

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
    const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
    const norm = (x, y) => {
        const l = Math.hypot(x, y) || 1;
        return { x: x / l, y: y / l, l };
    };
    const shuffle = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = (Math.random() * (i + 1)) | 0;
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    };

    // ====== Audio / SFX / BGM ======
    function loadSfxEnabled() {
        try {
            const raw = localStorage.getItem('survivors_sfx_enabled_v1');
            if (raw === null) return true;
            return raw !== '0';
        } catch {
            return true;
        }
    }

    function loadBgmEnabled() {
        try {
            const raw = localStorage.getItem('survivors_bgm_enabled_v1');
            if (raw === null) return true;
            return raw !== '0';
        } catch {
            return true;
        }
    }

    function loadMasterVolume() {
        try {
            const raw = localStorage.getItem('survivors_master_volume_v1');
            if (raw === null) return 1;
            const n = Number(raw);
            if (!Number.isFinite(n)) return 1;
            return clamp(n, 0, 2);
        } catch {
            return 1;
        }
    }

    const AUDIO = {
        supported: !!(window.AudioContext || window.webkitAudioContext),
        ctx: null,
        master: null,
        masterVolume: loadMasterVolume(),
    };

    const SFX = {
        supported: AUDIO.supported,
        enabled: loadSfxEnabled(),
        volume: 0.34,
        bus: null,
        last: Object.create(null),
    };

    const BGM = {
        enabled: loadBgmEnabled(),
        volume: 0.38,
        bus: null,
        mode: 'none', // none | file | synth
        audioEl: null,
        fileUrl: 'assets/bgm.mp3',
        fileChecked: false,
        fileAvailable: false,
        fileProbe: null,
        synthTimer: 0,
        synthNextAt: 0,
        synthStep: 0,
    };

    const BGM_SYNTH = {
        stepSec: 0.25,
        lookAheadSec: 0.45,
        tickMs: 90,
        chords: [
            [45, 52, 57],
            [41, 48, 53],
            [43, 50, 55],
            [40, 47, 52],
        ],
        melody: [0, 2, 3, 2, 5, 3, 2, 0],
    };

    function updateSoundBtnText() {
        if (!soundBtn) return;
        if (!SFX.supported) {
            soundBtn.textContent = '音效：不支持';
            soundBtn.disabled = true;
            return;
        }
        soundBtn.disabled = false;
        soundBtn.textContent = `音效：${SFX.enabled ? '开' : '关'}`;
    }

    function updateMusicBtnText() {
        if (!musicBtn) return;
        musicBtn.disabled = false;
        musicBtn.textContent = `音乐：${BGM.enabled ? '开' : '关'}`;
    }

    function updateVolumeUi() {
        const pct = Math.round(clamp(AUDIO.masterVolume, 0, 2) * 100);
        if (volumeRange) volumeRange.value = String(pct);
        if (volumeTxt) volumeTxt.textContent = `${pct}%`;
    }

    function bgmElementVolume() {
        return clamp(BGM.volume * AUDIO.masterVolume, 0, 1);
    }

    function applyAudioMix() {
        if (AUDIO.master) AUDIO.master.gain.value = AUDIO.masterVolume;
        if (SFX.bus) SFX.bus.gain.value = SFX.enabled ? SFX.volume : 0;
        if (BGM.bus) BGM.bus.gain.value = BGM.enabled ? BGM.volume : 0;
        if (BGM.audioEl) BGM.audioEl.volume = bgmElementVolume();
    }

    function setMasterVolume(v, persist = true) {
        const n = clamp(Number(v) || 0, 0, 2);
        AUDIO.masterVolume = n;
        if (persist) {
            try {
                localStorage.setItem('survivors_master_volume_v1', String(n));
            } catch {}
        }
        applyAudioMix();
        updateVolumeUi();
    }

    function ensureAudio() {
        if (!AUDIO.supported) return null;
        if (AUDIO.ctx) return AUDIO.ctx;
        const Ctor = window.AudioContext || window.webkitAudioContext;
        AUDIO.ctx = new Ctor();
        AUDIO.master = AUDIO.ctx.createGain();
        AUDIO.master.gain.value = AUDIO.masterVolume;
        AUDIO.master.connect(AUDIO.ctx.destination);

        SFX.bus = AUDIO.ctx.createGain();
        SFX.bus.gain.value = SFX.enabled ? SFX.volume : 0;
        SFX.bus.connect(AUDIO.master);

        BGM.bus = AUDIO.ctx.createGain();
        BGM.bus.gain.value = BGM.enabled ? BGM.volume : 0;
        BGM.bus.connect(AUDIO.master);
        applyAudioMix();
        return AUDIO.ctx;
    }

    function unlockAudio() {
        const audioCtx = ensureAudio();
        if (!audioCtx) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }

    function setSfxEnabled(v) {
        SFX.enabled = !!v;
        try {
            localStorage.setItem('survivors_sfx_enabled_v1', SFX.enabled ? '1' : '0');
        } catch {}
        updateSoundBtnText();
        applyAudioMix();
    }

    function stopSynthBgm() {
        if (BGM.synthTimer) {
            clearInterval(BGM.synthTimer);
            BGM.synthTimer = 0;
        }
    }

    function stopFileBgm(resetPos = false) {
        if (!BGM.audioEl) return;
        BGM.audioEl.pause();
        if (resetPos) BGM.audioEl.currentTime = 0;
    }

    function stopBgm(resetPos = false) {
        stopSynthBgm();
        stopFileBgm(resetPos);
        BGM.mode = 'none';
    }

    function setBgmEnabled(v) {
        BGM.enabled = !!v;
        try {
            localStorage.setItem('survivors_bgm_enabled_v1', BGM.enabled ? '1' : '0');
        } catch {}
        updateMusicBtnText();
        applyAudioMix();
        if (!BGM.enabled) {
            stopBgm(true);
            return;
        }
        unlockAudio();
        startBgm();
    }

    function probeBgmFile() {
        if (BGM.fileChecked) return Promise.resolve(BGM.fileAvailable);
        if (BGM.fileProbe) return BGM.fileProbe;
        BGM.fileProbe = (async () => {
            let ok = false;
            try {
                const head = await fetch(BGM.fileUrl, { method: 'HEAD', cache: 'no-store' });
                ok = head.ok;
                if (!ok && head.status === 405) {
                    const probe = await fetch(BGM.fileUrl, {
                        method: 'GET',
                        cache: 'no-store',
                        headers: { Range: 'bytes=0-0' },
                    });
                    ok = probe.ok || probe.status === 206;
                }
            } catch {}
            BGM.fileAvailable = ok;
            BGM.fileChecked = true;
            BGM.fileProbe = null;
            return ok;
        })();
        return BGM.fileProbe;
    }

    function ensureBgmAudioElement() {
        if (BGM.audioEl) return BGM.audioEl;
        if (typeof Audio === 'undefined') return null;
        const a = new Audio(BGM.fileUrl);
        a.loop = true;
        a.preload = 'auto';
        a.volume = bgmElementVolume();
        a.addEventListener('error', () => {
            BGM.fileChecked = true;
            BGM.fileAvailable = false;
            if (!BGM.enabled || BGM.mode !== 'file') return;
            stopFileBgm(false);
            BGM.mode = 'none';
            startSynthBgm();
        });
        BGM.audioEl = a;
        return a;
    }

    function startFileBgm() {
        if (!BGM.enabled) return false;
        const a = ensureBgmAudioElement();
        if (!a) return false;
        stopSynthBgm();
        BGM.mode = 'file';
        a.volume = bgmElementVolume();
        const playPromise = a.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
                if (!BGM.enabled || BGM.mode !== 'file') return;
                stopFileBgm(false);
                BGM.mode = 'none';
                startSynthBgm();
            });
        }
        return true;
    }

    function midiToFreq(midi) {
        return 440 * 2 ** ((midi - 69) / 12);
    }

    function bgmTone(start, {
        freq = 440,
        dur = 0.2,
        type = 'sine',
        gain = 0.012,
        attack = 0.01,
        release = 0.12,
    } = {}) {
        if (!BGM.enabled || BGM.mode !== 'synth') return;
        const audioCtx = ensureAudio();
        if (!audioCtx || !BGM.bus) return;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(Math.max(20, freq), start);
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur + release);
        osc.connect(g);
        g.connect(BGM.bus);
        osc.start(start);
        osc.stop(start + dur + release + 0.02);
    }

    function scheduleSynthStep(start, step) {
        const chord = BGM_SYNTH.chords[Math.floor(step / 8) % BGM_SYNTH.chords.length];
        const local = step % 8;

        if (local === 0) {
            for (let i = 0; i < chord.length; i++) {
                bgmTone(start, {
                    freq: midiToFreq(chord[i] + 12),
                    dur: BGM_SYNTH.stepSec * 7.6,
                    gain: 0.006 + i * 0.0026,
                    type: 'sine',
                    attack: 0.03,
                    release: 0.14,
                });
            }
        }

        if (local % 2 === 0) {
            bgmTone(start, {
                freq: midiToFreq(chord[0] - 12),
                dur: BGM_SYNTH.stepSec * 1.9,
                gain: 0.017,
                type: 'triangle',
                attack: 0.008,
                release: 0.09,
            });
        }

        const leadMidi = chord[2] + 12 + BGM_SYNTH.melody[local];
        bgmTone(start + 0.02, {
            freq: midiToFreq(leadMidi),
            dur: BGM_SYNTH.stepSec * 0.82,
            gain: 0.0125,
            type: 'triangle',
            attack: 0.006,
            release: 0.06,
        });
    }

    function pumpSynthBgm() {
        if (!BGM.enabled || BGM.mode !== 'synth') return;
        const audioCtx = ensureAudio();
        if (!audioCtx) return;
        while (BGM.synthNextAt < audioCtx.currentTime + BGM_SYNTH.lookAheadSec) {
            scheduleSynthStep(BGM.synthNextAt, BGM.synthStep);
            BGM.synthStep += 1;
            BGM.synthNextAt += BGM_SYNTH.stepSec;
        }
    }

    function startSynthBgm() {
        if (!BGM.enabled) return false;
        const audioCtx = ensureAudio();
        if (!audioCtx || !BGM.bus) return false;
        stopFileBgm(false);
        stopSynthBgm();
        BGM.mode = 'synth';
        BGM.synthStep = 0;
        BGM.synthNextAt = audioCtx.currentTime + 0.05;
        BGM.synthTimer = window.setInterval(pumpSynthBgm, BGM_SYNTH.tickMs);
        pumpSynthBgm();
        return true;
    }

    function startBgm() {
        if (!BGM.enabled || BGM.mode !== 'none') return;
        if (BGM.fileChecked && BGM.fileAvailable) {
            if (startFileBgm()) return;
        }
        const synthStarted = startSynthBgm();
        if (!synthStarted && (!BGM.fileChecked || BGM.fileAvailable)) {
            startFileBgm();
        }
    }

    function sfxThrottle(tag, gapMs) {
        const now = performance.now();
        const prev = SFX.last[tag] || 0;
        if (now - prev < gapMs) return false;
        SFX.last[tag] = now;
        return true;
    }

    function toneAt(start, {
        freq = 440,
        dur = 0.06,
        type = 'triangle',
        gain = 0.05,
        attack = 0.004,
        release = 0.08,
        slide = 0,
    } = {}) {
        if (!SFX.enabled) return;
        const audioCtx = ensureAudio();
        if (!audioCtx || !SFX.bus) return;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(Math.max(20, freq), start);
        if (slide) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), start + dur);
        }
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur + release);
        osc.connect(g);
        g.connect(SFX.bus);
        osc.start(start);
        osc.stop(start + dur + release + 0.01);
    }

    function playSfx(tag) {
        if (!SFX.supported || !SFX.enabled) return;
        const ctx = ensureAudio();
        if (!ctx) return;
        const t = ctx.currentTime;

        if (tag === 'dash') {
            if (!sfxThrottle('dash', 80)) return;
            toneAt(t, { freq: 220, dur: 0.07, gain: 0.045, slide: 280, type: 'sawtooth' });
            return;
        }
        if (tag === 'hurt') {
            if (!sfxThrottle('hurt', 110)) return;
            toneAt(t, { freq: 150, dur: 0.08, gain: 0.06, slide: -55, type: 'square' });
            return;
        }
        if (tag === 'kill') {
            if (!sfxThrottle('kill', 28)) return;
            toneAt(t, { freq: 320 + rand(-22, 26), dur: 0.03, gain: 0.03, slide: -90, type: 'triangle' });
            return;
        }
        if (tag === 'crit') {
            if (!sfxThrottle('crit', 55)) return;
            toneAt(t, { freq: 560, dur: 0.05, gain: 0.055, slide: 220, type: 'triangle' });
            toneAt(t + 0.03, { freq: 760, dur: 0.05, gain: 0.042, slide: 180, type: 'sine' });
            return;
        }
        if (tag === 'xp') {
            if (!sfxThrottle('xp', 40)) return;
            toneAt(t, { freq: 420 + rand(-30, 25), dur: 0.035, gain: 0.026, slide: 70, type: 'sine' });
            return;
        }
        if (tag === 'levelup') {
            if (!sfxThrottle('levelup', 120)) return;
            toneAt(t, { freq: 390, dur: 0.06, gain: 0.045, slide: 80, type: 'triangle' });
            toneAt(t + 0.055, { freq: 520, dur: 0.07, gain: 0.05, slide: 120, type: 'triangle' });
            toneAt(t + 0.11, { freq: 690, dur: 0.08, gain: 0.055, slide: 160, type: 'sine' });
            return;
        }
        if (tag === 'chest') {
            if (!sfxThrottle('chest', 160)) return;
            toneAt(t, { freq: 260, dur: 0.07, gain: 0.055, slide: 40, type: 'square' });
            toneAt(t + 0.06, { freq: 420, dur: 0.08, gain: 0.055, slide: 90, type: 'triangle' });
            toneAt(t + 0.11, { freq: 620, dur: 0.09, gain: 0.05, slide: 120, type: 'sine' });
            return;
        }
        if (tag === 'rage_on') {
            if (!sfxThrottle('rage_on', 260)) return;
            toneAt(t, { freq: 170, dur: 0.12, gain: 0.07, slide: 80, type: 'sawtooth' });
            toneAt(t + 0.06, { freq: 290, dur: 0.12, gain: 0.065, slide: 170, type: 'sawtooth' });
            toneAt(t + 0.13, { freq: 470, dur: 0.15, gain: 0.06, slide: 240, type: 'triangle' });
            return;
        }
        if (tag === 'evolve') {
            if (!sfxThrottle('evolve', 320)) return;
            toneAt(t, { freq: 300, dur: 0.12, gain: 0.065, slide: 150, type: 'triangle' });
            toneAt(t + 0.09, { freq: 510, dur: 0.15, gain: 0.06, slide: 220, type: 'sine' });
            toneAt(t + 0.19, { freq: 760, dur: 0.17, gain: 0.055, slide: 330, type: 'sine' });
            return;
        }
        if (tag === 'boss') {
            if (!sfxThrottle('boss', 300)) return;
            toneAt(t, { freq: 120, dur: 0.2, gain: 0.07, slide: -20, type: 'sawtooth' });
            toneAt(t + 0.14, { freq: 90, dur: 0.18, gain: 0.06, slide: -15, type: 'square' });
        }
    }

    soundBtn?.addEventListener('click', () => {
        setSfxEnabled(!SFX.enabled);
        if (SFX.enabled) unlockAudio();
    });
    musicBtn?.addEventListener('click', () => {
        setBgmEnabled(!BGM.enabled);
    });
    volumeRange?.addEventListener('input', () => {
        setMasterVolume(Number(volumeRange.value) / 100, false);
    });
    volumeRange?.addEventListener('change', () => {
        setMasterVolume(Number(volumeRange.value) / 100, true);
    });
    const unlockAudioAndMusic = () => {
        unlockAudio();
        if (BGM.enabled) startBgm();
    };
    window.addEventListener('pointerdown', unlockAudioAndMusic, { passive: true });
    window.addEventListener('touchstart', unlockAudioAndMusic, { passive: true });
    window.addEventListener('keydown', unlockAudioAndMusic);
    updateSoundBtnText();
    updateMusicBtnText();
    updateVolumeUi();
    probeBgmFile();

    // ====== World settings ======
    const W = () => canvas.clientWidth;
    const H = () => canvas.clientHeight;

    const WORLD = {
        spawnRadius: 560,
        despawnRadius: 980,
        obstacleChunk: 560,
        obstacleRange: 2,
        minimapRange: 1050,
    };

    const LANDMARKS = [
        { id: 'altar', name: '遗忘祭坛', x: 720, y: -420, r: 54, type: 'altar', solid: true },
        { id: 'ruins', name: '古旧遗迹', x: -860, y: 390, r: 62, type: 'ruin', solid: true },
        { id: 'spire', name: '黑石尖碑', x: 1060, y: 220, r: 58, type: 'spire', solid: true },
        { id: 'gate', name: '迷雾门', x: -1120, y: -760, r: 66, type: 'gate', solid: true },
        { id: 'well', name: '月井', x: 260, y: 1090, r: 52, type: 'well', solid: true },
    ];
    const discoveredLandmarks = new Set();

    // ====== Config / Mechanics ======
    const CONFIG = {
        limits: {
            maxCritChance: 0.4,
        },
        combo: {
            baseWindow: 1.2,
            xpPerStack: 0.02,
            xpMulCap: 2.3,
            rageGainPerStack: 0.05,
            rageGainPerStackCap: 1.2,
            explosionEvery: 5,
            bigDropEvery: 15,
            smallExplosionRadius: 88,
            smallExplosionDamage: 72,
            smallBonusXp: 5,
            bigExplosionRadius: 130,
            bigExplosionDamage: 145,
            bigBonusXp: 16,
            critBuffOnBig: 0.05,
            critBuffDuration: 4,
            shakeOnBig: { mag: 8, duration: 0.18 },
        },
        rage: {
            gainFromKill: 7.2,
            gainFromDamage: 4.4,
            gainFromDamageBase: 0.65,
            gainFromDamagePerPoint: 0.06,
            passiveDecayRate: 2.8,
            shakePulseMag: 2.4,
            shakePulseDuration: 0.06,
            activateShake: { mag: 7, duration: 0.2 },
        },
        crit: {
            baseChance: 0.08,
            baseMultiplier: 1.8,
            rageBonusChance: 0.07,
            damageTextChance: 0.34,
        },
        progression: {
            xpBase: 10,
            xpGrowthPerLevel: 4.8,
        },
        difficulty: {
            blast: {
                label: '爽爆',
                comboTimerMul: 1.5,
                comboRewardMul: 1.45,
                rageGainMul: 1.5,
                rageDuration: 7.8,
                rageDamageMul: 1.46,
                rageFireRateMul: 1.42,
                rageSpeedMul: 1.12,
                critBonus: 0.05,
                initialWeapons: ['spray'],
                xpBaseMul: 0.9,
                xpGrowthMul: 0.88,
                xpGainMul: 0.2,
                enemyHpGrowthMul: 0.86,
                enemySpeedGrowthMul: 0.88,
                enemyDmgGrowthMul: 0.9,
                spawnRateMul: 0.9,
                levelChoiceStep: 1,
            },
            normal: {
                label: '中等',
                comboTimerMul: 1.075,
                comboRewardMul: 1.0675,
                rageGainMul: 1.075,
                rageDuration: 6.44,
                rageDamageMul: 1.375,
                rageFireRateMul: 1.335,
                rageSpeedMul: 1.103,
                critBonus: 0.0075,
                initialWeapons: [],
                xpBaseMul: 0.985,
                xpGrowthMul: 0.982,
                xpGainMul: 1,
                enemyHpGrowthMul: 0.979,
                enemySpeedGrowthMul: 0.982,
                enemyDmgGrowthMul: 0.985,
                spawnRateMul: 0.985,
                levelChoiceStep: 1,
            },
            hard: {
                label: '困难',
                comboTimerMul: 0.7,
                comboRewardMul: 0.84,
                rageGainMul: 0.7,
                rageDuration: 5.1,
                rageDamageMul: 1.3,
                rageFireRateMul: 1.26,
                rageSpeedMul: 1.08,
                critBonus: -0.03,
                initialWeapons: [],
                xpBaseMul: 1.12,
                xpGrowthMul: 1.2,
                xpGainMul: 1,
                enemyHpGrowthMul: 1.12,
                enemySpeedGrowthMul: 1.18,
                enemyDmgGrowthMul: 1.08,
                spawnRateMul: 1.12,
                levelChoiceStep: 1,
            },
        },
    };

    // ====== Save / meta progression ======
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

    function loadDifficulty() {
        const key = localStorage.getItem('survivors_difficulty_v1') || 'normal';
        if (CONFIG.difficulty[key]) return key;
        return 'normal';
    }

    let difficultyKey = loadDifficulty();
    let difficulty = CONFIG.difficulty[difficultyKey];

    // ====== Player / state ======
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

        dmgMul: 1,
        areaMul: 1,
        cdMul: 1,
        projSpeedMul: 1,
        luck: 0,
        critChance: 0,
        critMultiplier: CONFIG.crit.baseMultiplier,
    };

    const cam = { x: 0, y: 0 };

    const enemies = [];
    const projectiles = [];
    const pickups = [];
    const fx = [];

    let kills = 0;
    let elapsed = 0;
    let paused = false;
    let inReward = false;
    let rewardMode = 'none'; // none | level | chest
    let gameOver = false;
    let menuState = 'start'; // start | pause | gameover
    let lastRunSnapshot = { time: 0, kills: 0, level: 1, difficultyLabel: difficulty.label };

    let pendingLevelUps = 0;
    let pendingChestRewards = 0;
    let currentChoices = [];

    const rewardIntro = {
        active: false,
        timer: 0,
        duration: 0,
    };

    const cinematic = {
        flash: 0,
        text: '',
        textTTL: 0,
    };

    let spawnAcc = 0;
    let nextWaveAt = 30;
    let nextBossAt = 300;
    let waveCount = 0;

    const eventBanner = { text: '', ttl: 0, color: 'rgba(255,255,255,0.95)' };

    const combo = {
        count: 0,
        timer: 0,
        multiplier: 1,
        critBuff: 0,
        critBuffTimer: 0,
    };

    const rage = {
        value: 0,
        active: false,
        timer: 0,
        duration: 0,
    };

    const screenShake = {
        x: 0,
        y: 0,
        mag: 0,
        timer: 0,
    };

    function menuStartText() {
        return `移动躲怪 · 自动攻击 · 吃经验升级 · 三选一成长（难度：${difficulty.label} · 最佳：${fmtTime(SAVE.bestTime || 0)}）`;
    }

    function menuPauseText() {
        return `已暂停 · 存活：${fmtTime(elapsed)} · 等级：${player.level} · 击杀：${kills} · 难度：${difficulty.label}`;
    }

    function menuGameOverText() {
        return `上次存活：${fmtTime(lastRunSnapshot.time)} · 最佳：${fmtTime(SAVE.bestTime || 0)} · 击杀：${lastRunSnapshot.kills} · 难度：${lastRunSnapshot.difficultyLabel}`;
    }

    function updateMenuText() {
        if (!menuDesc) return;
        if (menuState === 'pause') {
            menuDesc.textContent = menuPauseText();
            return;
        }
        if (menuState === 'gameover') {
            menuDesc.textContent = menuGameOverText();
            return;
        }
        menuDesc.textContent = menuStartText();
    }

    function setMenuState(mode) {
        menuState = mode;
        menu.classList.remove('hidden');
        if (mode === 'pause') {
            startBtn.textContent = '继续';
        } else if (mode === 'gameover') {
            startBtn.textContent = '再来一局';
        } else {
            startBtn.textContent = '开始';
        }
        updateMenuText();
    }

    function resumeFromPauseMenu() {
        if (menuState !== 'pause' || gameOver) return;
        menu.classList.add('hidden');
        paused = false;
        menuState = 'start';
    }

    function setDifficulty(mode, save = true) {
        if (!CONFIG.difficulty[mode]) return;
        difficultyKey = mode;
        difficulty = CONFIG.difficulty[mode];
        if (save) localStorage.setItem('survivors_difficulty_v1', mode);
        diffBtns.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.diff === mode);
        });
        if (!menu.classList.contains('hidden')) {
            updateMenuText();
        }
    }

    diffRow?.addEventListener('click', (e) => {
        if (menuState === 'pause') return;
        const btn = e.target.closest('.diffBtn');
        if (!btn) return;
        setDifficulty(btn.dataset.diff);
    });
    setDifficulty(difficultyKey, false);

    function calcNextXp(level) {
        const base = CONFIG.progression.xpBase * difficulty.xpBaseMul;
        const growth = CONFIG.progression.xpGrowthPerLevel * difficulty.xpGrowthMul;
        return Math.max(8, Math.floor(base + (level - 1) * growth));
    }

    function addScreenShake(mag, duration) {
        screenShake.mag = Math.max(screenShake.mag, mag);
        screenShake.timer = Math.max(screenShake.timer, duration);
    }

    function resetCombo() {
        combo.count = 0;
        combo.timer = 0;
        combo.multiplier = 1;
    }

    function currentCritChance() {
        let chance = player.critChance;
        if (rage.active) chance += CONFIG.crit.rageBonusChance;
        if (combo.critBuffTimer > 0) chance += combo.critBuff;
        return clamp(chance, 0, CONFIG.limits.maxCritChance);
    }

    function currentRageDamageMul() {
        return rage.active ? difficulty.rageDamageMul : 1;
    }

    function currentFireRateMul() {
        return rage.active ? difficulty.rageFireRateMul : 1;
    }

    function currentMoveSpeedMul() {
        return rage.active ? difficulty.rageSpeedMul : 1;
    }

    function gainRage(rawAmount) {
        if (rage.active) return;
        const gain = rawAmount * difficulty.rageGainMul;
        rage.value = clamp(rage.value + gain, 0, 100);
        if (rage.value >= 100) {
            rage.active = true;
            rage.duration = difficulty.rageDuration;
            rage.timer = difficulty.rageDuration;
            rage.value = 100;
            announceEvent('RAGE MODE 激活！', 'rgba(255,130,120,0.98)', 2.4);
            cinematic.flash = Math.max(cinematic.flash, 0.32);
            addScreenShake(CONFIG.rage.activateShake.mag, CONFIG.rage.activateShake.duration);
            playSfx('rage_on');
        }
    }

    function updateComboAndRage(dt) {
        if (combo.timer > 0) {
            combo.timer -= dt;
            if (combo.timer <= 0) resetCombo();
        }
        if (combo.critBuffTimer > 0) {
            combo.critBuffTimer = Math.max(0, combo.critBuffTimer - dt);
            if (combo.critBuffTimer <= 0) combo.critBuff = 0;
        }

        if (rage.active) {
            rage.timer = Math.max(0, rage.timer - dt);
            rage.value = rage.duration > 0 ? (rage.timer / rage.duration) * 100 : 0;
            if (rage.timer <= 0) {
                rage.active = false;
                rage.value = 0;
                announceEvent('Rage 结束', 'rgba(255,180,150,0.95)', 1.2);
            } else if (Math.random() < 0.35) {
                addScreenShake(CONFIG.rage.shakePulseMag, CONFIG.rage.shakePulseDuration);
            }
        } else {
            rage.value = Math.max(0, rage.value - CONFIG.rage.passiveDecayRate * dt);
        }
    }

    function applyComboOnKill(x, y) {
        combo.count = combo.timer > 0 ? combo.count + 1 : 1;
        combo.timer = CONFIG.combo.baseWindow * difficulty.comboTimerMul;
        combo.multiplier = clamp(
            1 + combo.count * CONFIG.combo.xpPerStack * difficulty.comboRewardMul,
            1,
            CONFIG.combo.xpMulCap
        );

        gainRage(
            CONFIG.rage.gainFromKill +
            Math.min(CONFIG.combo.rageGainPerStackCap, combo.count * CONFIG.combo.rageGainPerStack)
        );

        if (combo.count % CONFIG.combo.explosionEvery === 0) {
            explodeAt(
                x,
                y,
                CONFIG.combo.smallExplosionRadius * player.areaMul,
                CONFIG.combo.smallExplosionDamage * difficulty.comboRewardMul * player.dmgMul,
                0.18,
                'combo_boom'
            );
            spawnPickup(x, y, 'xp', Math.round(CONFIG.combo.smallBonusXp * difficulty.comboRewardMul));
        }
        if (combo.count % CONFIG.combo.bigDropEvery === 0) {
            explodeAt(
                x,
                y,
                CONFIG.combo.bigExplosionRadius * player.areaMul,
                CONFIG.combo.bigExplosionDamage * difficulty.comboRewardMul * player.dmgMul,
                0.24,
                'combo_big'
            );
            spawnPickup(x, y, 'xp', Math.round(CONFIG.combo.bigBonusXp * difficulty.comboRewardMul));
            combo.critBuff = CONFIG.combo.critBuffOnBig;
            combo.critBuffTimer = CONFIG.combo.critBuffDuration;
            announceEvent(`连锁 ${combo.count}！暴击临时提升`, 'rgba(255,230,160,0.98)', 1.5);
            addScreenShake(CONFIG.combo.shakeOnBig.mag, CONFIG.combo.shakeOnBig.duration);
        }
    }

    // ====== Obstacles / map ======
    const obstacleChunks = new Map();

    function hash2(a, b) {
        let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
        h = (h ^ (h >>> 13)) | 0;
        h = Math.imul(h, 1274126177);
        return (h ^ (h >>> 16)) >>> 0;
    }

    function mulberry32(seed) {
        let t = seed >>> 0;
        return function rnd() {
            t += 0x6D2B79F5;
            let x = Math.imul(t ^ (t >>> 15), 1 | t);
            x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
            return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
        };
    }

    function prand(rnd, a, b) {
        return a + rnd() * (b - a);
    }

    function chunkKey(cx, cy) {
        return `${cx},${cy}`;
    }

    function generateChunkObstacles(cx, cy) {
        const rnd = mulberry32(hash2(cx + 11939, cy - 31847));
        const list = [];
        const count = 3 + Math.floor(rnd() * 6);

        for (let i = 0; i < count; i++) {
            const roll = rnd();
            const type = roll < 0.54 ? 'tree' : (roll < 0.82 ? 'wall' : 'river');
            const x = (cx + rnd()) * WORLD.obstacleChunk;
            const y = (cy + rnd()) * WORLD.obstacleChunk;
            if (dist(x, y, 0, 0) < 180) continue;

            const r = type === 'tree'
                ? prand(rnd, 20, 34)
                : type === 'wall'
                    ? prand(rnd, 30, 56)
                    : prand(rnd, 74, 126);

            let overlap = false;
            for (const o of list) {
                if (dist(x, y, o.x, o.y) < r + o.r + 26) {
                    overlap = true;
                    break;
                }
            }
            if (overlap) continue;

            list.push({
                x, y, r,
                type,
                solid: type !== 'river',
            });
        }
        return list;
    }

    function getChunkObstacles(cx, cy) {
        const key = chunkKey(cx, cy);
        if (!obstacleChunks.has(key)) {
            obstacleChunks.set(key, generateChunkObstacles(cx, cy));
        }
        return obstacleChunks.get(key);
    }

    function forNearbyObstacles(x, y, chunkRange, fn) {
        const cx = Math.floor(x / WORLD.obstacleChunk);
        const cy = Math.floor(y / WORLD.obstacleChunk);
        for (let oy = -chunkRange; oy <= chunkRange; oy++) {
            for (let ox = -chunkRange; ox <= chunkRange; ox++) {
                const chunk = getChunkObstacles(cx + ox, cy + oy);
                for (const ob of chunk) fn(ob);
            }
        }
    }

    function warmObstacleChunks(x, y) {
        forNearbyObstacles(x, y, WORLD.obstacleRange, () => {});
    }

    function terrainSlowMultiplier(x, y, radius) {
        let slow = 1;
        forNearbyObstacles(x, y, 1, (ob) => {
            if (ob.type !== 'river') return;
            if (dist(x, y, ob.x, ob.y) < ob.r + radius * 0.6) {
                slow = Math.min(slow, 0.62);
            }
        });
        return slow;
    }

    function resolveSolidCollisions(ent, radius) {
        forNearbyObstacles(ent.x, ent.y, 1, (ob) => {
            if (!ob.solid) return;
            const dx = ent.x - ob.x;
            const dy = ent.y - ob.y;
            const minD = radius + ob.r;
            const d = Math.hypot(dx, dy) || 0.0001;
            if (d >= minD) return;
            const push = (minD - d) + 0.1;
            ent.x += (dx / d) * push;
            ent.y += (dy / d) * push;
        });
        for (const lm of LANDMARKS) {
            if (!lm.solid) continue;
            const dx = ent.x - lm.x;
            const dy = ent.y - lm.y;
            const minD = radius + lm.r;
            const d = Math.hypot(dx, dy) || 0.0001;
            if (d >= minD) continue;
            const push = (minD - d) + 0.1;
            ent.x += (dx / d) * push;
            ent.y += (dy / d) * push;
        }
    }

    function isInsideSolidObstacle(x, y, radius) {
        let hit = false;
        forNearbyObstacles(x, y, 1, (ob) => {
            if (hit || !ob.solid) return;
            if (dist(x, y, ob.x, ob.y) < ob.r + radius) hit = true;
        });
        for (const lm of LANDMARKS) {
            if (hit || !lm.solid) continue;
            if (dist(x, y, lm.x, lm.y) < lm.r + radius) hit = true;
        }
        return hit;
    }

    function updateLandmarkDiscovery() {
        for (const lm of LANDMARKS) {
            if (discoveredLandmarks.has(lm.id)) continue;
            if (dist(player.x, player.y, lm.x, lm.y) > lm.r + 140) continue;
            discoveredLandmarks.add(lm.id);
            announceEvent(`发现地标：${lm.name}`, 'rgba(195,232,255,0.98)', 2.4);
            fx.push({ kind: 'landmark_ping', x: lm.x, y: lm.y, r: lm.r, t: 0, duration: 0.9 });
        }
    }

    // ====== Weapons system ======
    const weapons = new Map();
    const passiveLevels = new Map();

    function addWeapon(name) {
        if (weapons.has(name)) return;
        weapons.set(name, { lvl: 1, timer: 0 });
    }

    function weaponLevel(name) {
        return weapons.get(name)?.lvl || 0;
    }

    function upgradeWeapon(name) {
        if (!weapons.has(name)) addWeapon(name);
        const st = weapons.get(name);
        const max = WEAPON_DEFS[name]?.max ?? 8;
        st.lvl = Math.min(max, st.lvl + 1);
    }

    function passiveLevel(name) {
        return passiveLevels.get(name) || 0;
    }

    function applyPassive(name) {
        const def = PASSIVES[name];
        if (!def) return false;
        const lvl = passiveLevel(name);
        if (lvl >= def.max) return false;
        passiveLevels.set(name, lvl + 1);
        def.apply(lvl + 1);
        return true;
    }

    function auraProfile() {
        const evolved = weaponLevel('plague_core') > 0;
        const lvl = evolved ? 10 : weaponLevel('garlic');
        if (lvl <= 0) return null;
        if (evolved) {
            return {
                radius: 120 * player.areaMul,
                dps: 92 * player.dmgMul,
                slow: 0.38,
            };
        }
        return {
            radius: (58 + lvl * 7) * player.areaMul,
            dps: (8 + lvl * 4) * 4.2 * player.dmgMul,
            slow: 0.25,
        };
    }

    function orbitProfile() {
        const evolved = weaponLevel('nova_ring') > 0;
        if (evolved) {
            return {
                count: 6,
                radius: 74 * player.areaMul,
                angSpeed: 2.6,
                dps: 128 * player.dmgMul,
                orbR: 9,
            };
        }
        const lvl = weaponLevel('orbit');
        if (lvl <= 0) return null;
        return {
            count: 1 + Math.floor((lvl - 1) / 2),
            radius: 42 * player.areaMul,
            angSpeed: 1.6 + lvl * 0.08,
            dps: (10 + lvl * 3) * 7 * player.dmgMul,
            orbR: 7,
        };
    }

    const WEAPON_DEFS = {
        knife: {
            display: '飞刀',
            tag: '直线 · 单体',
            max: 8,
            desc: (lvl) => `向最近敌人投掷飞刀（等级 ${lvl}）。提升：伤害/数量/冷却。`,
            update: (st, dt) => {
                const lvl = st.lvl;
                st.timer -= dt;
                const cd = 0.85 * (1 - 0.05 * (lvl - 1)) * player.cdMul / currentFireRateMul();
                if (st.timer > 0) return;

                const target = findCombatEnemy(640);
                if (!target) { st.timer = 0.15; return; }

                const count = 1 + (lvl >= 4 ? 1 : 0) + (lvl >= 7 ? 1 : 0);
                const baseA = Math.atan2(target.y - player.y, target.x - player.x);
                for (let i = 0; i < count; i++) {
                    const spread = (count === 1) ? 0 : (i - (count - 1) / 2) * 0.14;
                    const a = baseA + spread;
                    spawnProjectile({
                        x: player.x,
                        y: player.y,
                        vx: Math.cos(a) * (520 * player.projSpeedMul),
                        vy: Math.sin(a) * (520 * player.projSpeedMul),
                        r: 4,
                        dmg: (14 + 5 * lvl) * player.dmgMul,
                        pierce: lvl >= 6 ? 2 : 1,
                        ttl: 1.25,
                        kind: 'knife',
                    });
                }
                st.timer = Math.max(0.16, cd);
            },
        },

        wand: {
            display: '魔杖',
            tag: '自动 · 追踪',
            max: 8,
            desc: (lvl) => `发射追踪弹（等级 ${lvl}）。提升：伤害/数量/冷却/穿透。`,
            update: (st, dt) => {
                const lvl = st.lvl;
                st.timer -= dt;
                const cd = 1.05 * (1 - 0.04 * (lvl - 1)) * player.cdMul / currentFireRateMul();
                if (st.timer > 0) return;

                const count = 1 + (lvl >= 3 ? 1 : 0) + (lvl >= 6 ? 1 : 0);
                for (let i = 0; i < count; i++) {
                    const a = rand(0, TAU);
                    spawnProjectile({
                        x: player.x + Math.cos(a) * 8,
                        y: player.y + Math.sin(a) * 8,
                        vx: Math.cos(a) * (280 * player.projSpeedMul),
                        vy: Math.sin(a) * (280 * player.projSpeedMul),
                        r: 5,
                        dmg: (18 + 6 * lvl) * player.dmgMul,
                        pierce: 1 + (lvl >= 7 ? 1 : 0),
                        ttl: 2.2,
                        kind: 'wand',
                        homing: 0.95 + lvl * 0.09,
                    });
                }
                st.timer = Math.max(0.18, cd);
            },
        },

        garlic: {
            display: '蒜圈',
            tag: '范围 · 近身',
            max: 8,
            desc: (lvl) => `周身持续伤害光环（等级 ${lvl}）。提升：半径/伤害。`,
            update: (st, dt) => { st.timer = Math.max(0, st.timer - dt); },
        },

        orbit: {
            display: '环绕符文',
            tag: '环绕 · 多段',
            max: 8,
            desc: (lvl) => `生成环绕物持续撞击敌人（等级 ${lvl}）。提升：数量/速度/伤害。`,
            update: (st, dt) => { st.timer = Math.max(0, st.timer - dt); },
        },

        spray: {
            display: '扇形喷射',
            tag: '新增 · 扇区',
            max: 8,
            desc: (lvl) => `向前方扇区连发弹幕（等级 ${lvl}）。`,
            update: (st, dt) => {
                const lvl = st.lvl;
                st.timer -= dt;
                const cd = 1.05 * (1 - 0.045 * (lvl - 1)) * player.cdMul / currentFireRateMul();
                if (st.timer > 0) return;

                const target = findCombatEnemy(720);
                if (!target) { st.timer = 0.22; return; }

                const count = 4 + Math.floor((lvl - 1) / 2);
                const spread = Math.max(0.22, 0.76 - lvl * 0.04);
                const baseA = Math.atan2(target.y - player.y, target.x - player.x);
                for (let i = 0; i < count; i++) {
                    const f = count === 1 ? 0 : (i / (count - 1) - 0.5);
                    const a = baseA + f * spread;
                    spawnProjectile({
                        x: player.x,
                        y: player.y,
                        vx: Math.cos(a) * (460 * player.projSpeedMul),
                        vy: Math.sin(a) * (460 * player.projSpeedMul),
                        r: 3.5,
                        dmg: (10 + 4 * lvl) * player.dmgMul,
                        pierce: lvl >= 5 ? 2 : 1,
                        ttl: 0.95,
                        kind: 'spray',
                    });
                }
                st.timer = Math.max(0.2, cd);
            },
        },

        chain: {
            display: '链状闪电',
            tag: '新增 · 连锁',
            max: 8,
            desc: (lvl) => `电击并在敌人间跳跃（等级 ${lvl}）。`,
            update: (st, dt) => {
                const lvl = st.lvl;
                st.timer -= dt;
                const cd = 1.85 * (1 - 0.04 * (lvl - 1)) * player.cdMul / currentFireRateMul();
                if (st.timer > 0) return;

                const first = findCombatEnemy(620);
                if (!first) { st.timer = 0.2; return; }

                const jumps = 2 + Math.floor(lvl / 2) + (lvl >= 7 ? 1 : 0);
                const jumpRange = 170 + lvl * 10;
                const dmg = (24 + 7 * lvl) * player.dmgMul;

                const pts = [{ x: player.x, y: player.y }];
                const seen = new Set();
                let cur = first;
                for (let i = 0; i < jumps; i++) {
                    if (!cur || cur.dead) break;
                    seen.add(cur);
                    pts.push({ x: cur.x, y: cur.y });
                    const falloff = Math.max(0.55, 1 - i * 0.14);
                    dealDamageToEnemy(cur, dmg * falloff);
                    cur.slow = Math.max(cur.slow, 0.26);
                    cur = findCombatEnemyFrom(cur, jumpRange, seen);
                }

                fx.push({
                    kind: 'chain',
                    points: pts,
                    t: 0,
                    duration: 0.2,
                });

                st.timer = Math.max(0.24, cd);
            },
        },

        bomb: {
            display: '延迟爆炸',
            tag: '新增 · AOE',
            max: 8,
            desc: (lvl) => `投掷延时炸弹，短暂后爆炸（等级 ${lvl}）。`,
            update: (st, dt) => {
                const lvl = st.lvl;
                st.timer -= dt;
                const cd = 2.2 * (1 - 0.035 * (lvl - 1)) * player.cdMul / currentFireRateMul();
                if (st.timer > 0) return;

                const target = findCombatEnemy(720);
                if (!target) { st.timer = 0.28; return; }

                const count = 1 + (lvl >= 4 ? 1 : 0) + (lvl >= 7 ? 1 : 0);
                for (let i = 0; i < count; i++) {
                    const jitterA = rand(-0.45, 0.45);
                    const jitterR = rand(0, 30);
                    const tx = target.x + Math.cos(jitterA) * jitterR;
                    const ty = target.y + Math.sin(jitterA) * jitterR;
                    const n = norm(tx - player.x, ty - player.y);
                    const speed = 220 * player.projSpeedMul;
                    spawnProjectile({
                        x: player.x,
                        y: player.y,
                        vx: n.x * speed,
                        vy: n.y * speed,
                        r: 6,
                        ttl: 3.2,
                        fuse: Math.max(0.35, 0.95 - lvl * 0.05),
                        blastR: (56 + lvl * 7) * player.areaMul,
                        dmg: (30 + 11 * lvl) * player.dmgMul,
                        kind: 'bomb',
                    });
                }

                st.timer = Math.max(0.32, cd);
            },
        },

        thunder: {
            display: '落雷',
            tag: '新增 · 天降',
            max: 8,
            desc: (lvl) => `在敌群处标记雷击，短暂后落雷（等级 ${lvl}）。`,
            update: (st, dt) => {
                const lvl = st.lvl;
                st.timer -= dt;
                const cd = 1.7 * (1 - 0.035 * (lvl - 1)) * player.cdMul / currentFireRateMul();
                if (st.timer > 0) return;

                const strikes = 1 + Math.floor((lvl + 1) / 3);
                for (let i = 0; i < strikes; i++) {
                    const t = pickRandomCombatEnemy(760);
                    let x, y;
                    if (t) {
                        x = t.x + rand(-22, 22);
                        y = t.y + rand(-22, 22);
                    } else {
                        const a = rand(0, TAU);
                        const rr = rand(60, 260);
                        x = player.x + Math.cos(a) * rr;
                        y = player.y + Math.sin(a) * rr;
                    }
                    spawnProjectile({
                        x, y,
                        kind: 'thunder',
                        delay: Math.max(0.22, 0.55 - lvl * 0.025),
                        ttl: 1.1,
                        blastR: (48 + lvl * 5) * player.areaMul,
                        dmg: (34 + 11 * lvl) * player.dmgMul,
                    });
                }

                st.timer = Math.max(0.2, cd);
            },
        },

        whirl: {
            display: '旋风',
            tag: '新增 · 持续',
            max: 8,
            desc: (lvl) => `召唤会追踪敌人的旋风（等级 ${lvl}）。`,
            update: (st, dt) => {
                const lvl = st.lvl;
                st.timer -= dt;
                const cd = 2.35 * (1 - 0.04 * (lvl - 1)) * player.cdMul / currentFireRateMul();
                if (st.timer > 0) return;

                const count = 1 + (lvl >= 4 ? 1 : 0) + (lvl >= 7 ? 1 : 0);
                const target = findCombatEnemy(620);
                for (let i = 0; i < count; i++) {
                    let a = rand(0, TAU);
                    if (target) {
                        const base = Math.atan2(target.y - player.y, target.x - player.x);
                        a = base + rand(-0.45, 0.45);
                    }
                    spawnProjectile({
                        x: player.x + Math.cos(a) * 12,
                        y: player.y + Math.sin(a) * 12,
                        vx: Math.cos(a) * (130 * player.projSpeedMul),
                        vy: Math.sin(a) * (130 * player.projSpeedMul),
                        r: (14 + lvl * 1.6) * player.areaMul,
                        dps: (18 + 6 * lvl) * player.dmgMul,
                        steer: 0.85 + lvl * 0.08,
                        ttl: 2.8 + lvl * 0.16,
                        spin: rand(0, TAU),
                        kind: 'whirl',
                    });
                }

                st.timer = Math.max(0.24, cd);
            },
        },

        storm_blades: {
            display: '风暴刃雨',
            tag: '进化 · 飞刀',
            max: 1,
            evolvedOnly: true,
            desc: () => '飞刀进化形态：高速多向刀雨。',
            update: (st, dt) => {
                st.timer -= dt;
                const cd = 0.38 * player.cdMul / currentFireRateMul();
                if (st.timer > 0) return;

                const count = 8;
                const spin = elapsed * 3.2;
                for (let i = 0; i < count; i++) {
                    const a = spin + (i / count) * TAU;
                    spawnProjectile({
                        x: player.x,
                        y: player.y,
                        vx: Math.cos(a) * (620 * player.projSpeedMul),
                        vy: Math.sin(a) * (620 * player.projSpeedMul),
                        r: 4.2,
                        dmg: 34 * player.dmgMul,
                        pierce: 2,
                        ttl: 1.1,
                        kind: 'storm',
                    });
                }
                st.timer = Math.max(0.12, cd);
            },
        },

        arcane_orb: {
            display: '奥术天球',
            tag: '进化 · 魔杖',
            max: 1,
            evolvedOnly: true,
            desc: () => '魔杖进化形态：高伤穿透追踪球，命中爆裂。',
            update: (st, dt) => {
                st.timer -= dt;
                const cd = 1.15 * player.cdMul / currentFireRateMul();
                if (st.timer > 0) return;

                const target = findCombatEnemy(760);
                if (!target) { st.timer = 0.22; return; }
                const base = Math.atan2(target.y - player.y, target.x - player.x);

                for (let i = 0; i < 2; i++) {
                    const a = base + (i === 0 ? -0.16 : 0.16);
                    spawnProjectile({
                        x: player.x,
                        y: player.y,
                        vx: Math.cos(a) * (340 * player.projSpeedMul),
                        vy: Math.sin(a) * (340 * player.projSpeedMul),
                        r: 6,
                        dmg: 66 * player.dmgMul,
                        pierce: 3,
                        ttl: 2.8,
                        kind: 'arcane',
                        homing: 1.8,
                    });
                }
                st.timer = Math.max(0.2, cd);
            },
        },

        plague_core: {
            display: '瘟疫核心',
            tag: '进化 · 蒜圈',
            max: 1,
            evolvedOnly: true,
            desc: () => '蒜圈进化形态：巨型高伤腐蚀领域。',
            update: (st, dt) => { st.timer = Math.max(0, st.timer - dt); },
        },

        nova_ring: {
            display: '新星环',
            tag: '进化 · 环绕',
            max: 1,
            evolvedOnly: true,
            desc: () => '环绕进化形态：更大轨道和更高撞击频率。',
            update: (st, dt) => { st.timer = Math.max(0, st.timer - dt); },
        },
    };

    const WEAPON_EVOLUTIONS = {
        knife: { to: 'storm_blades', passive: 'speed', name: '风暴刃雨' },
        wand: { to: 'arcane_orb', passive: 'projSpeed', name: '奥术天球' },
        garlic: { to: 'plague_core', passive: 'area', name: '瘟疫核心' },
        orbit: { to: 'nova_ring', passive: 'cd', name: '新星环' },
    };

    // ====== Passives ======
    const PASSIVES = {
        maxhp: {
            display: '生命上限',
            tag: '被动',
            max: 8,
            desc: (next) => `最大生命 +12%（Lv.${next}）。`,
            apply: () => {
                player.hpMax = Math.round(player.hpMax * 1.12);
                player.hp = Math.min(player.hpMax, player.hp + Math.round(player.hpMax * 0.12));
            },
        },
        speed: {
            display: '移速',
            tag: '被动',
            max: 8,
            desc: (next) => `移动速度 +10%（Lv.${next}）。`,
            apply: () => { player.speedMul *= 1.10; },
        },
        dmg: {
            display: '伤害',
            tag: '被动',
            max: 8,
            desc: (next) => `伤害 +12%（Lv.${next}）。`,
            apply: () => { player.dmgMul *= 1.12; },
        },
        cd: {
            display: '冷却',
            tag: '被动',
            max: 8,
            desc: (next) => `冷却 -8%（Lv.${next}）。`,
            apply: () => { player.cdMul *= 0.92; },
        },
        area: {
            display: '范围',
            tag: '被动',
            max: 8,
            desc: (next) => `范围 +12%（Lv.${next}）。`,
            apply: () => { player.areaMul *= 1.12; },
        },
        regen: {
            display: '回血',
            tag: '被动',
            max: 8,
            desc: (next) => `每秒回复 +0.6（Lv.${next}）。`,
            apply: () => { player.regen += 0.6; },
        },
        magnet: {
            display: '吸取',
            tag: '被动',
            max: 8,
            desc: (next) => `拾取范围 +18%（Lv.${next}）。`,
            apply: () => { player.magnet *= 1.18; },
        },
        armor: {
            display: '护甲',
            tag: '被动',
            max: 8,
            desc: (next) => `受伤减免 +1（Lv.${next}）。`,
            apply: () => { player.armor += 1; },
        },
        projSpeed: {
            display: '弹速',
            tag: '被动',
            max: 8,
            desc: (next) => `投射物速度 +12%（Lv.${next}）。`,
            apply: () => { player.projSpeedMul *= 1.12; },
        },
        critChance: {
            display: '暴击率',
            tag: '被动',
            max: 8,
            desc: (next) => `暴击率 +2.5%（Lv.${next}）。`,
            apply: () => {
                player.critChance = clamp(player.critChance + 0.025, 0, CONFIG.limits.maxCritChance);
            },
        },
        critPower: {
            display: '暴击伤害',
            tag: '被动',
            max: 6,
            desc: (next) => `暴击倍率 +0.12（Lv.${next}）。`,
            apply: () => {
                player.critMultiplier += 0.12;
            },
        },
    };

    // ====== Enemies ======
    const ENEMY_DEFS = {
        walker: {
            r: 14, hp: 34, sp: 78, dmg: 10,
            color: 'rgba(255,180,120,0.92)',
            xp: [1, 3],
        },
        runner: {
            r: 12, hp: 24, sp: 122, dmg: 8,
            color: 'rgba(255,120,120,0.92)',
            xp: [1, 3],
        },
        tank: {
            r: 17, hp: 82, sp: 60, dmg: 13,
            color: 'rgba(255,145,90,0.92)',
            xp: [2, 4],
        },
        swarm: {
            r: 10, hp: 18, sp: 150, dmg: 7,
            color: 'rgba(255,100,160,0.9)',
            xp: [1, 2],
        },
        elite: {
            r: 19, hp: 240, sp: 92, dmg: 16,
            color: 'rgba(255,220,120,0.95)',
            xp: [10, 14],
            elite: true,
            chest: 3,
        },
        boss: {
            r: 30, hp: 1800, sp: 72, dmg: 24,
            color: 'rgba(255,92,92,0.96)',
            xp: [24, 36],
            boss: true,
            chest: 5,
            summonCd: 7,
        },
    };

    function spawnEnemy(type, opts = {}) {
        const def = ENEMY_DEFS[type] || ENEMY_DEFS.walker;
        const t = elapsed;
        const hpScale = 1 + (t / (def.boss ? 220 : def.elite ? 130 : 75)) * difficulty.enemyHpGrowthMul;
        const spScale = 1 + (t / (def.boss ? 480 : 250)) * difficulty.enemySpeedGrowthMul;
        const dmgScale = 1 + (t / (def.boss ? 290 : 240)) * difficulty.enemyDmgGrowthMul;

        let x = 0;
        let y = 0;
        if (opts.around) {
            const a = rand(0, TAU);
            const rr = rand(opts.radiusMin ?? 70, opts.radiusMax ?? 150);
            x = opts.around.x + Math.cos(a) * rr;
            y = opts.around.y + Math.sin(a) * rr;
        } else {
            let placed = false;
            for (let i = 0; i < 9; i++) {
                const a = rand(0, TAU);
                const rr = rand(WORLD.spawnRadius * 0.82, WORLD.spawnRadius);
                const tx = player.x + Math.cos(a) * rr;
                const ty = player.y + Math.sin(a) * rr;
                if (!isInsideSolidObstacle(tx, ty, def.r + 6)) {
                    x = tx;
                    y = ty;
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                const a = rand(0, TAU);
                const rr = WORLD.spawnRadius;
                x = player.x + Math.cos(a) * rr;
                y = player.y + Math.sin(a) * rr;
            }
        }

        enemies.push({
            x, y,
            r: def.r,
            hp: def.hp * hpScale * (opts.hpMul ?? 1),
            hpMax: def.hp * hpScale * (opts.hpMul ?? 1),
            sp: def.sp * spScale * (opts.spMul ?? 1),
            dmg: def.dmg * dmgScale * (opts.dmgMul ?? 1),
            color: def.color,
            kind: type,
            elite: !!def.elite,
            boss: !!def.boss,
            chestDrop: def.chest || 0,
            xpMin: def.xp[0],
            xpMax: def.xp[1],
            hitCD: 0,
            slow: 0,
            summonCd: def.summonCd || 0,
            bossNovaCd: def.boss ? rand(2.6, 4.2) : 0,
            bossRainCd: def.boss ? rand(4.2, 6.6) : 0,
            bossWaveCd: def.boss ? rand(6.4, 8.2) : 0,
            bossRot: rand(0, TAU),
            dead: false,
        });
    }

    // ====== Input ======
    const keys = new Set();
    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        keys.add(e.code);

        if (e.code === 'KeyM') {
            setSfxEnabled(!SFX.enabled);
            if (SFX.enabled) unlockAudio();
        }
        if (e.code === 'KeyB') {
            setBgmEnabled(!BGM.enabled);
            if (BGM.enabled) unlockAudio();
        }
        if (e.code === 'KeyP') togglePause();
        if (e.code === 'Escape' && inReward) closeRewardPanel();

        if (inReward) {
            if (e.code === 'Digit1') chooseUpgrade(0);
            if (e.code === 'Digit2') chooseUpgrade(1);
            if (e.code === 'Digit3') chooseUpgrade(2);
            return;
        }
        if (!paused && e.code === 'Space') dash();
    });
    window.addEventListener('keyup', (e) => keys.delete(e.code));

    const isTouch = matchMedia('(pointer: coarse)').matches;
    const hasPointer = 'PointerEvent' in window;
    const STICK_SIZE = 140;
    const STICK_KNOB_MAX = 44;
    const STICK_DZ = 8;
    let stickState = {
        active: false,
        pointerId: null,
        cx: 0,
        cy: 0,
        dx: 0,
        dy: 0,
        dynamic: false,
    };
    if (isTouch) mobile.classList.remove('hidden');

    function setKnob(dx, dy) {
        const l = Math.hypot(dx, dy) || 1;
        const k = l > STICK_KNOB_MAX ? STICK_KNOB_MAX / l : 1;
        stickKnob.style.transform = `translate(${dx * k}px, ${dy * k}px) translate(-50%,-50%)`;
    }

    function placeStickAt(clientX, clientY) {
        const pad = 8;
        const x = clamp(clientX - STICK_SIZE / 2, pad, W() - STICK_SIZE - pad);
        const y = clamp(clientY - STICK_SIZE / 2, pad, H() - STICK_SIZE - pad);
        stick.style.left = `${x}px`;
        stick.style.top = `${y}px`;
        stick.style.bottom = 'auto';
        stick.style.transform = 'none';
    }

    function resetStickPlacement() {
        stick.style.left = '';
        stick.style.top = '';
        stick.style.bottom = '';
        stick.style.transform = '';
    }

    function updateStickFromPoint(clientX, clientY) {
        stickState.dx = clientX - stickState.cx;
        stickState.dy = clientY - stickState.cy;
        setKnob(stickState.dx, stickState.dy);
    }

    function beginStick(pointerId, clientX, clientY, dynamic) {
        stickState.active = true;
        stickState.pointerId = pointerId;
        stickState.dynamic = dynamic;
        if (dynamic) placeStickAt(clientX, clientY);
        const r = stick.getBoundingClientRect();
        stickState.cx = r.left + r.width / 2;
        stickState.cy = r.top + r.height / 2;
        updateStickFromPoint(clientX, clientY);
    }

    function endStick(pointerId = null) {
        if (!stickState.active) return;
        if (pointerId !== null && stickState.pointerId !== null && pointerId !== stickState.pointerId) return;
        stickState.active = false;
        stickState.pointerId = null;
        stickState.dx = 0;
        stickState.dy = 0;
        if (stickState.dynamic) resetStickPlacement();
        stickState.dynamic = false;
        setKnob(0, 0);
    }

    function shouldIgnoreStickStart(target) {
        if (!target || typeof target.closest !== 'function') return false;
        return !!(
            target.closest('#dashBtn') ||
            target.closest('#pauseBtn') ||
            target.closest('#menu') ||
            target.closest('#overlay') ||
            target.closest('#card')
        );
    }

    function bindMobileInput() {
        // hard-stop browser gesture scrolling during gameplay surfaces
        const prevent = (e) => {
            if (!isTouch) return;
            const target = e.target;
            if (target && typeof target.closest === 'function') {
                // Keep menu/reward panel controls (especially range slider) draggable.
                if (target.closest('#menu') || target.closest('#overlay') || target.closest('input,select,textarea,button')) {
                    return;
                }
            }
            if (e.cancelable) e.preventDefault();
        };
        window.addEventListener('touchmove', prevent, { passive: false });
        window.addEventListener('gesturestart', prevent, { passive: false });

        if (hasPointer) {
            stick.addEventListener('pointerdown', (e) => {
                if (!isTouch || e.pointerType === 'mouse') return;
                if (stickState.active) return;
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
                beginStick(e.pointerId, e.clientX, e.clientY, false);
            }, { passive: false });

            window.addEventListener('pointerdown', (e) => {
                if (!isTouch || e.pointerType === 'mouse') return;
                if (stickState.active) return;
                if (e.clientX > W() * 0.62) return;
                if (shouldIgnoreStickStart(e.target)) return;
                if (e.cancelable) e.preventDefault();
                beginStick(e.pointerId, e.clientX, e.clientY, true);
            }, { passive: false });

            window.addEventListener('pointermove', (e) => {
                if (!stickState.active) return;
                if (stickState.pointerId !== null && e.pointerId !== stickState.pointerId) return;
                if (e.cancelable) e.preventDefault();
                updateStickFromPoint(e.clientX, e.clientY);
            }, { passive: false });

            window.addEventListener('pointerup', (e) => {
                endStick(e.pointerId);
            }, { passive: false });
            window.addEventListener('pointercancel', (e) => {
                endStick(e.pointerId);
            }, { passive: false });
        } else {
            // Fallback for older browsers without pointer events.
            window.addEventListener('touchstart', (e) => {
                if (!isTouch || stickState.active) return;
                const t = e.changedTouches[0];
                if (!t) return;
                if (t.clientX > W() * 0.62) return;
                if (shouldIgnoreStickStart(e.target)) return;
                if (e.cancelable) e.preventDefault();
                beginStick(t.identifier, t.clientX, t.clientY, true);
            }, { passive: false });
            window.addEventListener('touchmove', (e) => {
                if (!stickState.active) return;
                let t = null;
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === stickState.pointerId) {
                        t = e.changedTouches[i];
                        break;
                    }
                }
                if (!t) return;
                if (e.cancelable) e.preventDefault();
                updateStickFromPoint(t.clientX, t.clientY);
            }, { passive: false });
            window.addEventListener('touchend', (e) => {
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === stickState.pointerId) {
                        endStick(stickState.pointerId);
                        break;
                    }
                }
            }, { passive: false });
            window.addEventListener('touchcancel', () => endStick(stickState.pointerId), { passive: false });
        }

        window.addEventListener('blur', () => endStick());
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) endStick();
        });
    }

    if (isTouch) bindMobileInput();

    if (isTouch) {
        const dashHandler = (e) => {
            if (e?.cancelable) e.preventDefault();
            dash();
        };
        const pauseHandler = (e) => {
            if (e?.cancelable) e.preventDefault();
            togglePause();
        };
        dashBtn.addEventListener('pointerdown', dashHandler, { passive: false });
        pauseBtn.addEventListener('pointerdown', pauseHandler, { passive: false });
        if (!hasPointer) {
            dashBtn.addEventListener('touchstart', dashHandler, { passive: false });
            pauseBtn.addEventListener('touchstart', pauseHandler, { passive: false });
        }
    } else {
        dashBtn.addEventListener('click', () => dash());
        pauseBtn.addEventListener('click', () => togglePause());
    }

    function moveInput() {
        let x = 0, y = 0;
        if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;

        if (stickState.active) {
            const n = norm(stickState.dx, stickState.dy);
            const m = clamp((n.l - STICK_DZ) / STICK_KNOB_MAX, 0, 1);
            x += n.x * m;
            y += n.y * m;
        }
        const n = norm(x, y);
        if (Math.hypot(x, y) < 0.01) return { x: 0, y: 0 };
        return { x: n.x, y: n.y };
    }

    // ====== Targeting ======
    function playerTargetRadius() {
        // Use the narrower screen side as diameter: r = min(width, height) / 2.
        return Math.max(120, Math.min(W(), H()) * 0.5);
    }

    function isWorldPointVisible(x, y, pad = 0) {
        const sx = (x - cam.x) + W() / 2;
        const sy = (y - cam.y) + H() / 2;
        return sx >= -pad && sx <= W() + pad && sy >= -pad && sy <= H() + pad;
    }

    function inPlayerCombatZone(enemy) {
        const inCircle = dist(player.x, player.y, enemy.x, enemy.y) <= playerTargetRadius();
        if (!inCircle) return false;
        return isWorldPointVisible(enemy.x, enemy.y, enemy.r + 8);
    }

    function findCombatEnemy(maxD = Infinity) {
        return findNearestEnemy(
            player.x,
            player.y,
            Math.min(maxD, playerTargetRadius()),
            inPlayerCombatZone
        );
    }

    function findCombatEnemyAt(x, y, maxD = Infinity) {
        return findNearestEnemy(
            x,
            y,
            Math.min(maxD, playerTargetRadius()),
            inPlayerCombatZone
        );
    }

    function findCombatEnemyFrom(from, maxD, seen) {
        return findNearestEnemyFrom(
            from,
            Math.min(maxD, playerTargetRadius()),
            seen,
            inPlayerCombatZone
        );
    }

    function pickRandomCombatEnemy(maxD = Infinity) {
        return pickRandomEnemy(Math.min(maxD, playerTargetRadius()), inPlayerCombatZone);
    }

    function findNearestEnemy(x, y, maxD = Infinity, filter = null) {
        let best = null;
        let bestHp = Infinity;
        let bd = maxD;
        for (const e of enemies) {
            if (e.dead) continue;
            const d = dist(x, y, e.x, e.y);
            if (d > maxD) continue;
            if (filter && !filter(e)) continue;
            if (e.hp < bestHp || (e.hp === bestHp && d < bd)) {
                best = e;
                bestHp = e.hp;
                bd = d;
            }
        }
        return best;
    }

    function findNearestEnemyFrom(from, maxD, seen, filter = null) {
        let best = null;
        let bestHp = Infinity;
        let bd = maxD;
        for (const e of enemies) {
            if (e.dead || seen.has(e)) continue;
            const d = dist(from.x, from.y, e.x, e.y);
            if (d > maxD) continue;
            if (filter && !filter(e)) continue;
            if (e.hp < bestHp || (e.hp === bestHp && d < bd)) {
                best = e;
                bestHp = e.hp;
                bd = d;
            }
        }
        return best;
    }

    function pickRandomEnemy(maxD = Infinity, filter = null) {
        const pool = [];
        for (const e of enemies) {
            if (e.dead) continue;
            if (filter && !filter(e)) continue;
            if (dist(player.x, player.y, e.x, e.y) <= maxD) pool.push(e);
        }
        if (!pool.length) return null;
        return pool[(Math.random() * pool.length) | 0];
    }

    // ====== Combat helpers ======
    function spawnProjectile(p) {
        projectiles.push({
            ...p,
            hitSet: p.hitSet || new Set(),
            t: p.t || 0,
        });
    }

    function spawnPickup(x, y, kind, value) {
        const r = kind === 'xp' ? 6 : (kind === 'heal' ? 10 : 12);
        pickups.push({ x, y, kind, value, r, t: 0 });
    }

    function announceEvent(text, color = 'rgba(255,255,255,0.95)', duration = 3.5) {
        eventBanner.text = text;
        eventBanner.color = color;
        eventBanner.ttl = duration;
    }

    function canEvolve(baseKey) {
        const evo = WEAPON_EVOLUTIONS[baseKey];
        if (!evo) return false;
        if (weaponLevel(baseKey) < (WEAPON_DEFS[baseKey]?.max || 8)) return false;
        if (passiveLevel(evo.passive) <= 0) return false;
        if (weaponLevel(evo.to) > 0) return false;
        return true;
    }

    function evolveWeapon(baseKey) {
        const evo = WEAPON_EVOLUTIONS[baseKey];
        if (!evo || !canEvolve(baseKey)) return false;
        weapons.delete(baseKey);
        addWeapon(evo.to);
        announceEvent(`武器进化：${evo.name}！`, 'rgba(255,240,150,0.98)', 3.2);
        playSfx('evolve');
        cinematic.flash = Math.max(cinematic.flash, 0.95);
        cinematic.text = `进化达成 · ${evo.name}`;
        cinematic.textTTL = 2.1;
        fx.push({ kind: 'evolve_ring', x: player.x, y: player.y, r: 28, t: 0, duration: 0.9 });
        for (let i = 0; i < 22; i++) {
            const a = (i / 22) * TAU + rand(-0.12, 0.12);
            const sp = rand(110, 280);
            fx.push({
                kind: 'evolve_spark',
                x: player.x,
                y: player.y,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp,
                t: 0,
                duration: 0.72,
            });
        }
        return true;
    }

    function enemyXpDrop(e) {
        const base = irand(e.xpMin, e.xpMax);
        return Math.max(1, Math.round(base * combo.multiplier));
    }

    function dealDamageToEnemy(e, dmg, opts = {}) {
        if (!e || e.dead) return;
        let finalDmg = dmg * currentRageDamageMul();
        let isCrit = false;
        if (opts.canCrit !== false) {
            const chance = currentCritChance();
            if (Math.random() < chance) {
                finalDmg *= player.critMultiplier;
                isCrit = true;
            }
        }
        if (isCrit) playSfx('crit');
        finalDmg = Math.max(0.2, finalDmg);

        e.hp -= finalDmg;
        fx.push({ x: e.x, y: e.y, t: 0, kind: isCrit ? 'crit_hit' : 'hit', duration: 0.24 });
        if ((isCrit || Math.random() < CONFIG.crit.damageTextChance) && opts.showText !== false) {
            fx.push({
                kind: 'dmg_text',
                x: e.x + rand(-8, 8),
                y: e.y - e.r - rand(4, 16),
                vy: -rand(24, 42),
                text: String(Math.round(finalDmg)),
                color: isCrit ? 'rgba(255,230,140,0.96)' : 'rgba(255,255,255,0.85)',
                t: 0,
                duration: isCrit ? 0.65 : 0.48,
            });
        }
        if (e.hp > 0) return;

        e.dead = true;
        kills++;
        playSfx('kill');
        applyComboOnKill(e.x, e.y);

        spawnPickup(e.x, e.y, 'xp', enemyXpDrop(e));
        if (e.elite || e.boss) {
            spawnPickup(e.x, e.y, 'chest', e.chestDrop || (e.boss ? 5 : 3));
        }
        if (!e.boss && Math.random() < 0.02) {
            spawnPickup(e.x, e.y, 'heal', 18);
        }
    }

    function explodeAt(x, y, r, dmg, slow = 0.12, kind = 'boom') {
        fx.push({ x, y, r, kind, t: 0, duration: 0.34 });
        for (const e of enemies) {
            if (e.dead) continue;
            const d = dist(x, y, e.x, e.y);
            if (d > r + e.r) continue;
            const falloff = clamp(1 - d / (r + e.r), 0.3, 1);
            dealDamageToEnemy(e, dmg * falloff);
            e.slow = Math.max(e.slow, slow);
        }
    }

    function hurtPlayer(dmg) {
        if (player.iFrames > 0) return;
        const final = Math.max(1, dmg - player.armor);
        player.hp -= final;
        playSfx('hurt');
        gainRage(CONFIG.rage.gainFromDamage * (CONFIG.rage.gainFromDamageBase + final * CONFIG.rage.gainFromDamagePerPoint));
        player.iFrames = 0.45;
        fx.push({ x: player.x, y: player.y, t: 0, kind: 'hurt', duration: 0.35 });

        if (player.hp > 0) return;
        player.hp = 0;
        gameOver = true;
        paused = true;

        if (elapsed > (SAVE.bestTime || 0)) {
            SAVE.bestTime = elapsed;
            saveToDisk(SAVE);
        }
        lastRunSnapshot.time = elapsed;
        lastRunSnapshot.kills = kills;
        lastRunSnapshot.level = player.level;
        lastRunSnapshot.difficultyLabel = difficulty.label;
        setTimeout(() => {
            setMenuState('gameover');
        }, 300);
    }

    // ====== Reward panel ======
    function openRewardPanel(mode) {
        if (inReward || gameOver || !menu.classList.contains('hidden')) return;
        inReward = true;
        rewardMode = mode;
        paused = true;
        overlay.classList.remove('hidden');
        rewardCinematic.classList.add('hidden');
        choicesEl.classList.remove('dimmed');
        if (mode === 'chest') {
            ovTitle.textContent = `宝箱奖励！选择一项（待开 ${pendingChestRewards}）`;
            beginChestIntro();
        } else {
            const step = Math.max(1, difficulty.levelChoiceStep || 1);
            ovTitle.textContent = step > 1
                ? `升级！选择一项（待升 ${pendingLevelUps}，每次结算 ${step} 级）`
                : `升级！选择一项（待升 ${pendingLevelUps}）`;
        }
        currentChoices = rollChoices(3, { fromChest: mode === 'chest' });
        renderChoices(currentChoices);
    }

    function closeRewardPanel() {
        inReward = false;
        rewardMode = 'none';
        rewardIntro.active = false;
        rewardIntro.timer = 0;
        rewardCinematic.classList.add('hidden');
        choicesEl.classList.remove('dimmed');
        overlay.classList.add('hidden');
        paused = false;
        setTimeout(() => {
            openNextRewardPanel();
        }, 0);
    }

    function openNextRewardPanel() {
        if (inReward || gameOver || !menu.classList.contains('hidden')) return;
        if (pendingChestRewards > 0) {
            openRewardPanel('chest');
            return;
        }
        if (pendingLevelUps > 0) {
            openRewardPanel('level');
        }
    }

    function beginChestIntro() {
        rewardIntro.active = true;
        rewardIntro.duration = 0.72;
        rewardIntro.timer = rewardIntro.duration;
        choicesEl.classList.add('dimmed');
        rewardCinematic.classList.remove('hidden');
        rewardCinematic.textContent = `宝箱开启中... 剩余 ${pendingChestRewards} 次奖励`;
        playSfx('chest');
        cinematic.flash = Math.max(cinematic.flash, 0.45);
        for (let i = 0; i < 12; i++) {
            const a = rand(0, TAU);
            const sp = rand(90, 230);
            fx.push({
                kind: 'chest_spark',
                x: player.x,
                y: player.y,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp,
                t: 0,
                duration: 0.55,
            });
        }
    }

    function updateRewardIntro(dt) {
        if (!rewardIntro.active) return;
        rewardIntro.timer -= dt;
        if (rewardIntro.timer > 0) return;
        rewardIntro.active = false;
        rewardCinematic.classList.add('hidden');
        choicesEl.classList.remove('dimmed');
    }

    function rollChoices(n, opts = {}) {
        const fromChest = !!opts.fromChest;
        const pool = [];
        const evolveChoices = [];

        for (const [base, evo] of Object.entries(WEAPON_EVOLUTIONS)) {
            if (!canEvolve(base)) continue;
            evolveChoices.push({
                kind: 'evolve',
                key: base,
                to: evo.to,
                name: `进化：${WEAPON_DEFS[evo.to].display}`,
                tag: 'Evolve',
                desc: `${WEAPON_DEFS[base].display} 满级 + 被动「${PASSIVES[evo.passive].display}」达成，进化成 ${WEAPON_DEFS[evo.to].display}。`,
            });
        }

        for (const [k, def] of Object.entries(WEAPON_DEFS)) {
            if (def.evolvedOnly) continue;
            const lvl = weaponLevel(k);
            if (lvl === 0) {
                pool.push({
                    kind: 'weapon_add',
                    key: k,
                    name: def.display,
                    tag: def.tag,
                    desc: def.desc(1),
                });
            } else if (lvl < def.max) {
                pool.push({
                    kind: 'weapon_up',
                    key: k,
                    name: def.display,
                    tag: def.tag,
                    desc: def.desc(lvl + 1),
                });
            }
        }

        for (const [k, def] of Object.entries(PASSIVES)) {
            const lvl = passiveLevel(k);
            if (lvl >= def.max) continue;
            pool.push({
                kind: 'passive',
                key: k,
                name: def.display,
                tag: `${def.tag} Lv.${lvl}/${def.max}`,
                desc: def.desc(lvl + 1),
            });
        }

        if (fromChest) {
            // 宝箱更偏向给武器和进化
            const weaponBias = pool
                .filter((c) => c.kind.startsWith('weapon'))
                .map((c) => ({ ...c }));
            pool.push(...weaponBias);
        }

        shuffle(pool);
        const res = [];
        const used = new Set();

        if (evolveChoices.length) {
            shuffle(evolveChoices);
            const evoPick = evolveChoices[0];
            res.push(evoPick);
            used.add(`${evoPick.kind}:${evoPick.key}`);
        }

        while (res.length < n && pool.length) {
            const pick = pool.pop();
            const id = `${pick.kind}:${pick.key}`;
            if (used.has(id)) continue;
            used.add(id);
            res.push(pick);
        }

        while (res.length < n) {
            const lvl = passiveLevel('dmg');
            res.push({
                kind: 'passive',
                key: 'dmg',
                name: PASSIVES.dmg.display,
                tag: `被动 Lv.${lvl}/${PASSIVES.dmg.max}`,
                desc: PASSIVES.dmg.desc(lvl + 1),
            });
        }
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
        if (!inReward) return;
        if (rewardIntro.active) return;
        const c = currentChoices[i];
        if (!c) return;

        const applyOnce = () => {
            if (c.kind === 'weapon_add') addWeapon(c.key);
            if (c.kind === 'weapon_up') upgradeWeapon(c.key);
            if (c.kind === 'passive') applyPassive(c.key);
            if (c.kind === 'evolve') evolveWeapon(c.key);
        };

        if (rewardMode === 'chest') {
            applyOnce();
            pendingChestRewards = Math.max(0, pendingChestRewards - 1);
        } else if (rewardMode === 'level') {
            const step = Math.max(1, difficulty.levelChoiceStep || 1);
            const times = Math.max(1, Math.min(step, pendingLevelUps));
            for (let t = 0; t < times; t++) applyOnce();
            pendingLevelUps = Math.max(0, pendingLevelUps - times);
            if (times > 1) {
                cinematic.flash = Math.max(cinematic.flash, 0.16);
            }
        }

        closeRewardPanel();
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (m) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[m]));
    }

    // ====== Game flow ======
    function resetRun() {
        enemies.length = 0;
        projectiles.length = 0;
        pickups.length = 0;
        fx.length = 0;
        obstacleChunks.clear();
        discoveredLandmarks.clear();

        player.x = 0;
        player.y = 0;
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
        player.nextXp = calcNextXp(1);

        player.dmgMul = 1;
        player.areaMul = 1;
        player.cdMul = 1;
        player.projSpeedMul = 1;
        player.luck = 0;
        player.critChance = clamp(CONFIG.crit.baseChance + difficulty.critBonus, 0, CONFIG.limits.maxCritChance);
        player.critMultiplier = CONFIG.crit.baseMultiplier;

        weapons.clear();
        passiveLevels.clear();
        addWeapon('knife');
        for (const w of difficulty.initialWeapons) addWeapon(w);

        kills = 0;
        elapsed = 0;
        paused = false;
        inReward = false;
        rewardMode = 'none';
        pendingLevelUps = 0;
        pendingChestRewards = 0;
        gameOver = false;
        rewardIntro.active = false;
        rewardIntro.timer = 0;
        rewardIntro.duration = 0;
        cinematic.flash = 0;
        cinematic.text = '';
        cinematic.textTTL = 0;

        spawnAcc = 0;
        nextWaveAt = 30;
        nextBossAt = 300;
        waveCount = 0;

        eventBanner.text = '';
        eventBanner.ttl = 0;
        eventBanner.color = 'rgba(255,255,255,0.95)';
        resetCombo();
        combo.critBuff = 0;
        combo.critBuffTimer = 0;
        rage.value = 0;
        rage.active = false;
        rage.timer = 0;
        rage.duration = 0;
        screenShake.x = 0;
        screenShake.y = 0;
        screenShake.mag = 0;
        screenShake.timer = 0;

        overlay.classList.add('hidden');
        rewardCinematic.classList.add('hidden');
        rewardCinematic.textContent = '';
        choicesEl.classList.remove('dimmed');
        warmObstacleChunks(0, 0);
    }

    function startGame() {
        menu.classList.add('hidden');
        menuState = 'start';
        unlockAudio();
        startBgm();
        resetRun();
        announceEvent(`难度：${difficulty.label}`, 'rgba(175,230,255,0.98)', 1.6);
    }

    startBtn.addEventListener('click', () => {
        if (menuState === 'pause') {
            resumeFromPauseMenu();
            return;
        }
        startGame();
    });

    function togglePause() {
        if (inReward || gameOver) return;
        if (menu.classList.contains('hidden')) {
            paused = true;
            setMenuState('pause');
            return;
        }
        if (menuState === 'pause') {
            resumeFromPauseMenu();
        }
    }

    function dash() {
        if (paused || inReward || gameOver) return;
        if (player.dash.cd > 0) return;
        player.dash.duration = 0.18;
        player.dash.cd = 1.0;
        playSfx('dash');
    }

    function addXp(v) {
        player.xp += v * (difficulty.xpGainMul ?? 1);
        while (player.xp >= player.nextXp) {
            player.xp -= player.nextXp;
            player.level += 1;
            player.nextXp = calcNextXp(player.level);
            pendingLevelUps += 1;
            playSfx('levelup');
        }
        openNextRewardPanel();
    }

    function triggerWaveEvent() {
        waveCount += 1;
        const phase = waveCount % 3;
        if (phase === 1) {
            announceEvent(`怪潮 #${waveCount}：迅捷群突袭`, 'rgba(255,190,140,0.98)');
            const n = 16 + Math.floor(waveCount * 1.4);
            for (let i = 0; i < n; i++) spawnEnemy('runner', { spMul: 1.08, hpMul: 0.92 });
            if (waveCount >= 2) spawnEnemy('elite');
            return;
        }
        if (phase === 2) {
            announceEvent(`怪潮 #${waveCount}：重甲压境`, 'rgba(255,160,120,0.98)');
            const n = 10 + Math.floor(waveCount * 1.2);
            for (let i = 0; i < n; i++) spawnEnemy('tank', { hpMul: 1.15 });
            spawnEnemy('elite', { hpMul: 1.08 });
            return;
        }
        announceEvent(`怪潮 #${waveCount}：暗影蜂群`, 'rgba(255,150,210,0.98)');
        const n = 20 + Math.floor(waveCount * 1.8);
        for (let i = 0; i < n; i++) spawnEnemy('swarm');
        if (waveCount >= 3) spawnEnemy('elite', { spMul: 1.06 });
    }

    function trySpawnBoss() {
        const aliveBoss = enemies.some((e) => e.boss && !e.dead);
        if (aliveBoss) {
            announceEvent('已有 Boss 在场，30 秒后重试刷新。', 'rgba(255,130,130,0.96)', 2.2);
            return false;
        }

        announceEvent(`Boss 来袭！(${fmtTime(elapsed)})`, 'rgba(255,90,90,0.99)', 4);
        playSfx('boss');
        spawnEnemy('boss', { hpMul: 1 + waveCount * 0.08 });
        const guards = 4 + Math.floor(waveCount / 3);
        for (let i = 0; i < guards; i++) spawnEnemy('elite', { hpMul: 0.9 });
        return true;
    }

    // ====== Main update ======
    let last = performance.now();
    let fpsAcc = 0;
    let fpsFrames = 0;

    function step(dt) {
        elapsed += dt;
        eventBanner.ttl = Math.max(0, eventBanner.ttl - dt);
        updateComboAndRage(dt);
        warmObstacleChunks(player.x, player.y);

        if (elapsed >= nextWaveAt) {
            triggerWaveEvent();
            nextWaveAt += 30;
        }
        if (elapsed >= nextBossAt) {
            if (trySpawnBoss()) {
                nextBossAt += 300;
            } else {
                nextBossAt += 30;
            }
        }

        player.hp = Math.min(player.hpMax, player.hp + player.regen * dt);
        player.iFrames = Math.max(0, player.iFrames - dt);
        player.dash.cd = Math.max(0, player.dash.cd - dt);
        player.dash.duration = Math.max(0, player.dash.duration - dt);

        const input = moveInput();
        const terrainSlow = terrainSlowMultiplier(player.x, player.y, player.r);
        const spBase = player.baseSpeed * player.speedMul * currentMoveSpeedMul();
        const dashMul = player.dash.duration > 0 ? player.dash.mult : 1;
        player.x += input.x * spBase * dashMul * terrainSlow * dt;
        player.y += input.y * spBase * dashMul * terrainSlow * dt;
        resolveSolidCollisions(player, player.r);
        updateLandmarkDiscovery();

        cam.x += (player.x - cam.x) * (1 - Math.exp(-dt * 12));
        cam.y += (player.y - cam.y) * (1 - Math.exp(-dt * 12));

        const cap = Math.floor((44 + elapsed * 0.72) * difficulty.spawnRateMul);
        const rate = (1.7 + elapsed / 34) * difficulty.spawnRateMul;
        spawnAcc += dt * rate;
        while (spawnAcc >= 1) {
            spawnAcc -= 1;
            if (enemies.length >= cap) continue;
            const roll = Math.random();
            if (roll < 0.56) spawnEnemy('walker');
            else if (roll < 0.84) spawnEnemy('runner');
            else spawnEnemy('tank');
        }

        for (const [k, st] of weapons.entries()) {
            WEAPON_DEFS[k]?.update(st, dt);
        }

        updateOrbitDamage(dt);
        updateEnemies(dt);
        updateProjectiles(dt);
        updatePickups(dt);
        updateFx(dt);
        cleanupDeadEnemies();

        if (!inReward && !paused) openNextRewardPanel();
    }

    function updateOrbitDamage(dt) {
        const orbit = orbitProfile();
        if (!orbit) return;
        for (let i = 0; i < orbit.count; i++) {
            const a = elapsed * orbit.angSpeed + (i / orbit.count) * TAU;
            const ox = player.x + Math.cos(a) * orbit.radius;
            const oy = player.y + Math.sin(a) * orbit.radius;
            for (const e of enemies) {
                if (e.dead) continue;
                if (dist(ox, oy, e.x, e.y) < e.r + orbit.orbR) {
                    dealDamageToEnemy(e, orbit.dps * dt, { canCrit: false, showText: false });
                }
            }
        }
    }

    function castBossSkills(e, dt) {
        e.bossNovaCd -= dt;
        e.bossRainCd -= dt;
        e.bossWaveCd -= dt;

        if (e.bossNovaCd <= 0) {
            e.bossNovaCd = Math.max(2.6, 4.2 - elapsed / 220);
            const count = 14 + Math.floor(Math.min(8, elapsed / 90));
            const rot = e.bossRot + rand(-0.2, 0.2);
            e.bossRot = rot + 0.55;
            for (let i = 0; i < count; i++) {
                const a = rot + (i / count) * TAU;
                const sp = 180 + (i % 2) * 45 + elapsed * 0.12;
                spawnProjectile({
                    hostile: true,
                    kind: 'boss_orb',
                    x: e.x,
                    y: e.y,
                    vx: Math.cos(a) * sp,
                    vy: Math.sin(a) * sp,
                    r: 5.5,
                    ttl: 5.2,
                    dmg: e.dmg * 0.75,
                });
            }
        }

        if (e.bossRainCd <= 0) {
            e.bossRainCd = Math.max(5.8, 8.2 - elapsed / 180);
            announceEvent('Boss 释放陨星弹幕！', 'rgba(255,140,140,0.98)', 1.1);
            const drops = 6 + Math.floor(Math.min(6, elapsed / 120));
            for (let i = 0; i < drops; i++) {
                const a = rand(0, TAU);
                const rr = rand(80, 320);
                spawnProjectile({
                    hostile: true,
                    kind: 'boss_meteor',
                    x: player.x + Math.cos(a) * rr,
                    y: player.y + Math.sin(a) * rr,
                    r: 8,
                    blastR: 48 + rand(-8, 16),
                    delay: 0.74 + rand(0, 0.34),
                    ttl: 1.8,
                    dmg: e.dmg * 1.15,
                });
            }
        }

        if (e.bossWaveCd <= 0) {
            e.bossWaveCd = Math.max(6.6, 9.4 - elapsed / 200);
            const base = Math.atan2(player.y - e.y, player.x - e.x);
            for (let i = 0; i < 7; i++) {
                const spread = (i - 3) * 0.12;
                const a = base + spread;
                spawnProjectile({
                    hostile: true,
                    kind: 'boss_lance',
                    x: e.x + Math.cos(a) * (e.r + 8),
                    y: e.y + Math.sin(a) * (e.r + 8),
                    vx: Math.cos(a) * (360 + i * 10),
                    vy: Math.sin(a) * (360 + i * 10),
                    r: 6,
                    ttl: 2.1,
                    dmg: e.dmg * 0.95,
                });
            }
        }
    }

    function updateEnemies(dt) {
        const aura = auraProfile();

        for (const e of enemies) {
            if (e.dead) continue;

            if (!e.boss && dist(e.x, e.y, player.x, player.y) > WORLD.despawnRadius) {
                e.dead = true;
                continue;
            }

            const dx = player.x - e.x;
            const dy = player.y - e.y;
            const n = norm(dx, dy);

            if (aura && n.l < aura.radius) {
                dealDamageToEnemy(e, aura.dps * dt, { canCrit: false, showText: false });
                e.slow = Math.max(e.slow, aura.slow);
            }
            if (e.dead) continue;

            if (e.boss) {
                e.summonCd -= dt;
                if (e.summonCd <= 0) {
                    e.summonCd = Math.max(4.8, 7.2 - elapsed / 180);
                    for (let i = 0; i < 4; i++) {
                        spawnEnemy('swarm', { around: e, radiusMin: 80, radiusMax: 160, hpMul: 1.1 });
                    }
                    announceEvent('Boss 召唤了蜂群！', 'rgba(255,120,120,0.96)', 1.3);
                }
                castBossSkills(e, dt);
            }

            const terrainSlow = terrainSlowMultiplier(e.x, e.y, e.r);
            const slowMul = (1 - clamp(e.slow, 0, 0.65)) * terrainSlow;
            e.slow = Math.max(0, e.slow - dt * 0.8);

            e.x += n.x * e.sp * slowMul * dt;
            e.y += n.y * e.sp * slowMul * dt;
            resolveSolidCollisions(e, e.r * 0.92);

            if (n.l < e.r + player.r) {
                e.hitCD = Math.max(0, e.hitCD - dt);
                if (e.hitCD <= 0) {
                    e.hitCD = e.boss ? 0.42 : 0.55;
                    hurtPlayer(e.dmg);
                }
            } else {
                e.hitCD = Math.max(0, e.hitCD - dt * 0.6);
            }
        }
    }

    function updateProjectiles(dt) {
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            p.t += dt;

            if (p.hostile) {
                if (p.kind === 'boss_meteor') {
                    p.ttl -= dt;
                    p.delay -= dt;
                    if (p.delay <= 0) {
                        fx.push({ x: p.x, y: p.y, kind: 'boss_meteor_boom', r: p.blastR, t: 0, duration: 0.34 });
                        if (dist(p.x, p.y, player.x, player.y) <= p.blastR + player.r) {
                            hurtPlayer(p.dmg);
                        }
                        projectiles.splice(i, 1);
                    } else if (p.ttl <= 0) {
                        projectiles.splice(i, 1);
                    }
                    continue;
                }

                p.ttl -= dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                if (p.ttl <= 0 || dist(p.x, p.y, player.x, player.y) > WORLD.despawnRadius * 1.35) {
                    projectiles.splice(i, 1);
                    continue;
                }
                if (dist(p.x, p.y, player.x, player.y) < p.r + player.r) {
                    hurtPlayer(p.dmg);
                    fx.push({ x: p.x, y: p.y, t: 0, kind: 'boss_hit', duration: 0.26 });
                    projectiles.splice(i, 1);
                }
                continue;
            }

            if (p.kind === 'bomb') {
                p.ttl -= dt;
                p.fuse -= dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.vx *= Math.pow(0.985, dt * 60);
                p.vy *= Math.pow(0.985, dt * 60);
                if (p.fuse <= 0 || p.ttl <= 0) {
                    explodeAt(p.x, p.y, p.blastR, p.dmg, 0.2, 'boom');
                    projectiles.splice(i, 1);
                }
                continue;
            }

            if (p.kind === 'thunder') {
                p.ttl -= dt;
                p.delay -= dt;
                if (p.delay <= 0) {
                    explodeAt(p.x, p.y, p.blastR, p.dmg, 0.22, 'thunder');
                    fx.push({ x: p.x, y: p.y, kind: 'thunder_beam', t: 0, duration: 0.16 });
                    projectiles.splice(i, 1);
                } else if (p.ttl <= 0) {
                    projectiles.splice(i, 1);
                }
                continue;
            }

            if (p.kind === 'whirl') {
                p.ttl -= dt;
                if (p.ttl <= 0) {
                    projectiles.splice(i, 1);
                    continue;
                }
                const t = findCombatEnemyAt(p.x, p.y, 260);
                if (t) {
                    const n = norm(t.x - p.x, t.y - p.y);
                    const v = norm(p.vx, p.vy);
                    const steer = clamp((p.steer || 1) * dt, 0, 0.22);
                    const nx = v.x * (1 - steer) + n.x * steer;
                    const ny = v.y * (1 - steer) + n.y * steer;
                    const nn = norm(nx, ny);
                    const sp = v.l;
                    p.vx = nn.x * sp;
                    p.vy = nn.y * sp;
                }
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.spin += dt * 6.5;
                for (const e of enemies) {
                    if (e.dead) continue;
                    if (dist(p.x, p.y, e.x, e.y) < p.r + e.r) {
                        dealDamageToEnemy(e, p.dps * dt, { canCrit: false, showText: false });
                        e.slow = Math.max(e.slow, 0.16);
                    }
                }
                continue;
            }

            p.ttl -= dt;
            if (p.ttl <= 0) {
                projectiles.splice(i, 1);
                continue;
            }

            if (p.homing) {
                const t = findCombatEnemyAt(p.x, p.y, 560);
                if (t) {
                    const n = norm(t.x - p.x, t.y - p.y);
                    const v = norm(p.vx, p.vy);
                    const steer = clamp(p.homing * dt, 0, 0.28);
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

            let consume = false;
            for (const e of enemies) {
                if (e.dead) continue;
                if (dist(p.x, p.y, e.x, e.y) >= p.r + e.r) continue;
                if (p.hitSet.has(e)) continue;
                p.hitSet.add(e);

                dealDamageToEnemy(e, p.dmg);
                e.slow = Math.max(e.slow, p.kind === 'wand' || p.kind === 'arcane' ? 0.2 : 0.1);

                if (p.kind === 'arcane') {
                    explodeAt(e.x, e.y, 48 * player.areaMul, p.dmg * 0.65, 0.2, 'arcane');
                }

                p.pierce -= 1;
                if (p.pierce <= 0) {
                    consume = true;
                    break;
                }
            }

            if (consume) projectiles.splice(i, 1);
        }
    }

    function updatePickups(dt) {
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

            if (d >= player.r + g.r) continue;

            if (g.kind === 'xp') {
                addXp(g.value);
                if (g.value >= 6 || Math.random() < 0.22) playSfx('xp');
            } else if (g.kind === 'heal') {
                player.hp = Math.min(player.hpMax, player.hp + g.value);
                playSfx('xp');
            } else if (g.kind === 'chest') {
                pendingChestRewards += g.value;
                announceEvent(`获得宝箱：可选择 ${g.value} 次奖励`, 'rgba(255,220,130,0.98)', 2.8);
                playSfx('chest');
                cinematic.flash = Math.max(cinematic.flash, 0.28);
                for (let j = 0; j < 10; j++) {
                    const a = rand(0, TAU);
                    const sp = rand(80, 210);
                    fx.push({
                        kind: 'chest_spark',
                        x: g.x,
                        y: g.y,
                        vx: Math.cos(a) * sp,
                        vy: Math.sin(a) * sp,
                        t: 0,
                        duration: 0.5,
                    });
                }
                openNextRewardPanel();
            }
            pickups.splice(i, 1);
        }
    }

    function updateFx(dt) {
        for (let i = fx.length - 1; i >= 0; i--) {
            const f = fx[i];
            f.t += dt;
            if (f.vx || f.vy) {
                f.x += (f.vx || 0) * dt;
                f.y += (f.vy || 0) * dt;
                f.vx = (f.vx || 0) * Math.pow(0.95, dt * 60);
                f.vy = (f.vy || 0) * Math.pow(0.95, dt * 60);
            }
            if (f.t > (f.duration || 0.35)) fx.splice(i, 1);
        }
    }

    function cleanupDeadEnemies() {
        for (let i = enemies.length - 1; i >= 0; i--) {
            if (enemies[i].dead) enemies.splice(i, 1);
        }
    }

    // ====== Render ======
    function worldToScreen(x, y) {
        return {
            x: (x - cam.x) + W() / 2 + screenShake.x,
            y: (y - cam.y) + H() / 2 + screenShake.y,
        };
    }

    function draw() {
        ctx.clearRect(0, 0, W(), H());
        drawBackground();
        drawLandmarks();
        drawObstacles();

        for (const g of pickups) drawPickup(g);
        for (const p of projectiles) drawProjectile(p);
        for (const e of enemies) drawEnemy(e);

        drawOrbitVisuals();
        drawPlayer();
        for (const f of fx) drawFx(f);

        drawEventBanner();
        drawCinematicOverlay();
        drawMinimap();
    }

    function drawBackground() {
        const sx = W();
        const sy = H();

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(0, 0, sx, sy);

        const grid = 48;
        const ox = (-(cam.x % grid) + grid) % grid;
        const oy = (-(cam.y % grid) + grid) % grid;

        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        for (let x = ox; x < sx; x += grid) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, sy);
            ctx.stroke();
        }
        for (let y = oy; y < sy; y += grid) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(sx, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawLandmarks() {
        for (const lm of LANDMARKS) {
            const s = worldToScreen(lm.x, lm.y);
            if (s.x + lm.r < -90 || s.x - lm.r > W() + 90 || s.y + lm.r < -90 || s.y - lm.r > H() + 90) continue;

            ctx.save();
            if (lm.type === 'altar') {
                ctx.beginPath();
                ctx.arc(s.x, s.y, lm.r, 0, TAU);
                ctx.fillStyle = 'rgba(125,115,185,0.5)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(212,196,255,0.65)';
                ctx.lineWidth = 3;
                ctx.stroke();
            } else if (lm.type === 'ruin') {
                ctx.fillStyle = 'rgba(90,126,146,0.58)';
                ctx.fillRect(s.x - lm.r * 0.72, s.y - lm.r * 0.66, lm.r * 1.44, lm.r * 1.32);
                ctx.strokeStyle = 'rgba(165,210,225,0.64)';
                ctx.lineWidth = 3;
                ctx.strokeRect(s.x - lm.r * 0.72, s.y - lm.r * 0.66, lm.r * 1.44, lm.r * 1.32);
            } else if (lm.type === 'spire') {
                ctx.beginPath();
                ctx.moveTo(s.x, s.y - lm.r * 0.92);
                ctx.lineTo(s.x + lm.r * 0.72, s.y + lm.r * 0.7);
                ctx.lineTo(s.x - lm.r * 0.72, s.y + lm.r * 0.7);
                ctx.closePath();
                ctx.fillStyle = 'rgba(70,82,120,0.68)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(200,220,255,0.7)';
                ctx.lineWidth = 2.4;
                ctx.stroke();
            } else if (lm.type === 'gate') {
                ctx.beginPath();
                ctx.arc(s.x, s.y, lm.r, 0, TAU);
                ctx.strokeStyle = 'rgba(180,235,255,0.72)';
                ctx.lineWidth = 4;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(s.x, s.y, lm.r * 0.58, 0, TAU);
                ctx.fillStyle = 'rgba(88,160,190,0.34)';
                ctx.fill();
            } else {
                ctx.beginPath();
                ctx.arc(s.x, s.y, lm.r, 0, TAU);
                ctx.fillStyle = 'rgba(115,175,222,0.45)';
                ctx.fill();
                ctx.beginPath();
                ctx.arc(s.x, s.y, lm.r * 0.52, 0, TAU);
                ctx.fillStyle = 'rgba(170,225,255,0.66)';
                ctx.fill();
            }

            const near = dist(player.x, player.y, lm.x, lm.y) < 260;
            if (near) {
                ctx.fillStyle = 'rgba(230,246,255,0.92)';
                ctx.font = '12px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(lm.name, s.x, s.y - lm.r - 10);
            }
            ctx.restore();
        }
    }

    function drawObstacles() {
        forNearbyObstacles(cam.x, cam.y, WORLD.obstacleRange, (ob) => {
            const s = worldToScreen(ob.x, ob.y);
            if (s.x + ob.r < -40 || s.x - ob.r > W() + 40 || s.y + ob.r < -40 || s.y - ob.r > H() + 40) return;

            if (ob.type === 'tree') {
                ctx.save();
                ctx.beginPath();
                ctx.arc(s.x, s.y, ob.r, 0, TAU);
                ctx.fillStyle = 'rgba(44,120,74,0.88)';
                ctx.fill();
                ctx.beginPath();
                ctx.arc(s.x + 3, s.y - 4, ob.r * 0.65, 0, TAU);
                ctx.fillStyle = 'rgba(60,150,92,0.78)';
                ctx.fill();
                ctx.beginPath();
                ctx.arc(s.x, s.y + ob.r * 0.8, ob.r * 0.3, 0, TAU);
                ctx.fillStyle = 'rgba(115,82,55,0.9)';
                ctx.fill();
                ctx.restore();
                return;
            }

            if (ob.type === 'wall') {
                ctx.save();
                ctx.beginPath();
                ctx.arc(s.x, s.y, ob.r, 0, TAU);
                ctx.fillStyle = 'rgba(96,104,126,0.9)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(205,215,235,0.35)';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(s.x - ob.r * 0.22, s.y - ob.r * 0.15, ob.r * 0.3, 0, TAU);
                ctx.fillStyle = 'rgba(125,136,160,0.55)';
                ctx.fill();
                ctx.restore();
                return;
            }

            // river
            ctx.save();
            ctx.beginPath();
            ctx.arc(s.x, s.y, ob.r, 0, TAU);
            ctx.fillStyle = 'rgba(72,128,190,0.34)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(130,195,255,0.42)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(s.x + ob.r * 0.2, s.y - ob.r * 0.1, ob.r * 0.45, 0, TAU);
            ctx.fillStyle = 'rgba(110,180,235,0.22)';
            ctx.fill();
            ctx.restore();
        });
    }

    function drawPlayer() {
        const p = worldToScreen(player.x, player.y);
        const aura = auraProfile();

        if (aura) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(p.x, p.y, aura.radius, 0, TAU);
            ctx.fillStyle = weaponLevel('plague_core') > 0
                ? 'rgba(150,255,140,0.09)'
                : 'rgba(170,255,220,0.08)';
            ctx.fill();
            ctx.strokeStyle = weaponLevel('plague_core') > 0
                ? 'rgba(170,255,150,0.24)'
                : 'rgba(170,255,220,0.18)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, player.r, 0, TAU);
        ctx.fillStyle = player.iFrames > 0 ? 'rgba(255,204,102,0.92)' : 'rgba(255,255,255,0.92)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();

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
        ctx.fillStyle = e.color;
        ctx.fill();

        if (e.elite) {
            ctx.strokeStyle = 'rgba(255,236,150,0.9)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        if (e.boss) {
            ctx.strokeStyle = 'rgba(255,245,180,0.95)';
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        const w = e.boss ? e.r * 3 : e.r * 2.2;
        const h = e.boss ? 6 : 4;
        const x = p.x - w / 2;
        const y = p.y - e.r - (e.boss ? 16 : 10);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = e.boss
            ? 'rgba(255,120,120,0.95)'
            : e.elite
                ? 'rgba(255,232,132,0.92)'
                : 'rgba(102,255,204,0.85)';
        ctx.fillRect(x, y, w * clamp(e.hp / e.hpMax, 0, 1), h);

        if (e.boss) {
            ctx.fillStyle = 'rgba(255,235,210,0.95)';
            ctx.font = '12px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('BOSS', p.x, y - 4);
        }
        ctx.restore();
    }

    function drawProjectile(p) {
        const s = worldToScreen(p.x, p.y);
        ctx.save();

        if (p.hostile) {
            if (p.kind === 'boss_meteor') {
                const pulse = 0.6 + Math.sin((p.t || 0) * 22) * 0.2;
                ctx.globalAlpha = clamp(0.35 + (1 - p.delay) * 0.6, 0.35, 0.95);
                ctx.beginPath();
                ctx.arc(s.x, s.y, (p.blastR || 36) * pulse, 0, TAU);
                ctx.strokeStyle = 'rgba(255,120,120,0.95)';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(s.x, s.y, 8, 0, TAU);
                ctx.fillStyle = 'rgba(255,170,120,0.92)';
                ctx.fill();
                ctx.restore();
                return;
            }

            if (p.kind === 'boss_lance') {
                const a = Math.atan2(p.vy, p.vx);
                ctx.translate(s.x, s.y);
                ctx.rotate(a);
                ctx.fillStyle = 'rgba(255,130,130,0.95)';
                ctx.beginPath();
                ctx.moveTo(10, 0);
                ctx.lineTo(-8, -4);
                ctx.lineTo(-8, 4);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
                return;
            }

            ctx.beginPath();
            ctx.arc(s.x, s.y, p.r, 0, TAU);
            ctx.fillStyle = 'rgba(255,110,110,0.95)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(s.x, s.y, p.r * 0.48, 0, TAU);
            ctx.fillStyle = 'rgba(255,210,180,0.92)';
            ctx.fill();
            ctx.restore();
            return;
        }

        if (p.kind === 'thunder') {
            const a = clamp(0.3 + (0.8 - p.delay), 0.2, 0.9);
            ctx.globalAlpha = a;
            ctx.beginPath();
            ctx.arc(s.x, s.y, p.blastR, 0, TAU);
            ctx.strokeStyle = 'rgba(170,210,255,0.75)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
            return;
        }

        if (p.kind === 'whirl') {
            ctx.translate(s.x, s.y);
            ctx.rotate(p.spin || 0);
            ctx.beginPath();
            ctx.arc(0, 0, p.r, 0, TAU);
            ctx.strokeStyle = 'rgba(175,240,255,0.85)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, p.r * 0.55, 0, TAU);
            ctx.strokeStyle = 'rgba(110,210,255,0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
            return;
        }

        if (p.kind === 'bomb') {
            ctx.beginPath();
            ctx.arc(s.x, s.y, p.r, 0, TAU);
            ctx.fillStyle = 'rgba(255,160,120,0.9)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(s.x, s.y, p.r * 0.45, 0, TAU);
            ctx.fillStyle = 'rgba(65,30,30,0.85)';
            ctx.fill();
            ctx.restore();
            return;
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, p.r, 0, TAU);
        let color = 'rgba(255,255,255,0.92)';
        if (p.kind === 'wand') color = 'rgba(140,200,255,0.9)';
        if (p.kind === 'spray') color = 'rgba(255,220,150,0.92)';
        if (p.kind === 'storm') color = 'rgba(215,245,255,0.95)';
        if (p.kind === 'arcane') color = 'rgba(180,160,255,0.95)';
        ctx.fillStyle = color;
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
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.stroke();
            ctx.restore();
            return;
        }
        if (g.kind === 'heal') {
            ctx.beginPath();
            ctx.arc(s.x, s.y, g.r, 0, TAU);
            ctx.fillStyle = 'rgba(255,204,102,0.9)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.stroke();
            ctx.restore();
            return;
        }
        // chest
        ctx.translate(s.x, s.y);
        ctx.fillStyle = 'rgba(255,190,90,0.95)';
        ctx.fillRect(-g.r, -g.r * 0.65, g.r * 2, g.r * 1.3);
        ctx.fillStyle = 'rgba(124,72,36,0.92)';
        ctx.fillRect(-g.r, -g.r * 0.2, g.r * 2, g.r * 0.4);
        ctx.fillStyle = 'rgba(255,235,170,0.95)';
        ctx.fillRect(-2, -g.r * 0.6, 4, g.r * 1.2);
        ctx.restore();
    }

    function drawFx(f) {
        const a = 1 - f.t / (f.duration || 0.35);
        ctx.save();
        ctx.globalAlpha = clamp(a, 0, 1);

        if (f.kind === 'chain' && f.points?.length > 1) {
            ctx.strokeStyle = 'rgba(165,220,255,0.95)';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            for (let i = 0; i < f.points.length; i++) {
                const s = worldToScreen(f.points[i].x, f.points[i].y);
                if (i === 0) ctx.moveTo(s.x, s.y);
                else ctx.lineTo(s.x, s.y);
            }
            ctx.stroke();
            ctx.restore();
            return;
        }

        if (f.kind === 'thunder_beam') {
            const s = worldToScreen(f.x, f.y);
            ctx.strokeStyle = 'rgba(190,230,255,0.95)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(s.x, -20);
            ctx.lineTo(s.x, s.y);
            ctx.stroke();
            ctx.restore();
            return;
        }

        if (f.kind === 'evolve_ring') {
            const s = worldToScreen(f.x, f.y);
            const rr = (f.r || 24) + f.t * 220;
            ctx.beginPath();
            ctx.arc(s.x, s.y, rr, 0, TAU);
            ctx.strokeStyle = 'rgba(255,245,170,0.95)';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.restore();
            return;
        }

        if (f.kind === 'evolve_spark' || f.kind === 'chest_spark') {
            const s = worldToScreen(f.x, f.y);
            const rr = f.kind === 'evolve_spark' ? 3.1 : 2.6;
            ctx.beginPath();
            ctx.arc(s.x, s.y, rr, 0, TAU);
            ctx.fillStyle = f.kind === 'evolve_spark'
                ? 'rgba(255,244,170,0.95)'
                : 'rgba(255,214,130,0.9)';
            ctx.fill();
            ctx.restore();
            return;
        }

        if (f.kind === 'boss_meteor_boom') {
            const s = worldToScreen(f.x, f.y);
            ctx.beginPath();
            ctx.arc(s.x, s.y, (f.r || 40) * (0.35 + f.t * 2.5), 0, TAU);
            ctx.strokeStyle = 'rgba(255,140,120,0.95)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
            return;
        }

        if (f.kind === 'landmark_ping') {
            const s = worldToScreen(f.x, f.y);
            ctx.beginPath();
            ctx.arc(s.x, s.y, (f.r || 46) + f.t * 52, 0, TAU);
            ctx.strokeStyle = 'rgba(160,220,255,0.92)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
            return;
        }

        if (f.kind === 'dmg_text') {
            const s = worldToScreen(f.x, f.y);
            ctx.fillStyle = f.color || 'rgba(255,255,255,0.9)';
            ctx.font = f.kind === 'dmg_text' ? 'bold 14px system-ui, sans-serif' : '12px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(f.text || '', s.x, s.y);
            ctx.restore();
            return;
        }

        if (f.kind === 'boom' || f.kind === 'thunder' || f.kind === 'arcane' || f.kind === 'combo_boom' || f.kind === 'combo_big') {
            const s = worldToScreen(f.x, f.y);
            ctx.beginPath();
            ctx.arc(s.x, s.y, (f.r || 30) * (0.35 + f.t * 2.2), 0, TAU);
            ctx.strokeStyle = f.kind === 'thunder'
                ? 'rgba(170,220,255,0.95)'
                : f.kind === 'arcane'
                    ? 'rgba(205,170,255,0.95)'
                    : f.kind === 'combo_boom'
                        ? 'rgba(255,232,140,0.95)'
                        : f.kind === 'combo_big'
                            ? 'rgba(255,170,120,0.96)'
                    : 'rgba(255,190,120,0.95)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
            return;
        }

        const s = worldToScreen(f.x, f.y);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 10 + f.t * 30, 0, TAU);
        ctx.strokeStyle = f.kind === 'hurt'
            ? 'rgba(255,107,107,0.92)'
            : f.kind === 'crit_hit'
                ? 'rgba(255,230,140,0.95)'
            : f.kind === 'boss_hit'
                ? 'rgba(255,140,140,0.92)'
                : 'rgba(255,255,255,0.72)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }

    function drawOrbitVisuals() {
        const orbit = orbitProfile();
        if (!orbit) return;
        const center = worldToScreen(player.x, player.y);
        ctx.save();

        ctx.strokeStyle = weaponLevel('nova_ring') > 0
            ? 'rgba(220,210,255,0.26)'
            : 'rgba(140,200,255,0.18)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(center.x, center.y, orbit.radius, 0, TAU);
        ctx.stroke();

        for (let i = 0; i < orbit.count; i++) {
            const a = elapsed * orbit.angSpeed + (i / orbit.count) * TAU;
            const ox = center.x + Math.cos(a) * orbit.radius;
            const oy = center.y + Math.sin(a) * orbit.radius;
            ctx.beginPath();
            ctx.arc(ox, oy, orbit.orbR, 0, TAU);
            ctx.fillStyle = weaponLevel('nova_ring') > 0
                ? 'rgba(210,175,255,0.94)'
                : 'rgba(140,200,255,0.92)';
            ctx.fill();
        }
        ctx.restore();
    }

    function drawEventBanner() {
        if (eventBanner.ttl <= 0) return;
        const a = clamp(eventBanner.ttl / 1.2, 0, 1);
        const hudBottom = (hudRoot?.offsetHeight || 0) + 32;
        let y = isTouch ? Math.max(116, hudBottom) : Math.max(86, hudBottom);
        if (isTouch && minimapWrapEl) {
            const r = minimapWrapEl.getBoundingClientRect();
            y = Math.max(y, r.bottom + 18);
        }
        y = Math.min(y, H() - 24);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = eventBanner.color;
        ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(eventBanner.text, W() / 2, y);
        ctx.restore();
    }

    function drawCinematicOverlay() {
        if (cinematic.flash > 0) {
            ctx.save();
            ctx.globalAlpha = clamp(cinematic.flash, 0, 1) * 0.32;
            ctx.fillStyle = 'rgba(255,240,185,0.95)';
            ctx.fillRect(0, 0, W(), H());
            ctx.restore();
        }

        if (cinematic.textTTL > 0 && cinematic.text) {
            const a = clamp(cinematic.textTTL / 0.7, 0, 1);
            ctx.save();
            ctx.globalAlpha = a;
            ctx.fillStyle = 'rgba(255,245,180,0.96)';
            ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(cinematic.text, W() / 2, H() * 0.28);
            ctx.restore();
        }
    }

    function drawMinimap() {
        const w = minimapCanvas.clientWidth;
        const h = minimapCanvas.clientHeight;
        if (!w || !h) return;
        const mctx = minimapCtx;
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(w, h) * 0.47;
        const range = WORLD.minimapRange;

        mctx.clearRect(0, 0, w, h);
        mctx.save();
        mctx.beginPath();
        mctx.arc(cx, cy, r, 0, TAU);
        mctx.clip();

        mctx.fillStyle = 'rgba(8,14,28,0.82)';
        mctx.fillRect(0, 0, w, h);

        mctx.strokeStyle = 'rgba(180,200,230,0.16)';
        mctx.lineWidth = 1;
        mctx.beginPath();
        mctx.moveTo(cx, 0); mctx.lineTo(cx, h);
        mctx.moveTo(0, cy); mctx.lineTo(w, cy);
        mctx.stroke();

        const toMini = (wx, wy, clampEdge = false) => {
            let dx = (wx - player.x) / range;
            let dy = (wy - player.y) / range;
            const d = Math.hypot(dx, dy);
            if (clampEdge && d > 1) {
                dx /= d;
                dy /= d;
            }
            return {
                x: cx + dx * r,
                y: cy + dy * r,
                out: d > 1,
            };
        };

        forNearbyObstacles(player.x, player.y, 2, (ob) => {
            const p = toMini(ob.x, ob.y);
            if (p.out) return;
            const rr = clamp((ob.r / range) * r * 1.6, 1, 4.5);
            mctx.beginPath();
            mctx.arc(p.x, p.y, rr, 0, TAU);
            mctx.fillStyle = ob.type === 'river'
                ? 'rgba(110,180,235,0.6)'
                : ob.type === 'wall'
                    ? 'rgba(180,190,210,0.68)'
                    : 'rgba(84,170,110,0.66)';
            mctx.fill();
        });

        for (const lm of LANDMARKS) {
            const p = toMini(lm.x, lm.y, true);
            const rr = p.out ? 2.2 : 3.4;
            mctx.beginPath();
            mctx.arc(p.x, p.y, rr, 0, TAU);
            mctx.fillStyle = discoveredLandmarks.has(lm.id)
                ? 'rgba(160,230,255,0.95)'
                : 'rgba(120,150,190,0.8)';
            mctx.fill();
        }

        for (const e of enemies) {
            if (e.dead) continue;
            const p = toMini(e.x, e.y);
            if (p.out) continue;
            const rr = e.boss ? 3.2 : e.elite ? 2.5 : 1.5;
            mctx.beginPath();
            mctx.arc(p.x, p.y, rr, 0, TAU);
            mctx.fillStyle = e.boss
                ? 'rgba(255,92,92,0.97)'
                : e.elite
                    ? 'rgba(255,220,120,0.96)'
                    : 'rgba(255,160,160,0.88)';
            mctx.fill();
        }

        mctx.beginPath();
        mctx.arc(cx, cy, 2.8, 0, TAU);
        mctx.fillStyle = 'rgba(220,255,255,0.98)';
        mctx.fill();

        mctx.restore();
        mctx.strokeStyle = 'rgba(210,225,255,0.36)';
        mctx.lineWidth = 1;
        mctx.beginPath();
        mctx.arc(cx, cy, r, 0, TAU);
        mctx.stroke();
    }

    // ====== HUD ======
    function updateHUD(dt) {
        hud.time.textContent = fmtTime(elapsed);
        hud.level.textContent = String(player.level);
        const hpPct = clamp(player.hp / player.hpMax, 0, 1);
        hud.hp.textContent = `${Math.round(player.hp)} / ${Math.round(player.hpMax)}`;
        if (hud.hpfill) {
            hud.hpfill.style.transform = `scaleX(${hpPct})`;
            if (hpPct > 0.66) {
                hud.hpfill.style.background = 'linear-gradient(90deg, rgba(89,255,175,.95), rgba(118,235,255,.95))';
                hud.hp.style.color = 'rgba(219,255,240,.95)';
            } else if (hpPct > 0.33) {
                hud.hpfill.style.background = 'linear-gradient(90deg, rgba(255,216,96,.96), rgba(255,145,74,.95))';
                hud.hp.style.color = 'rgba(255,233,184,.97)';
            } else {
                hud.hpfill.style.background = 'linear-gradient(90deg, rgba(255,104,104,.98), rgba(255,64,94,.96))';
                hud.hp.style.color = 'rgba(255,188,188,.98)';
            }
        }
        hud.kills.textContent = String(kills);
        hud.enemies.textContent = String(enemies.length);
        hud.combo.textContent = combo.count > 0 ? `x${combo.count}` : 'x0';
        hud.rage.textContent = rage.active ? `暴走 ${rage.timer.toFixed(1)}s` : `${Math.round(rage.value)}%`;
        hud.crit.textContent = `${Math.round(currentCritChance() * 100)}%`;

        const pct = clamp(player.xp / player.nextXp, 0, 1) * 100;
        hud.xpfill.style.width = `${pct}%`;
        hud.xptxt.textContent = `XP ${Math.floor(player.xp)} / ${player.nextXp}`;

        if (hud.event) {
            hud.event.textContent = eventBanner.ttl > 0 ? eventBanner.text : '-';
        }

        fpsAcc += dt;
        fpsFrames++;
        if (fpsAcc >= 0.4) {
            hud.fps.textContent = String(Math.round(fpsFrames / fpsAcc));
            fpsAcc = 0;
            fpsFrames = 0;
        }
    }

    function fmtTime(sec) {
        sec = Math.max(0, sec);
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function updateCinematics(dt) {
        updateRewardIntro(dt);
        cinematic.flash = Math.max(0, cinematic.flash - dt * 1.35);
        cinematic.textTTL = Math.max(0, cinematic.textTTL - dt);
        if (rewardIntro.active) {
            rewardCinematic.textContent = `宝箱开启中... 剩余 ${pendingChestRewards} 次奖励`;
        }

        if (screenShake.timer > 0 || screenShake.mag > 0.1) {
            screenShake.timer = Math.max(0, screenShake.timer - dt);
            screenShake.mag = Math.max(0, screenShake.mag - dt * 16);
            const m = screenShake.mag;
            screenShake.x = rand(-m, m);
            screenShake.y = rand(-m, m);
        } else {
            screenShake.x = 0;
            screenShake.y = 0;
            screenShake.mag = 0;
            screenShake.timer = 0;
        }
    }

    // ====== Main loop ======
    function loop(now) {
        const dt = Math.min(0.033, (now - last) / 1000);
        last = now;

        if (!paused && !inReward && !gameOver && menu.classList.contains('hidden')) {
            step(dt);
        }
        updateCinematics(dt);
        draw();
        updateHUD(dt);

        if (!inReward && !paused && !gameOver && player.xp >= player.nextXp) {
            addXp(0);
        }

        requestAnimationFrame(loop);
    }

    // ====== Boot ======
    function init() {
        resize();
        resetRun();
        setMenuState('start');

        if (isTouch) mobile.classList.remove('hidden');
    }

    init();
    requestAnimationFrame((t) => {
        last = t;
        loop(t);
    });
})();
