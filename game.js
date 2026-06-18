        const canvas = document.getElementById("pong");
        const ctx = canvas.getContext("2d");
        const container = document.getElementById("game-container");
        const chargeBar = document.getElementById("boss-charge-bar");
        const chargeFill = document.getElementById("boss-charge-fill");
        
        let gameState = 'start';
        let currentLevel = 1;
        let startingLevelChoice = 1;
        let animationId = null;

        let pointsToLevelUp = 5;
        let pointsToWin = 25;
        let aiDifficultyMultiplier = 1.0;
        let bossSizeMultiplier = 1.0;
        let customBaseBallSpeed = 12; // Buffed baseline speed
        let customDashMultiplier = 1.75;

        const PLAYER_PADDLE_SPEED = 18; // Fast paddle movement to match speed

        // Swapped Phantom (Level 2) and Titan (Level 3)
        // Buffed Gaismagorm: Paddle is now extremely slow (baseAiSpeed: 0.02)
        const levels = [
            { name: "The Recruit", color: "#ff00de", baseH: 100, baseAiSpeed: 0.07, ballAdd: 0 },
            { name: "The Phantom", color: "#00ff99", baseH: 60, baseAiSpeed: 0.1, ballAdd: 3.0 },
            { name: "The Titan", color: "#ff3300", baseH: 120, baseAiSpeed: 0.03, ballAdd: 1.5 },
            { name: "The Pulsar", color: "#ffff00", baseH: 110, baseAiSpeed: 0.08, ballAdd: 4.5 },
            { name: "Primordial Knight", color: "#ff2e2e", baseH: 90, baseAiSpeed: 0.11, ballAdd: 6.0, unlock: "The Final Soul" },
            { name: "Gaismagorm", color: "#6a00ff", baseH: 180, baseAiSpeed: 0.02, ballAdd: 7.5, unlock: "QUEST COMPLETE" }
        ];

        let activeLevels = [];

        function updateActiveLevels() {
            activeLevels = levels.map((l, index) => {
                let defaultUnlock = "Swift Dash (E)";
                if (index === 1) defaultUnlock = "Phantom Blink (Q)";
                else if (index === 2) defaultUnlock = "Titan Shield (Space)";
                else if (index === 3) defaultUnlock = "Chrono Rift (Shift)";
                else if (index === 4) defaultUnlock = "The Final Soul";
                else if (index === 5) defaultUnlock = "QUEST COMPLETE";

                return {
                    ...l,
                    h: l.baseH * (l.name === "Gaismagorm" ? 1.2 : bossSizeMultiplier),
                    aiSpeed: l.baseAiSpeed * aiDifficultyMultiplier,
                    ball: customBaseBallSpeed + l.ballAdd,
                    unlock: l.unlock || defaultUnlock
                };
            });
        }

        // Swapped slots: blink is now abilities[1] and shield is now abilities[2]
        const abilities = [
            { id: 'dash', key: 'e', duration: 250, cd: 3000, lastUsed: 0, active: false },
            { id: 'blink', key: 'q', duration: 150, cd: 6000, lastUsed: 0, active: false },
            { id: 'shield', key: ' ', duration: 4500, cd: 13000, lastUsed: 0, active: false },
            { id: 'chrono', key: 'Shift', duration: 3500, cd: 16000, lastUsed: 0, active: false }
        ];

        const player = { x: 40, y: 250, w: 15, h: 100, baseH: 100, score: 0, color: "#00f2ff", targetY: 250, stunTimer: 0 };
        const ai = { 
            x: 1145, y: 250, w: 15, h: 100, baseH: 100, score: 0, color: "#ff00de", aiSpeed: 0.05, 
            blinkCD: 0, charge: 0, isCharging: false, chargeTime: 0, launchQueue: [], shootTimer: 0, 
            isTargeting: false, targetY: 250, armX: 1100, armY: 250, armW: 220, armH: 110, isGrabbing: false, 
            grabTimer: 0, swipeTimer: 0, isSwiping: false, swipeDir: 1, skyLaserMarkers: [], skyLaserTimer: 0,
            grabAttempted: false, isCataclysmActive: false, cataclysmTimer: 0
        };
        
        let balls = [];
        let bossProjectiles = [];
        let gameParticles = [];
        let cataclysmHazards = [];
        let laserSpiralRot = 0;
        let secretTransitionTimer = 0;
        let screenCracks = [];
        let countdownFrames = 0;
        let goFrames = 0;

        // Custom Theme variables
        let paddleHistory = { player: [], ai: [] };
        let themeParticles = [];
        let pulseRadius = 0;

        // --- Web Audio Procedural Music Synthesizer ---
        const Synth = {
            ctx: null,
            masterGain: null,
            noiseBuffer: null,
            nextNoteTime: 0.0,
            timerId: null,
            isMuted: false,
            step: 0,
            measure: 0, // Measure counter to introduce rhythmic variations
            
            init() {
                if (this.ctx) return;
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (!AudioContextClass) return;
                this.ctx = new AudioContextClass();
                this.masterGain = this.ctx.createGain();
                this.masterGain.gain.setValueAtTime(0.12, this.ctx.currentTime); // safe target volume
                this.masterGain.connect(this.ctx.destination);
                
                // Build robust pseudo-noise buffer for hats, snares, and breath noise
                const bufferSize = this.ctx.sampleRate * 1.5;
                this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const data = this.noiseBuffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = Math.random() * 2 - 1;
                }
                
                this.scheduler();
            },
            
            toggleMute() {
                this.init();
                this.isMuted = !this.isMuted;
                if (this.masterGain && this.ctx) {
                    this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.12, this.ctx.currentTime);
                }
                return this.isMuted;
            },
            
            scheduler() {
                const scheduleAheadTime = 0.1;
                const lookahead = 25.0;
                
                const nextNote = () => {
                    const secondsPerBeat = 60.0 / this.getTempo();
                    this.nextNoteTime += 0.25 * secondsPerBeat; // 16th notes
                    this.step = (this.step + 1) % 16;
                    if (this.step === 0) {
                        this.measure = (this.measure + 1) % 4; // 4-measure loops
                    }
                };
                
                const run = () => {
                    if (this.ctx) {
                        if (gameState === 'playing' || gameState === 'secret_transition') {
                            while (this.nextNoteTime < this.ctx.currentTime + scheduleAheadTime) {
                                this.playNoteForStep(this.step, this.nextNoteTime);
                                nextNote();
                            }
                        } else {
                            this.nextNoteTime = this.ctx.currentTime;
                        }
                    }
                    this.timerId = setTimeout(run, lookahead);
                };
                
                this.nextNoteTime = this.ctx.currentTime;
                run();
            },
            
            getTempo() {
                switch(currentLevel) {
                    case 1: return 125; // Recruit: Fast cyber-punk tempo
                    case 2: return 90;  // Phantom: Spooky lyrical tempo
                    case 3: return 130; // Titan: Industrial heavy march
                    case 4: return 115; // Pulsar: Celestial bell tempo
                    case 5: return 145; // Knight: Symphonic blast metal tempo
                    case 6: return 100; // Gaismagorm: Apocalyptic sludge tempo
                    default: return 120;
                }
            },
            
            playNoteForStep(step, time) {
                if (this.isMuted) return;
                
                switch(currentLevel) {
                    case 1: 
                        this.playRecruit(step, time);
                        break;
                    case 2: 
                        this.playPhantom(step, time);
                        break;
                    case 3: 
                        this.playTitan(step, time);
                        break;
                    case 4: 
                        this.playPulsar(step, time);
                        break;
                    case 5: 
                        this.playKnight(step, time);
                        break;
                    case 6: 
                        this.playGaismagorm(step, time);
                        break;
                }
            },

            playOsc(freq, type, duration, gainVal, time, slideFreq = null) {
                if (!Synth.ctx) return;
                const osc = Synth.ctx.createOscillator();
                const gainNode = Synth.ctx.createGain();
                
                osc.type = type;
                osc.frequency.setValueAtTime(freq, time);
                if (slideFreq) {
                    osc.frequency.exponentialRampToValueAtTime(slideFreq, time + duration);
                }
                
                gainNode.gain.setValueAtTime(0, time);
                gainNode.gain.linearRampToValueAtTime(gainVal, time + 0.01);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, time + duration);
                
                osc.connect(gainNode);
                gainNode.connect(Synth.masterGain);
                
                osc.start(time);
                osc.stop(time + duration);
            },

            // --- 1st Prototype Electro Noise Drums ---
            playDrumKick(time) {
                this.playOsc(150, 'sine', 0.15, 0.45, time, 40);
            },

            playDrumSnare(time, soft = false) {
                this.playOsc(180, 'triangle', 0.1, soft ? 0.12 : 0.25, time, 80);
                if (this.ctx && this.noiseBuffer) {
                    const source = this.ctx.createBufferSource();
                    source.buffer = this.noiseBuffer;
                    const filter = this.ctx.createBiquadFilter();
                    filter.type = 'highpass';
                    filter.frequency.setValueAtTime(1200, time);
                    const gain = this.ctx.createGain();
                    gain.gain.setValueAtTime(soft ? 0.08 : 0.18, time);
                    gain.gain.exponentialRampToValueAtTime(0.0001, time + (soft ? 0.08 : 0.18));
                    source.connect(filter);
                    filter.connect(gain);
                    gain.connect(this.masterGain);
                    source.start(time);
                    source.stop(time + (soft ? 0.08 : 0.18));
                }
            },

            playDrumHat(time, open = false) {
                if (this.ctx && this.noiseBuffer) {
                    const source = this.ctx.createBufferSource();
                    source.buffer = this.noiseBuffer;
                    const filter = this.ctx.createBiquadFilter();
                    filter.type = 'highpass';
                    filter.frequency.setValueAtTime(7500, time);
                    const gain = this.ctx.createGain();
                    gain.gain.setValueAtTime(0.08, time);
                    gain.gain.exponentialRampToValueAtTime(0.0001, time + (open ? 0.3 : 0.05));
                    source.connect(filter);
                    filter.connect(gain);
                    gain.connect(this.masterGain);
                    source.start(time);
                    source.stop(time + (open ? 0.3 : 0.05));
                }
            },

            playBassGuitar(freq, duration, gainVal, time) {
                this.playOsc(freq, 'triangle', duration, gainVal, time);
            },

            playMetalGuitar(freq, duration, gainVal, time, slideFreq = null) {
                // Detuned dual square/sawwave crunch
                this.playOsc(freq, 'sawtooth', duration, gainVal, time, slideFreq);
                this.playOsc(freq * 1.008, 'square', duration, gainVal * 0.5, time, slideFreq ? slideFreq * 1.008 : null);
            },

            // --- Custom Dynamic Synthesized Hit Sounds (Reverted to 1st Prototype Electro Style) ---
            playHitSound(isPlayer, ballSpeed = 6) {
                this.init();
                if (this.isMuted || !this.ctx) return;
                
                const now = this.ctx.currentTime;
                if (isPlayer) {
                    const baseFreq = 300 + (ballSpeed * 15);
                    this.playOsc(baseFreq, 'square', 0.12, 0.18, now, baseFreq * 1.8);
                } else {
                    let baseFreq = 180;
                    let type = 'triangle';
                    let slideFreq = 90;
                    let duration = 0.15;
                    
                    if (currentLevel === 1) {
                        baseFreq = 220; slideFreq = 110; type = 'square'; duration = 0.08;
                    } else if (currentLevel === 2) {
                        baseFreq = 440; slideFreq = 220; type = 'sine'; duration = 0.15;
                    } else if (currentLevel === 3) {
                        baseFreq = 140; slideFreq = 45; type = 'sawtooth'; duration = 0.18;
                    } else if (currentLevel === 4) {
                        baseFreq = 587.33; slideFreq = 293.66; type = 'sine'; duration = 0.14;
                    } else if (currentLevel === 5) {
                        baseFreq = 293.66; slideFreq = 73.42; type = 'triangle'; duration = 0.12;
                    } else if (currentLevel === 6) {
                        baseFreq = 98.00; slideFreq = 24.50; type = 'sawtooth'; duration = 0.22;
                    }
                    
                    this.playOsc(baseFreq, type, duration, 0.25, now, slideFreq);
                }
            },

            // --- BOSS TRACK 1: THE RECRUIT (Cyberpunk Lute Rock - Reverted) ---
            playRecruit(step, time) {
                const scale = [130.81, 155.56, 174.61, 196.00, 233.08, 261.63];
                const arp = [0, 4, 2, 5, 3, 4, 2, 1, 0, 4, 2, 5, 3, 5, 4, 2];
                const note = scale[arp[step % arp.length]];
                
                this.playOsc(note * 2, 'square', 0.12, 0.12, time); 
                if (step % 2 === 0) {
                    this.playOsc(scale[step % 3] * 0.5, 'triangle', 0.15, 0.2, time); 
                }

                // --- DRUMS WITH BAR VARIETY ---
                if (this.measure < 3) { // Main groove
                    if (step === 0 || step === 8) this.playDrumKick(time);
                    if (step === 4 || step === 12) this.playDrumSnare(time);
                    if (step % 2 === 1) this.playDrumHat(time);
                } else { // 4th Bar Fill variation
                    if (step === 0 || step === 4 || step === 8) this.playDrumKick(time);
                    if (step >= 12) { // Rapid snare roll ending
                        this.playDrumSnare(time, true);
                    } else {
                        if (step % 2 === 1) this.playDrumHat(time);
                    }
                }
            },

            // --- BOSS TRACK 2: THE PHANTOM (Woodwind Goth Rock - Reverted) ---
            playPhantom(step, time) {
                const scale = [220.00, 246.94, 261.63, 293.66, 329.63, 349.23, 392.00];
                const bassScale = [110.00, 130.81, 146.83, 164.81];
                
                // 1st Prototype Eerie Sine Pad
                if (step % 2 === 0) {
                    const bassNote = bassScale[(Math.floor(step / 2) + this.measure) % bassScale.length];
                    this.playOsc(bassNote, 'sine', 0.5, 0.2, time);
                }

                if (step === 0 || step === 8) {
                    const melody = [0, 2, 4, 3, 5, 4, 2, 1];
                    const note = scale[melody[(Math.floor(step/8) + this.measure) % melody.length]] * 2;
                    this.playOsc(note, 'sine', 0.6, 0.15, time); // high ghostly sine
                }

                // --- POST-PUNK DRUMS ---
                if (this.measure < 3) {
                    if (step === 0 || step === 10) this.playDrumKick(time);
                    if (step === 4 || step === 12) this.playDrumSnare(time);
                    if (step % 4 === 2) this.playDrumHat(time, true); // Open hat shuffle
                } else { // Drum Fill Bar
                    if (step === 0 || step === 6 || step === 10) this.playDrumKick(time);
                    if (step === 4 || step === 12 || step === 14) this.playDrumSnare(time, step === 14);
                }
            },

            // --- BOSS TRACK 3: THE TITAN (Heavy Industrial Metal - Reverted) ---
            playTitan(step, time) {
                const guitarScale = [87.31, 116.54, 98.00, 110.00]; // Low F, Bb, G, A
                const riff = [0, 0, 1, 0, 2, 2, 1, 3, 0, 0, 1, 1, 2, 3, 2, 0];
                const note = guitarScale[riff[step % riff.length]];

                // 1st Prototype sawtooth industrial bass
                if (step % 2 === 0) {
                    this.playOsc(note, 'sawtooth', 0.2, 0.15, time);
                    this.playOsc(note * 1.008, 'sawtooth', 0.2, 0.15, time);
                }

                // --- DOUBLE BASS METAL KICK PATTERNS ---
                if (this.measure < 3) {
                    // Galloping kick drums
                    if (step === 0 || step === 3 || step === 8 || step === 11) this.playDrumKick(time);
                    if (step === 4 || step === 12) this.playDrumSnare(time);
                    if (step % 4 === 2) this.playDrumHat(time);
                } else { // Heavy blast beat fill
                    this.playDrumKick(time);
                    if (step % 4 === 2 || step % 4 === 0) {
                        this.playDrumSnare(time, true);
                    }
                    if (step === 15) this.playOsc(400, 'triangle', 0.08, 0.3, time, 100); // Crash clang accent
                }
            },

            // --- BOSS TRACK 4: THE PULSAR (Cosmic Celestial Space Rock - Reverted) ---
            playPulsar(step, time) {
                const scale = [329.63, 369.99, 415.30, 493.88, 554.37, 659.25]; // E major pentatonic
                const pattern = [0, 3, 1, 4, 2, 5, 3, 1];
                
                // 1st Prototype triangle bells
                if (step % 2 === 1) {
                    const note = scale[pattern[(step + this.measure) % pattern.length]];
                    this.playOsc(note, 'triangle', 0.35, 0.15, time);
                    this.playOsc(note * 1.5, 'sine', 0.3, 0.08, time);
                }

                // --- HIGH-SPEED DISCO DISCO-ROCK RHYTHM ---
                if (this.measure < 3) {
                    if (step % 4 === 0) this.playDrumKick(time);
                    if (step === 4 || step === 12) this.playDrumSnare(time);
                    if (step % 4 === 2) this.playDrumHat(time, true); // Hat bark open
                } else { // Rapid offbeat fill
                    if (step % 2 === 0) this.playDrumKick(time);
                    if (step === 4 || step === 10 || step === 12 || step === 14) this.playDrumSnare(time);
                }
            },

            // --- BOSS TRACK 5: PRIMORDIAL KNIGHT (Gothic Symphonic Metal - Inspired by Malzeno - Reverted) ---
            playKnight(step, time) {
                const organChords = [
                    [146.83, 174.61, 220.00, 277.18], // Dm(maj7)
                    [130.81, 164.81, 196.00, 246.94], // Cmaj7
                    [116.54, 146.83, 174.61, 220.00], // Bbmaj7
                    [110.00, 138.61, 164.81, 220.00]  // Amaj (ominous resolution)
                ];
                const chord = organChords[this.measure];

                // Organ stop square / triangle reed modeling
                if (step % 4 === 0) {
                    chord.forEach(note => {
                        this.playOsc(note, 'triangle', 0.6, 0.12, time);
                        this.playOsc(note * 2, 'square', 0.5, 0.04, time); // High reed octave
                    });
                }

                // Aggressive classical organ arpeggio runs on offbeats
                if (step % 2 === 1) {
                    const leadNote = chord[step % chord.length] * 2.0;
                    this.playOsc(leadNote, 'square', 0.1, 0.08, time);
                }

                // --- FRANTIC DOUBLE-KICK METAL DRUM PATTERNS ---
                if (this.measure < 3) {
                    // Steady high-speed double-kick run
                    if (step % 2 === 0) this.playDrumKick(time);
                    if (step === 4 || step === 12) this.playDrumSnare(time);
                    if (step % 4 === 1) this.playDrumHat(time);
                } else { // Blast-Beat Chaos Fill on final measure
                    this.playDrumKick(time);
                    if (step % 2 === 1) {
                        this.playDrumSnare(time, true); // Instant rapid blast roll
                    }
                }
            },

            // --- BOSS TRACK 6: GAISMAGORM (Apocalyptic Doom Metal - DEEPER RUMBLING UPDATE) ---
            playGaismagorm(step, time) {
                // Earth-shaking sub-bass notes (clamped to true sub-bass registers!)
                const bassNotes = [29.14, 29.14, 32.70, 36.71]; // Low Bb0 (29.14Hz), C1 (32.70Hz), D1 (36.71Hz)
                const note = bassNotes[this.measure % bassNotes.length];

                // Deep sub-bass rumbly growl
                if (step % 2 === 0) {
                    this.playOsc(note, 'sine', 0.45, 0.45, time, note * 0.85); // deep sliding sub-bass
                    this.playOsc(note * 1.5, 'triangle', 0.2, 0.15, time); 
                }

                if (step % 4 === 0) {
                    this.playOsc(note * 2, 'sawtooth', 0.25, 0.1, time); 
                }

                if (this.measure < 3) {
                    if (step === 0) this.playDrumKick(time);
                    if (step === 8) {
                        this.playDrumSnare(time);
                        this.playOsc(45, 'sine', 0.5, 0.5, time, 25); // Seismic low bass thud sweep
                    }
                } else { 
                    if (step === 0 || step === 4 || step === 8 || step === 12) {
                        this.playDrumKick(time);
                        this.playOsc(50, 'sine', 0.35, 0.4, time, 30);
                    }
                    if (step >= 8 && step % 2 === 0) {
                        this.playDrumSnare(time, true);
                    }
                }
            }
        };

        function toggleMuteMusic() {
            const isMuted = Synth.toggleMute();
            const btn = document.getElementById("mute-btn");
            if (isMuted) {
                btn.innerText = "unmute music";
                btn.style.color = "#666";
            } else {
                btn.innerText = "mute music";
                btn.style.color = "var(--neon-pink)";
            }
        }

        // --- Safe helper builder for Ball Instantiation ---
        function createBall(x, y, dx, dy, speed, isSpecial = false) {
            return { x, y, dx, dy, speed, r: 9, timeScale: 1, isOvercharged: false, grabbed: false, isSpecial };
        }

        const keys = {};
        window.addEventListener("keydown", e => {
            keys[e.key] = true;
            if (e.key === " ") e.preventDefault();
            // Arrow/WASD movement keys registered during Abyssal Cataclysm
            if (["w","W","a","A","s","S","d","D","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key) && ai.isCataclysmActive) {
                e.preventDefault();
            }
            if (e.key.toLowerCase() === 'p' || e.key === 'Escape') {
                if (gameState === 'playing' || gameState === 'paused') togglePause();
            }
            if (gameState === 'playing' && player.stunTimer <= 0) {
                abilities.forEach((abi, i) => {
                    if (currentLevel > i + 1 && e.key.toLowerCase() === abi.key.toLowerCase()) {
                        const now = Date.now();
                        if (now - abi.lastUsed > abi.cd) triggerAbility(abi, i);
                    }
                });
            }
        });
        window.addEventListener("keyup", e => keys[e.key] = false);

        for (let i = 0; i < 4; i++) {
            const slot = document.getElementById(`slot-${i}`);
            
            const handleSlotActivate = (e) => {
                if (e && e.cancelable) e.preventDefault();
                Synth.init(); // Initialize audio context on player HUD click
                if (gameState === 'playing' && player.stunTimer <= 0) {
                    const abi = abilities[i];
                    if (currentLevel > i + 1) {
                        const now = Date.now();
                        if (now - abi.lastUsed > abi.cd) {
                            triggerAbility(abi, i);
                        }
                    }
                }
            };
            
            slot.addEventListener('click', handleSlotActivate);
            slot.addEventListener('touchstart', handleSlotActivate, { passive: false });
            slot.style.cursor = 'pointer';
        }

        function getCanvasCoords(clientX, clientY, canvas) {
            const rect = canvas.getBoundingClientRect();
            const isPortrait = window.innerHeight > window.innerWidth;
            let x, y;
            if (isPortrait) {
                const percentX = (clientX - rect.left) / rect.width;
                const percentY = (clientY - rect.top) / rect.height;
                y = percentX * 600;
                x = (1 - percentY) * 1200;
            } else {
                x = ((clientX - rect.left) / rect.width) * 1200;
                y = ((clientY - rect.top) / rect.height) * 600;
            }
            return { x, y };
        }

        canvas.addEventListener('touchmove', e => {
            e.preventDefault();
            const touch = e.touches[0];
            const coords = getCanvasCoords(touch.clientX, touch.clientY, canvas);
            
            if (ai.isCataclysmActive) {
                player.x = coords.x;
                player.y = coords.y;
            } else {
                player.targetY = coords.y - player.h / 2;
            }
        }, { passive: false });

        canvas.addEventListener('mousemove', e => {
            if (gameState === 'playing') {
                const coords = getCanvasCoords(e.clientX, e.clientY, canvas);
                
                if (ai.isCataclysmActive) {
                    player.x = coords.x;
                    player.y = coords.y;
                } else {
                    player.targetY = coords.y - player.h / 2;
                }
            }
        });

        function triggerAbility(abi, index) {
            abi.active = true;
            abi.lastUsed = Date.now();
            const slot = document.getElementById(`slot-${index}`);
            slot.classList.add('active-glow');
            setTimeout(() => { abi.active = false; slot.classList.remove('active-glow'); }, abi.duration);
        }

        function createShatterParticles(x, y, color) {
            for(let i=0; i<12; i++) {
                gameParticles.push({
                    x: x,
                    y: y,
                    vx: (Math.random() - 0.5) * 8,
                    vy: (Math.random() - 0.5) * 8,
                    r: Math.random() * 4 + 2,
                    alpha: 1.0,
                    decay: Math.random() * 0.03 + 0.015,
                    color: color
                });
            }
        }

        function setStartingLevel(lvl, el) {
            Synth.init(); // Initialize audio context on lobby level chips click
            startingLevelChoice = parseInt(lvl);
            document.querySelectorAll('.level-chip').forEach(c => c.classList.remove('active'));
            el.classList.add('active');
            updateUI();
        }

        function syncLevelSelector(val) {
            startingLevelChoice = parseInt(val);
            document.querySelectorAll('.level-chip').forEach((c, i) => {
                c.classList.remove('active');
                if (i + 1 == val) c.classList.add('active');
            });
            updateUI();
        }

        function togglePause() {
            if (gameState === 'playing') {
                gameState = 'paused';
                document.getElementById('pause-screen').classList.remove('hidden');
            } else if (gameState === 'paused') {
                gameState = 'playing';
                document.getElementById('pause-screen').classList.add('hidden');
                document.getElementById('settings-screen').classList.add('hidden');
                triggerUpdate();
            }
        }

        function showSettings() {
            document.getElementById('pts-input').value = pointsToLevelUp;
            document.getElementById('diff-range').value = aiDifficultyMultiplier;
            document.getElementById('diff-val').innerText = aiDifficultyMultiplier;
            document.getElementById('size-range').value = bossSizeMultiplier;
            document.getElementById('size-val').innerText = bossSizeMultiplier;
            document.getElementById('ball-speed-input').value = customBaseBallSpeed;
            document.getElementById('dash-range').value = customDashMultiplier;
            document.getElementById('dash-val').innerText = customDashMultiplier + "x";
            document.getElementById('win-score-preview').innerText = pointsToLevelUp * 5;
            document.getElementById('setting-start-level').value = startingLevelChoice;
            
            document.getElementById('settings-screen').classList.remove('hidden');
            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('pause-screen').classList.add('hidden');
        }

        function saveSettings() {
            pointsToLevelUp = parseInt(document.getElementById('pts-input').value) || 5;
            pointsToWin = pointsToLevelUp * 5;
            aiDifficultyMultiplier = parseFloat(document.getElementById('diff-range').value);
            bossSizeMultiplier = parseFloat(document.getElementById('size-range').value);
            customBaseBallSpeed = parseFloat(document.getElementById('ball-speed-input').value) || 12;
            customDashMultiplier = parseFloat(document.getElementById('dash-range').value) || 1.75;
            startingLevelChoice = parseInt(document.getElementById('setting-start-level').value);
            
            updateActiveLevels();

            // Dynamically adjust any currently active ball speed immediately so there is no latency
            if (gameState === 'playing' || gameState === 'paused') {
                const lvlIndex = Math.min(currentLevel - 1, activeLevels.length - 1);
                const lvl = activeLevels[lvlIndex] || activeLevels[0] || { ball: 12 };
                const newBaseSpeed = lvl.ball || 12;
                balls.forEach(b => {
                    if (!b.isSpecial) {
                        const currentAngle = Math.atan2(b.dy, b.dx);
                        b.speed = newBaseSpeed;
                        b.dx = b.speed * Math.cos(currentAngle);
                        b.dy = b.speed * Math.sin(currentAngle);
                    }
                });
            }

            document.getElementById('settings-screen').classList.add('hidden');
            if (gameState === 'start') document.getElementById('start-screen').classList.remove('hidden');
            else if (gameState === 'paused') { document.getElementById('pause-screen').classList.remove('hidden'); applyLevelTheme(); }
        }

        function updateUI() {
            const checkLevel = gameState === 'playing' ? currentLevel : startingLevelChoice;
            const now = Date.now();
            abilities.forEach((abi, i) => {
                const elapsed = now - abi.lastUsed;
                const progress = Math.max(0, 1 - (elapsed / abi.cd));
                document.getElementById(`fill-${i}`).style.height = (progress * 100) + "%";
                
                const slot = document.getElementById(`slot-${i}`);
                const cdText = document.getElementById(`cd-text-${i}`);
                
                if (checkLevel > i + 1) {
                    slot.classList.add('unlocked');
                    if (progress > 0) {
                        const remaining = ((abi.cd - elapsed) / 1000).toFixed(1);
                        cdText.innerText = `${remaining}s`;
                        cdText.style.display = 'flex';
                    } else {
                        cdText.style.display = 'none';
                    }
                } else {
                    slot.classList.remove('unlocked');
                    cdText.style.display = 'none';
                }
            });
            
            // Format fractional scoreboard floats safely
            document.getElementById('p-score').innerText = (player.score % 1 === 0) ? player.score : player.score.toFixed(1);
            document.getElementById('a-score').innerText = (ai.score % 1 === 0) ? ai.score : ai.score.toFixed(1);
            
            if (currentLevel >= 5 && (gameState === 'playing' || gameState === 'paused')) {
                chargeBar.style.display = "block";
                chargeFill.style.width = ai.charge + "%";
            } else { chargeBar.style.display = "none"; }
        }

        function resetBall(winner) {
            const lvlIndex = Math.min(currentLevel - 1, activeLevels.length - 1);
            const lvl = activeLevels[lvlIndex] || activeLevels[0] || { ball: 12 };
            const ballSpeed = lvl.ball || 12;
            
            balls = []; bossProjectiles = []; gameParticles = []; cataclysmHazards = [];
            countdownFrames = 180; // 3 seconds at 60 FPS
            goFrames = 0;

            const angle = (Math.random() * Math.PI / 3) - Math.PI / 6;
            // The ball starts on the server's side and travels toward the opponent
            const dx = (winner === 'player' ? 1 : -1) * ballSpeed * Math.cos(angle);
            const dy = ballSpeed * Math.sin(angle);
            
            // If dx < 0 (AI serves), start ball on AI's side (1100)
            // If dx > 0 (player serves), start ball on player's side (100)
            const startX = dx < 0 ? 1100 : 100;
            const startY = dx < 0 ? ai.y + ai.h/2 : player.y + player.h/2;
            balls.push(createBall(startX, startY, dx, dy, ballSpeed));
            
            ai.blinkCD = 60; 
            ai.h = ai.baseH || 100; 
            ai.launchQueue = []; 
            ai.shootTimer = 0; 
            ai.isTargeting = false; 
            player.stunTimer = 0; 
            ai.isGrabbing = false; 
            ai.isSwiping = false; 
            ai.skyLaserMarkers = [];
            ai.grabAttempted = false; // Reset grab logic tracking
            ai.isCataclysmActive = false;
        }

        function triggerLevelUp() {
            if (currentLevel >= 6) return; 
            currentLevel++;
            const lvlIndex = Math.min(currentLevel - 1, activeLevels.length - 1);
            const lvl = activeLevels[lvlIndex];
            document.getElementById('level-display').innerText = lvl.name;
            const prevLvlIndex = currentLevel - 2;
            if (activeLevels[prevLvlIndex]) {
                const unlockMsg = activeLevels[prevLvlIndex].unlock;
                document.getElementById('banner-subtitle').innerText = `POWER STOLEN: ${unlockMsg}`;
            }
            document.getElementById('banner').classList.add('show-banner');
            setTimeout(() => {
                document.getElementById('banner').classList.remove('show-banner');
            }, 3000);
            applyLevelTheme();
        }

        function applyLevelTheme() {
            const lvlIndex = Math.min(currentLevel - 1, activeLevels.length - 1);
            const lvl = activeLevels[lvlIndex] || activeLevels[0] || { h: 100, aiSpeed: 0.05, color: "#ff00de" };
            ai.baseH = lvl.h || 100;
            ai.h = lvl.h || 100;
            ai.aiSpeed = lvl.aiSpeed || 0.05;
            ai.color = lvl.color || "#ff00de";
            container.style.boxShadow = `0 0 35px ${ai.color}44`;
            if (currentLevel === 6) { container.style.borderColor = "var(--abyssal-purple)"; ai.armX = 1100; ai.armY = 250; }
            else { container.style.borderColor = "rgba(255, 255, 255, 0.1)"; }
            document.getElementById('level-display').innerText = lvl.name;
        }

        function triggerUpdate() {
            if (animationId) {
                cancelAnimationFrame(animationId);
            }
            animationId = requestAnimationFrame(update);
        }

        function update() {
            // Secret transition state loop bypass
            if (gameState === 'secret_transition') {
                secretTransitionTimer++;
                if (secretTransitionTimer > 180) { 
                    gameState = 'playing'; 
                    triggerLevelUp(); 
                    player.score = 0; 
                    ai.score = 0;     
                    resetBall('ai'); 
                }
                draw(); updateUI(); animationId = requestAnimationFrame(update); return;
            }
            if (gameState !== 'playing') return;
            if (player.stunTimer > 0) player.stunTimer--;

            // Update countdown timers
            if (countdownFrames > 0) {
                countdownFrames--;
                if (countdownFrames === 0) {
                    goFrames = 30; // 0.5s flash
                }
            }
            if (goFrames > 0) {
                goFrames--;
            }

            // Save paddle history positions for Level 2 (Phantom) Ghost Trail
            if (currentLevel === 2) {
                paddleHistory.player.push(player.y);
                paddleHistory.ai.push(ai.y);
                if (paddleHistory.player.length > 5) paddleHistory.player.shift();
                if (paddleHistory.ai.length > 5) paddleHistory.ai.shift();
            } else {
                paddleHistory.player = [];
                paddleHistory.ai = [];
            }

            // Generate ambient thematic particles for backgrounds
            if (countdownFrames <= 0 && Math.random() < 0.2 && !ai.isCataclysmActive) {
                if (currentLevel === 1) { // Recruit: pink neon stars
                    themeParticles.push({
                        x: Math.random() * 1200, y: 610,
                        vx: (Math.random() - 0.5) * 1.5, vy: -Math.random() * 2 - 1,
                        size: Math.random() * 3 + 1, color: "rgba(255, 0, 222, 0.4)",
                        decay: 0.005, alpha: 0.6
                    });
                } else if (currentLevel === 2) { // Phantom: green digital code rain
                    themeParticles.push({
                        x: Math.random() * 1200, y: -10,
                        vx: 0, vy: Math.random() * 3 + 1,
                        size: Math.random() * 2.5 + 1, color: "rgba(0, 255, 153, 0.5)",
                        decay: 0.006, alpha: 0.8
                    });
                } else if (currentLevel === 3) { // Titan: orange ash sparks
                    themeParticles.push({
                        x: Math.random() * 1200, y: 610,
                        vx: -Math.random() * 2 - 1, vy: -Math.random() * 2 - 1,
                        size: Math.random() * 4 + 2, color: "rgba(255, 51, 0, 0.4)",
                        decay: 0.007, alpha: 0.7
                    });
                } else if (currentLevel === 4) { // Pulsar: yellow stellar space dust
                    themeParticles.push({
                        x: 1210, y: Math.random() * 600,
                        vx: -Math.random() * 5 - 2, vy: 0,
                        size: Math.random() * 3 + 1, color: "rgba(255, 240, 31, 0.4)",
                        decay: 0.003, alpha: 0.6
                    });
                } else if (currentLevel === 5) { // Primordial Knight: warning fire red sparks
                    themeParticles.push({
                        x: Math.random() * 1200, y: 610,
                        vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 4 - 2,
                        size: Math.random() * 4 + 2, color: "rgba(255, 46, 46, 0.4)",
                        decay: 0.008, alpha: 0.8
                    });
                } else if (currentLevel === 6) { // Gaismagorm: purple abyssal voids
                    themeParticles.push({
                        x: 600 + (Math.random() - 0.5) * 120, y: 300 + (Math.random() - 0.5) * 120,
                        vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5,
                        size: Math.random() * 5 + 2, color: "rgba(106, 0, 255, 0.45)",
                        decay: 0.009, alpha: 0.85
                    });
                }
            }

            // Update theme particles
            for (let i = themeParticles.length - 1; i >= 0; i--) {
                let p = themeParticles[i];
                p.x += p.vx;
                p.y += p.vy;
                p.alpha -= p.decay;
                if (p.alpha <= 0 || p.x < -20 || p.x > 1220 || p.y < -20 || p.y > 620) {
                    themeParticles.splice(i, 1);
                }
            }

            // Handle player size states: Minimized during Gaismagorm's Abyssal Cataclysm
            if (ai.isCataclysmActive) {
                player.w = 20;
                player.h = 20;
            } else {
                player.w = 15;
                player.h = abilities[2].active ? 150 : player.baseH; // Titan Shield (now abilities[2])
            }

            let laserTimeScale = (currentLevel === 5 && (ai.isTargeting || bossProjectiles.length > 0)) ? 0.4 : 1.0;
            const globalTimeScale = (abilities[3].active ? 0.35 : 1.0) * laserTimeScale;
            
            let moveMult = (abilities[0].active ? customDashMultiplier * 2.0 : 1) * (player.stunTimer > 0 ? 0.2 : 1);
            let interpFactor = abilities[0].active ? 0.6 : 0.18;
            
            // Phantom Blink buffed to tele-deflect
            if (abilities[1].active && balls.length > 0 && !ai.isCataclysmActive) { 
                const targetBall = balls.reduce((prev, curr) => (curr.x < prev.x ? curr : prev), balls[0]);
                player.targetY = targetBall.y - player.h / 2;
                player.y = player.targetY; // Instant Teleportation!
                
                // If ball is traveling toward the player, deflect it instantly!
                if (targetBall.dx < 0 && targetBall.x < 600 && !targetBall.grabbed) {
                    targetBall.speed *= 1.25; // 25% speed buff
                    let impact = (targetBall.y - (player.y + player.h / 2)) / (player.h / 2);
                    impact = Math.max(-0.9, Math.min(0.9, impact));
                    let angle = (impact || 0) * (Math.PI / 4);
                    targetBall.dx = targetBall.speed * Math.cos(angle);
                    targetBall.dy = targetBall.speed * Math.sin(angle);
                    
                    createShatterParticles(targetBall.x, targetBall.y, player.color);
                    Synth.playHitSound(true, targetBall.speed);
                    
                    // Consume the blink and end active state
                    abilities[1].active = false;
                    document.getElementById('slot-1').classList.remove('active-glow');
                }
            }

            // Paddle dodge movement logic
            if (ai.isCataclysmActive) {
                // Unlimited 2D free dodging movement inside the arena bounds
                let dodgeSpeed = 10;
                if (keys["ArrowUp"] || keys["w"] || keys["W"]) player.y -= dodgeSpeed;
                if (keys["ArrowDown"] || keys["s"] || keys["S"]) player.y += dodgeSpeed;
                if (keys["ArrowLeft"] || keys["a"] || keys["A"]) player.x -= dodgeSpeed;
                if (keys["ArrowRight"] || keys["d"] || keys["D"]) player.x += dodgeSpeed;
                
                player.x = Math.max(20, Math.min(1180, player.x));
                player.y = Math.max(20, Math.min(580, player.y));
                player.targetY = player.y; // keep in sync
            } else {
                player.x = 40; // Lock to left side under standard play
                if (player.stunTimer <= 0) {
                    if (keys["ArrowUp"]) player.targetY -= PLAYER_PADDLE_SPEED * moveMult;
                    if (keys["ArrowDown"]) player.targetY += PLAYER_PADDLE_SPEED * moveMult;
                }
                player.targetY = Math.max(-player.h/4, Math.min(600 - (player.h * 0.75), player.targetY));
                player.y += (player.targetY - player.y) * interpFactor;
                player.y = Math.max(0, Math.min(600 - player.h, player.y));
            }

            if (balls.length > 0) {
                const targetBall = balls.reduce((prev, curr) => (curr.dx > 0 && curr.x > prev.x ? curr : prev), balls[0]);
                
                // Titan Shield logic (Swapped to Level 3 or Level 5)
                if (currentLevel === 3 || currentLevel === 5) {
                    if (targetBall.dx > 0 && targetBall.x > 600) ai.h = Math.min(ai.baseH * 1.4, ai.h + 5);
                    else ai.h = Math.max(ai.baseH, ai.h - 5);
                } else if (currentLevel < 6) { ai.h = ai.baseH; }

                // Phantom Blink logic (Swapped to Level 2 or Level 5)
                if ((currentLevel === 2 || currentLevel === 5) && targetBall.dx > 0 && targetBall.x > 860 && ai.blinkCD <= 0) {
                    ai.y = targetBall.y - ai.h / 2;
                    ai.blinkCD = currentLevel === 5 ? 130 : 180;
                    ai.isBlinking = 15;
                }

                // Lock boss actions during serve countdown
                if (countdownFrames <= 0) {
                    // Start Abyssal Cataclysm when Gaismagorm's charge meter reaches 100%
                    if (currentLevel === 6 && ai.charge >= 100 && !ai.isCataclysmActive) {
                        ai.isCataclysmActive = true;
                        ai.cataclysmTimer = 400; // ~6.6 seconds of dodging challenge
                        cataclysmHazards = [];
                        
                        // Freeze all game ball movements
                        balls.forEach(b => {
                            b.savedDx = b.savedDx;
                            b.savedDy = b.savedDy;
                            b.dx = 0;
                            b.dy = 0;
                        });
                        
                        // Deep abyssal activation sound
                        if (Synth.ctx) {
                            Synth.playOsc(80, 'sine', 1.0, 0.5, Synth.ctx.currentTime, 30);
                            Synth.playOsc(120, 'sawtooth', 0.8, 0.25, Synth.ctx.currentTime, 40);
                        }
                    }

                    // --- ABYSSAL CATACLYSM ACTIVE LOGIC ---
                    if (ai.isCataclysmActive) {
                        ai.cataclysmTimer--;
                        
                        // Spawning warning hazards over cycles
                        if (ai.cataclysmTimer % 35 === 0 && ai.cataclysmTimer > 60) {
                            cataclysmHazards.push({
                                type: 'explosion',
                                x: Math.random() * 1000 + 100,
                                y: Math.random() * 500 + 50,
                                maxR: 90,
                                r: 5,
                                warningTimer: 45,
                                activeTimer: 15,
                                active: false,
                                damageDealt: false
                            });
                        }
                        if (ai.cataclysmTimer % 50 === 0 && ai.cataclysmTimer > 60) {
                            let isVertical = Math.random() < 0.5;
                            cataclysmHazards.push({
                                type: 'laser',
                                isVertical: isVertical,
                                coord: isVertical ? (Math.random() * 1000 + 100) : (Math.random() * 500 + 50),
                                thickness: 30,
                                warningTimer: 45,
                                activeTimer: 15,
                                active: false,
                                damageDealt: false
                            });
                        }

                        // Update Active Cataclysm Hazards
                        for (let k = cataclysmHazards.length - 1; k >= 0; k--) {
                            let h = cataclysmHazards[k];
                            if (h.warningTimer > 0) {
                                h.warningTimer--;
                                if (h.warningTimer === 0) {
                                    h.active = true;
                                    // Heavy impact noise
                                    if (Synth.ctx) {
                                        Synth.playOsc(h.type === 'laser' ? 440 : 130, h.type === 'laser' ? 'sawtooth' : 'triangle', 0.18, 0.15, Synth.ctx.currentTime);
                                    }
                                }
                            } else if (h.activeTimer > 0) {
                                h.activeTimer--;
                                if (h.type === 'explosion') h.r = h.maxR;
                                
                                // Precise 2D hitbox collision checks
                                if (!h.damageDealt) {
                                    let hit = false;
                                    if (h.type === 'explosion') {
                                        let dist = Math.hypot(player.x - h.x, player.y - h.y);
                                        if (dist < h.r + 10) hit = true;
                                    } else if (h.type === 'laser') {
                                        if (h.isVertical) {
                                            if (Math.abs(player.x - h.coord) < h.thickness / 2 + 10) hit = true;
                                        } else {
                                            if (Math.abs(player.y - h.coord) < h.thickness / 2 + 10) hit = true;
                                        }
                                    }
                                    
                                    if (hit) {
                                        ai.score += 0.5; // Penalty: Boss scores 0.5 points
                                        h.damageDealt = true;
                                        createShatterParticles(player.x, player.y, "red");
                                        if (Synth.ctx) {
                                            Synth.playOsc(110, 'sawtooth', 0.25, 0.3, Synth.ctx.currentTime, 50); // pain feedback sound
                                        }
                                    }
                                }
                                if (h.activeTimer === 0) {
                                    cataclysmHazards.splice(k, 1);
                                }
                            }
                        }

                        // Terminate Cataclysm, restore coordinate space
                        if (ai.cataclysmTimer <= 0) {
                            ai.isCataclysmActive = false;
                            ai.charge = 0;
                            // Restore Player Paddle Dimensions
                            player.w = 15;
                            player.h = 100;
                            player.x = 40;
                            // Restore ball vectors
                            balls.forEach(b => {
                                b.dx = b.savedDx || b.speed;
                                b.dy = b.savedDy || 0;
                            });
                            cataclysmHazards = [];
                        }

                    } else if (currentLevel === 6) { // STANDARD PLAY GAISMAGORM ACTIONS
                        ai.charge += 0.08;
                        ai.skyLaserTimer++;
                        if (ai.skyLaserTimer > 350) {
                            ai.skyLaserMarkers = [Math.random() * 300 + 50, Math.random() * 300 + 350];
                            ai.skyLaserTimer = 0;
                            setTimeout(() => {
                                ai.skyLaserMarkers.forEach(mx => { bossProjectiles.push({ x: mx, y: 0, dx: 0, dy: 15, r: 10, isSkyBeam: true }); });
                                ai.skyLaserMarkers = [];
                            }, 1200);
                        }
                        if (!ai.isSwiping && !ai.isGrabbing && Math.random() < 0.01 && targetBall.x > 700) {
                            ai.isSwiping = true; ai.swipeTimer = 40; ai.swipeDir = targetBall.y > ai.y + ai.h/2 ? 1 : -1;
                        }
                        if (ai.isSwiping) {
                            ai.swipeTimer--; ai.y += ai.swipeDir * 15;
                            if (targetBall.x > ai.x - 50 && Math.abs(targetBall.y - (ai.y + ai.h/2)) < 100) { 
                                targetBall.dx = -targetBall.speed * 2; 
                                targetBall.dy += ai.swipeDir * 5; 
                                createShatterParticles(targetBall.x, targetBall.y, "var(--abyssal-purple)");
                            }
                            if (ai.swipeTimer <= 0) ai.isSwiping = false;
                        }
                        if (!ai.isGrabbing) {
                            // Don't let Gaismagorm's hand pass half of the arena (X = 600 limit)
                            let targetArmX = targetBall.x + 80;
                            if (targetArmX < 600) targetArmX = 600;
                            
                            ai.armX += ( targetArmX - ai.armX ) * 0.08;
                            ai.armY += ( (targetBall.y - ai.armH/2) - ai.armY ) * 0.08;
                            
                            ai.armX = Math.max(600, ai.armX); // Clamp physical position too
                            
                            // Nerf: Grab attempt trigger chance restricted to 45% when within range
                            if (!ai.grabAttempted && targetBall.dx > 0 && targetBall.x > ai.armX && targetBall.x < ai.armX + ai.armW && targetBall.y > ai.armY && targetBall.y < ai.armY + ai.armH) {
                                ai.grabAttempted = true;
                                if (Math.random() < 0.45) { // 45% Grab Chance
                                    ai.isGrabbing = true; ai.grabTimer = 85; targetBall.grabbed = true;
                                } else { // Otherwise deflect normal style
                                    targetBall.dx *= -1;
                                    createShatterParticles(targetBall.x, targetBall.y, ai.color);
                                    Synth.playHitSound(false, targetBall.speed);
                                }
                            }
                        } else {
                            ai.grabTimer--;
                            ai.armX += ( (1200 - 250) - ai.armX ) * 0.06;
                            ai.armY += ( (300 - ai.armH/2) - ai.armY ) * 0.06;
                            ai.armX = Math.max(600, ai.armX); // Respect clamp
                            
                            balls.forEach(b => { if(b.grabbed) { b.x = ai.armX + 40; b.y = ai.armY + ai.armH/2; }});
                            if (ai.grabTimer <= 0) {
                                ai.isGrabbing = false;
                                balls.forEach(b => { 
                                    if(b.grabbed) { 
                                        b.grabbed = false; 
                                        // Nerf: Ball throw velocity slower multiplier (from 2.5x to 1.3x)
                                        b.dx = -b.speed * 1.3; 
                                        b.dy = (Math.random() - 0.5) * 10; 
                                        createShatterParticles(b.x, b.y, "white");
                                    }
                                });
                            }
                        }
                    } else if (currentLevel === 5) {
                        if (!ai.isCharging) {
                            ai.charge += 0.08; if (ai.charge >= 100) { ai.isCharging = true; ai.chargeTime = 80; ai.charge = 100; }
                        } else if (ai.chargeTime > 0) ai.chargeTime--;
                        else if (ai.launchQueue.length === 0) {
                            const lvl = activeLevels[4];
                            ai.launchQueue = [{dx:-lvl.ball, dy:-2.5, delay:0}, {dx:-lvl.ball, dy:0, delay:70}, {dx:-lvl.ball, dy:2.5, delay:140}];
                            ai.charge = 0; ai.isCharging = false;
                        }

                        ai.shootTimer++;
                        if (ai.shootTimer > 300 && !ai.isCharging && !ai.isTargeting) { ai.isTargeting = true; ai.targetingPhase = 100; ai.targetY = player.y + player.h / 2; } 
                        if (ai.isTargeting) {
                            ai.targetingPhase--; ai.targetY += ( (player.y + player.h/2) - ai.targetY ) * 0.08;
                            if (ai.targetingPhase <= 0) {
                                bossProjectiles.push({ x: ai.x, y: ai.targetY, dx: -30, r: 4, isBeam: true });
                                ai.isTargeting = false; ai.shootTimer = 0;
                                if (Math.random() < 0.3) { ai.isTargeting = true; ai.targetingPhase = 60; }
                            }
                        }
                    }

                    if (ai.launchQueue.length > 0 && !ai.isCataclysmActive) {
                        ai.launchQueue.forEach(item => item.delay--);
                        if (ai.launchQueue[0].delay <= 0) {
                            const item = ai.launchQueue.shift();
                            balls.push(createBall(ai.x - 20, ai.y + ai.h/2, item.dx, item.dy, activeLevels[Math.min(currentLevel-1, 4)].ball, true));
                        }
                    }
                }
                
                // Track slowly and barely move during Gaismagorm battle (unless cataclysm)
                let aiTarget = targetBall.y - ai.h / 2;
                ai.y += (aiTarget - ai.y) * ai.aiSpeed;
            }

            if (ai.blinkCD > 0) ai.blinkCD--;
            if (ai.isBlinking > 0) ai.isBlinking--;
            ai.y = Math.max(0, Math.min(600 - ai.h, ai.y));

            // Projectiles
            for (let i = bossProjectiles.length - 1; i >= 0; i--) {
                const p = bossProjectiles[i];
                if (p.isSkyBeam) {
                    p.y += 15;
                    if (p.y > 600) bossProjectiles.splice(i, 1);
                    else if (Math.abs(p.x - (player.x + player.w/2)) < 30 && Math.abs(p.y - (player.y + player.h/2)) < 60) {
                        player.stunTimer = 60; 
                        createShatterParticles(player.x + player.w/2, player.y + player.h/2, "red");
                        bossProjectiles.splice(i, 1);
                    }
                } else {
                    p.x += p.dx * globalTimeScale;
                    
                    // Laser hits player
                    if (p.x < player.x + player.w && p.x > player.x && p.y > player.y && p.y < player.y + player.h) {
                        player.stunTimer = 45; 
                        createShatterParticles(p.x, p.y, "red");
                        bossProjectiles.splice(i, 1);
                    } 
                    // Laser hits ball -> INSTA DEFLECT!
                    else {
                        let hitBall = false;
                        for (let j = 0; j < balls.length; j++) {
                            const b = balls[j];
                            if (!b.grabbed && Math.abs(p.x - b.x) < 40 && Math.abs(p.y - b.y) < 25) {
                                b.dx = -Math.abs(b.dx) * 1.5; // instant bullet-speed deflection!
                                b.dy = (Math.random() - 0.5) * 12;
                                b.isOvercharged = true; 
                                createShatterParticles(b.x, b.y, "red");
                                Synth.playHitSound(false, b.speed * 1.5);
                                bossProjectiles.splice(i, 1);
                                hitBall = true;
                                break;
                            }
                        }
                        if (!hitBall && p.x < -100) bossProjectiles.splice(i, 1);
                    }
                }
            }

            // Particle Updates
            for (let i = gameParticles.length - 1; i >= 0; i--) {
                const p = gameParticles[i];
                p.x += p.vx;
                p.y += p.vy;
                p.alpha -= p.decay;
                if (p.alpha <= 0) gameParticles.splice(i, 1);
            }

            // SINGLE MULTI-BALL UPDATE LOOP
            for (let i = balls.length - 1; i >= 0; i--) {
                const b = balls[i];
                if (b.grabbed) continue;
                
                // Serves organic start positions: Freeze ball at paddle position during countdown
                if (countdownFrames > 0 && !b.isSpecial) {
                    b.x = b.dx < 0 ? 1100 : 100;
                    b.y = b.dx < 0 ? ai.y + ai.h/2 : player.y + player.h/2;
                    continue;
                }
                if (ai.isCataclysmActive && !b.isSpecial) {
                    continue; // Lock ball physics loop
                }

                b.x += b.dx * globalTimeScale; 
                b.y += b.dy * globalTimeScale;

                if (b.y - b.r < 0) { b.y = b.r; b.dy *= -1; }
                else if (b.y + b.r > 600) { b.y = 600 - b.r; b.dy *= -1; }

                const paddle = b.dx < 0 ? player : ai;
                if (b.x + b.r > paddle.x && b.x - b.r < paddle.x + paddle.w && b.y + b.r > paddle.y && b.y - b.r < paddle.y + paddle.h) {
                    if (paddle === player && b.isSpecial) {
                        createShatterParticles(b.x, b.y, "var(--neon-pink)");
                        balls.splice(i, 1);
                        if (balls.length === 0) resetBall('player');
                        continue;
                    }
                    if (b.dx < 0) b.x = paddle.x + paddle.w + b.r; else b.x = paddle.x - b.r;
                    
                    const paddleH = paddle.h || 100;
                    const halfH = paddleH / 2;
                    let impact = (b.y - (paddle.y + halfH)) / halfH;
                    impact = Math.max(-0.9, Math.min(0.9, impact));
                    let angle = (impact || 0) * (Math.PI / 4);
                    const rallyMult = 1.045;
                    
                    if (paddle === ai && currentLevel === 4) { b.speed *= 1.45; b.isOvercharged = true; }
                    else if (paddle === player) {
                        const currentLvlIndex = Math.min(currentLevel - 1, activeLevels.length - 1);
                        const refLvl = activeLevels[currentLvlIndex] || { ball: 12 };
                        if (b.isOvercharged) { b.speed = (refLvl.ball || 12) * 1.1; b.isOvercharged = false; }
                        else b.speed *= rallyMult;
                    } else b.speed *= rallyMult;
                    b.dx = (b.dx < 0 ? 1 : -1) * b.speed * Math.cos(angle); b.dy = b.speed * Math.sin(angle);
                    createShatterParticles(b.x, b.y, paddle.color || "#ffffff");
                    
                    // Reset grab attempt tracking when the ball bounces back off player paddle
                    if (paddle === player) ai.grabAttempted = false;

                    // Trigger dynamic synthesized hit sound!
                    Synth.playHitSound(paddle === player, b.speed);
                }
                
                // Scoring
                if (b.x < 0) { 
                    if (!b.isSpecial) {
                        ai.score++;
                        resetBall('ai');
                        break;
                    } else {
                        balls.splice(i, 1);
                    }
                } else if (b.x > 1200) { 
                    if (!b.isSpecial) {
                        player.score++; 
                        if (player.score % pointsToLevelUp === 0 && currentLevel < 5) triggerLevelUp();
                        resetBall('player');
                        break;
                    } else {
                        balls.splice(i, 1);
                    }
                }
            }

            if (player.score >= pointsToWin || ai.score >= pointsToWin) {
                if (player.score >= ai.score * 2 && currentLevel === 5) { 
                    gameState = 'secret_transition'; 
                    secretTransitionTimer = 0; 
                    generateCracks(); 
                } else endGame();
            }

            draw(); updateUI();
            animationId = requestAnimationFrame(update);
        }

        function generateCracks() {
            screenCracks = [];
            for(let i=0; i<15; i++) { screenCracks.push({ x: 600 + (Math.random()-0.5)*200, y: 300 + (Math.random()-0.5)*100, angle: Math.random()*Math.PI*2, len: 50 + Math.random()*150 }); }
        }

        function drawAbyssalHand(x, y, scale, state = "open") {
            ctx.save(); ctx.translate(x, y); ctx.shadowBlur = 30 * scale; ctx.shadowColor = "var(--abyssal-purple)"; ctx.fillStyle = "#1a0033"; ctx.strokeStyle = "rgba(106, 0, 255, 0.5)"; ctx.lineWidth = 3;
            const fAngle = state === "closed" ? 0.2 : 0.5;
            ctx.beginPath(); ctx.arc(10 * scale, 0, 15 * scale, 0, Math.PI * 2); 
            ctx.fillStyle = (state === "closed") ? "#f00" : "#4a0077"; ctx.fill();
            for(let i=0; i<4; i++) {
                ctx.save(); ctx.rotate((i - 1.5) * fAngle);
                ctx.beginPath(); ctx.moveTo(20 * scale, 0); ctx.quadraticCurveTo(60 * scale, -40 * scale, 120 * scale, 0); ctx.lineTo(110 * scale, 10 * scale); ctx.quadraticCurveTo(60 * scale, -20 * scale, 20 * scale, 20 * scale);
                ctx.fillStyle = "#1a0033"; ctx.fill(); ctx.stroke();
                ctx.fillStyle = "#6a00ff"; ctx.beginPath(); ctx.arc(60 * scale, -10 * scale, 3 * scale, 0, Math.PI*2); ctx.fill();
                ctx.restore();
            }
            ctx.restore();
        }

        function draw() {
            ctx.fillStyle = "#0a0a12"; ctx.fillRect(0, 0, 1200, 600);
            
            // Custom Background Aesthetics per Boss
            ctx.save();
            if (currentLevel === 1) { // Background Pulse
                ctx.fillStyle = "rgba(255, 0, 222, 0.015)";
                ctx.fillRect(0, 0, 1200, 600);
            } else if (currentLevel === 2) { // Phantom digital backdrop
                ctx.fillStyle = "rgba(0, 255, 153, 0.01)";
                ctx.fillRect(0, 0, 1200, 600);
            } else if (currentLevel === 3) { // Titan heavy industrial warning frame
                ctx.fillStyle = "rgba(255, 51, 0, 0.015)";
                ctx.fillRect(0, 0, 1200, 600);
                
                // Draw blocky warning frames
                ctx.strokeStyle = "rgba(255, 51, 0, 0.12)";
                ctx.lineWidth = 14;
                ctx.strokeRect(0, 0, 1200, 600);
            } else if (currentLevel === 4) { // Pulsar solar expanding rings
                ctx.fillStyle = "rgba(255, 240, 31, 0.01)";
                ctx.fillRect(0, 0, 1200, 600);
                
                pulseRadius += 2.5;
                if (pulseRadius > 500) pulseRadius = 0;
                ctx.strokeStyle = `rgba(255, 240, 31, ${Math.max(0, (500 - pulseRadius) / 500 * 0.12)})`;
                ctx.lineWidth = 3;
                
                ctx.beginPath();
                ctx.arc(600, 300, pulseRadius, 0, Math.PI * 2);
                ctx.stroke();
                
                ctx.beginPath();
                ctx.arc(600, 300, (pulseRadius + 250) % 500, 0, Math.PI * 2);
                ctx.stroke();
            } else if (currentLevel === 5) { // Knight crimson hazard lighting
                ctx.fillStyle = "rgba(255, 46, 46, 0.015)";
                ctx.fillRect(0, 0, 1200, 600);
                if (Math.random() < 0.01) { // Lightning blink
                    ctx.fillStyle = "rgba(255, 46, 46, 0.06)";
                    ctx.fillRect(0, 0, 1200, 600);
                }
            } else if (currentLevel === 6) { // Gaismagorm Swirling vortex space
                ctx.fillStyle = "rgba(106, 0, 255, 0.03)";
                ctx.fillRect(0, 0, 1200, 600);
                
                ctx.save();
                ctx.translate(600, 300);
                laserSpiralRot += 0.02; // reuse rot variable
                ctx.rotate(laserSpiralRot * 0.12);
                ctx.strokeStyle = "rgba(106, 0, 255, 0.07)";
                ctx.lineWidth = 4;
                ctx.beginPath();
                for (let j = 0; j < 300; j += 4) {
                    let angle = 0.08 * j;
                    let radius = j * 1.6;
                    let sx = radius * Math.cos(angle);
                    let sy = radius * Math.sin(angle);
                    if (j === 0) ctx.moveTo(sx, sy);
                    else ctx.lineTo(sx, sy);
                }
                ctx.stroke();
                ctx.restore();
            }

            // Draw custom background drift particles
            themeParticles.forEach(p => {
                ctx.save();
                ctx.globalAlpha = p.alpha;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });
            ctx.restore();

            // Default grid layout overlay
            ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
            for(let i=0; i<1200; i+=40) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 600); ctx.stroke(); }
            
            // Draw Sweeping Cataclysm Warning & Detonation Zones
            cataclysmHazards.forEach(h => {
                ctx.save();
                if (h.type === 'explosion') {
                    if (h.warningTimer > 0) {
                        ctx.strokeStyle = "rgba(255, 46, 46, " + (Math.sin(Date.now() / 50) * 0.4 + 0.5) + ")";
                        ctx.lineWidth = 3;
                        ctx.beginPath();
                        ctx.arc(h.x, h.y, h.maxR, 0, Math.PI * 2);
                        ctx.stroke();
                        
                        ctx.fillStyle = "rgba(255, 46, 46, 0.15)";
                        ctx.beginPath();
                        ctx.arc(h.x, h.y, h.maxR * (1 - h.warningTimer / 45), 0, Math.PI * 2);
                        ctx.fill();
                    } else {
                        ctx.shadowBlur = 30; ctx.shadowColor = "red";
                        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
                        ctx.beginPath(); ctx.arc(h.x, h.y, h.maxR, 0, Math.PI * 2); ctx.fill();
                        
                        ctx.fillStyle = "rgba(255, 46, 46, 0.5)";
                        ctx.beginPath(); ctx.arc(h.x, h.y, h.maxR * 1.2, 0, Math.PI * 2); ctx.fill();
                    }
                } else if (h.type === 'laser') {
                    if (h.warningTimer > 0) {
                        ctx.strokeStyle = "rgba(255, 46, 46, " + (Math.sin(Date.now() / 50) * 0.4 + 0.5) + ")";
                        ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
                        ctx.beginPath();
                        if (h.isVertical) {
                            ctx.moveTo(h.coord, 0); ctx.lineTo(h.coord, 600);
                        } else {
                            ctx.moveTo(0, h.coord); ctx.lineTo(1200, h.coord);
                        }
                        ctx.stroke();
                    } else {
                        ctx.shadowBlur = 25; ctx.shadowColor = "red";
                        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
                        ctx.fillRect(h.isVertical ? h.coord - h.thickness/4 : 0, h.isVertical ? 0 : h.coord - h.thickness/4, h.isVertical ? h.thickness/2 : 1200, h.isVertical ? 600 : h.thickness/2);
                        
                        ctx.fillStyle = "rgba(255, 46, 46, 0.4)";
                        ctx.fillRect(h.isVertical ? h.coord - h.thickness/2 : 0, h.isVertical ? 0 : h.coord - h.thickness/2, h.isVertical ? h.thickness : 1200, h.isVertical ? 600 : h.thickness);
                    }
                }
                ctx.restore();
            });

            if (ai.isTargeting) {
                const alpha = (100 - ai.targetingPhase) / 100;
                ctx.save(); ctx.translate(0, ai.targetY); ctx.strokeStyle = `rgba(255, 46, 46, ${alpha * 0.8})`; ctx.lineWidth = 1.5; laserSpiralRot += 0.25;
                for(let side of [1, -1]) { ctx.beginPath(); for(let x=0; x < ai.x; x+=5) { const spiralY = Math.sin(x*0.06 + laserSpiralRot + (side === -1 ? Math.PI : 0)) * 20 * alpha; if(x===0) ctx.moveTo(x, spiralY); else ctx.lineTo(x, spiralY); } ctx.stroke(); }
                ctx.restore();
            }
            if (abilities[3].active) { ctx.fillStyle = "rgba(0, 242, 255, 0.08)"; ctx.fillRect(0, 0, 1200, 600); }
            if (abilities[0].active) { ctx.globalAlpha = 0.35; ctx.fillStyle = player.color; ctx.fillRect(player.x, player.y - 15, player.w, player.h); ctx.fillRect(player.x, player.y + 15, player.w, player.h); ctx.globalAlpha = 1.0; }
            
            // Draw Player Ghost Trail (Level 2: Phantom)
            if (currentLevel === 2 && paddleHistory.player.length > 0) {
                paddleHistory.player.forEach((oldY, idx) => {
                    ctx.save();
                    ctx.globalAlpha = (idx / paddleHistory.player.length) * 0.22;
                    ctx.shadowBlur = 12; ctx.shadowColor = "rgba(0, 255, 153, 0.6)";
                    ctx.fillStyle = "rgba(0, 255, 153, 0.6)";
                    ctx.fillRect(player.x, oldY, player.w, player.h);
                    ctx.restore();
                });
            }

            if (player.stunTimer > 0) { ctx.shadowBlur = 25; ctx.shadowColor = "#ff2e2e"; ctx.fillStyle = (player.stunTimer % 10 < 5) ? "#ff2e2e" : "#880000"; }
            else { ctx.shadowBlur = 20; ctx.shadowColor = player.color; ctx.fillStyle = player.color; }
            ctx.fillRect(player.x, player.y, player.w, player.h);
            ai.skyLaserMarkers.forEach(mx => { ctx.strokeStyle = "rgba(255, 0, 0, 0.3)"; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, 600); ctx.stroke(); ctx.setLineDash([]); });
            
            bossProjectiles.forEach(p => {
                ctx.save(); ctx.shadowBlur = 25; ctx.shadowColor = "red";
                if (p.isSkyBeam) { ctx.fillStyle = "white"; ctx.fillRect(p.x - 4, p.y - 100, 8, 200); ctx.fillStyle = "red"; ctx.globalAlpha = 0.4; ctx.fillRect(p.x - 12, p.y - 120, 24, 240); }
                else { ctx.fillStyle = "white"; ctx.fillRect(p.x, p.y - 2, 100, 4); ctx.fillStyle = "red"; ctx.globalAlpha = 0.4; ctx.fillRect(p.x - 20, p.y - 6, 140, 12); }
                ctx.restore();
            });

            // Particles Rendering
            gameParticles.forEach(p => {
                ctx.save();
                ctx.globalAlpha = p.alpha;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });

            // Draw AI Ghost Trail (Level 2: Phantom)
            if (currentLevel === 2 && paddleHistory.ai.length > 0) {
                paddleHistory.ai.forEach((oldY, idx) => {
                    ctx.save();
                    ctx.globalAlpha = (idx / paddleHistory.ai.length) * 0.22;
                    ctx.shadowBlur = 12; ctx.shadowColor = "rgba(0, 255, 153, 0.6)";
                    ctx.fillStyle = "rgba(0, 255, 153, 0.6)";
                    ctx.fillRect(ai.x, oldY, ai.w, ai.h);
                    ctx.restore();
                });
            }

            if (currentLevel === 6) { drawAbyssalHand(ai.armX, ai.armY, 0.8, ai.isGrabbing ? "closed" : "open"); }
            if (ai.isCharging && currentLevel === 5) {
                const pulse = (Math.sin(Date.now() / 50) + 1) / 2; ctx.shadowColor = "white"; ctx.fillStyle = "white"; ctx.shadowBlur = 30 + (pulse * 20); ctx.strokeStyle = "rgba(255, 255, 255, " + (0.5 - pulse * 0.5) + ")"; ctx.lineWidth = 2;
                for (let j = 1; j <= 3; j++) { const radius = (ai.chargeTime / 80) * 100 * j + (pulse * 10); ctx.beginPath(); ctx.arc(ai.x + ai.w / 2, ai.y + ai.h / 2, radius, 0, Math.PI * 2); ctx.stroke(); }
            } else { ctx.shadowColor = ai.color; ctx.fillStyle = ai.isBlinking > 0 ? "white" : ai.color; ctx.shadowBlur = 20; }
            ctx.fillRect(ai.x, ai.y, ai.w, ai.h);
            balls.forEach(b => { const ballColor = b.isOvercharged ? "#fff01f" : (currentLevel === 6 ? "#6a00ff" : "white"); ctx.shadowColor = ballColor; ctx.fillStyle = ballColor; ctx.shadowBlur = 15; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.fill(); });
            
            if (gameState === 'secret_transition') {
                const p = secretTransitionTimer / 180; ctx.fillStyle = "white"; ctx.font = "bold 60px Segoe UI"; ctx.textAlign = "center"; ctx.fillText("VICTORY", 600, 300);
                drawAbyssalHand(1200 + 100 - (p * 500), 300, p * 2.5, p > 0.4 ? "closed" : "open");
                if (p > 0.4) { ctx.strokeStyle = "rgba(255,255,255," + (p) + ")"; ctx.lineWidth = 2; screenCracks.forEach(c => { ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + Math.cos(c.angle)*c.len*p, c.y + Math.sin(c.angle)*c.len*p); ctx.stroke(); }); }
                if (p > 0.8) { ctx.fillStyle = `rgba(106, 0, 255, ${(p-0.8)*5})`; ctx.fillRect(0,0,1200,600); }
            }

            // Draw countdown UI over everything
            if (countdownFrames > 0) {
                ctx.save();
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.font = "bold 130px 'Segoe UI', system-ui, sans-serif";
                ctx.shadowBlur = 30;
                
                let text = "";
                if (countdownFrames > 120) {
                    text = "3";
                    ctx.shadowColor = "var(--neon-pink)";
                } else if (countdownFrames > 60) {
                    text = "2";
                    ctx.shadowColor = "var(--neon-yellow)";
                } else {
                    text = "1";
                    ctx.shadowColor = "var(--neon-blue)";
                }
                ctx.fillStyle = ctx.shadowColor; // Match text fill with glowing shadow
                
                let sectionFrame = countdownFrames % 60;
                let scale = 1.0 + (60 - sectionFrame) / 60 * 0.4; // Pulse scale up each second
                ctx.translate(600, 300);
                ctx.scale(scale, scale);
                ctx.fillText(text, 0, 0);
                ctx.restore();
            } else if (goFrames > 0) {
                ctx.save();
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.font = "bold 110px 'Segoe UI', system-ui, sans-serif";
                ctx.shadowBlur = 40;
                ctx.shadowColor = "var(--neon-green)";
                ctx.fillStyle = "var(--neon-green)";
                
                let scale = 1.0 + (30 - goFrames) / 30 * 0.3; // Slight explosive scale out
                ctx.translate(600, 300);
                ctx.scale(scale, scale);
                ctx.globalAlpha = goFrames / 30; // Fade out smoothly
                ctx.fillText("FIGHT!", 0, 0);
                ctx.restore();
            }
            
            ctx.shadowBlur = 0; ctx.globalAlpha = 1.0;
        }

        function startGame() {
            if (animationId) {
                cancelAnimationFrame(animationId);
                animationId = null;
            }
            gameState = 'playing'; currentLevel = startingLevelChoice; player.score = 0; ai.score = 0; player.stunTimer = 0; player.targetY = 250; player.y = player.targetY;
            ai.charge = 0; ai.isCharging = false; ai.launchQueue = []; ai.shootTimer = 0; ai.isTargeting = false; bossProjectiles = []; ai.isGrabbing = false; ai.skyLaserTimer = 0;
            ai.isCataclysmActive = false; cataclysmHazards = [];
            paddleHistory = { player: [], ai: [] };
            themeParticles = [];
            pulseRadius = 0;
            document.getElementById('start-screen').classList.add('hidden'); document.getElementById('settings-screen').classList.add('hidden'); document.getElementById('game-over-screen').classList.add('hidden'); document.getElementById('pause-screen').classList.add('hidden');
            abilities.forEach((a, i) => { a.lastUsed = 0; a.active = false; });
            
            Synth.init(); // Initialize audio context on game start gesture
            
            resize(); updateActiveLevels(); applyLevelTheme(); resetBall('ai'); triggerUpdate();
        }

        function endGame() {
            gameState = 'gameover'; document.getElementById('game-over-screen').classList.remove('hidden');
            document.getElementById('win-status').innerText = player.score >= pointsToWin ? "CONQUEROR" : "NICE TRY";
            if (animationId) {
                cancelAnimationFrame(animationId);
                animationId = null;
            }
        }

        function resize() {
            player.targetY = Math.max(-player.h/4, Math.min(600 - (player.h * 0.75), player.targetY));
        }

        window.addEventListener('resize', resize);
        resize(); updateActiveLevels();
