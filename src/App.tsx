/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, Component } from 'react';
import { 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp,
  addDoc
} from 'firebase/firestore';
import { auth, db, login, logout, handleFirestoreError, OperationType } from './firebase';
import { Rocket, Star, Trophy, LogIn, LogOut, Settings, Play, ArrowRight, User as UserIcon, Shield, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

interface GameUser {
  uid: string;
  displayName: string;
  totalStardust: number;
  highScore: number;
  completedMissions: string[];
  shipColor?: string;
  shipType?: 'scout' | 'fighter' | 'tank';
  skillPoints?: number;
  unlockedSkills?: string[];
}

interface Skill {
  id: string;
  name: string;
  description: string;
  cost: number;
  icon: React.ReactNode;
}

const SKILLS: Skill[] = [
  { id: 'hull', name: 'Reinforced Hull', description: '+20% Max Health', cost: 1, icon: <Shield className="w-5 h-5" /> },
  { id: 'engines', name: 'Overclocked Engines', description: '+15% Base Speed', cost: 1, icon: <Zap className="w-5 h-5" /> },
  { id: 'cooldowns', name: 'Efficient Cooldowns', description: '-20% Ability Cooldowns', cost: 2, icon: <Settings className="w-5 h-5" /> },
  { id: 'magnet', name: 'Loot Magnet', description: '+50% Magnet Range', cost: 1, icon: <Star className="w-5 h-5" /> },
  { id: 'crit', name: 'Critical Surge', description: '+15% Critical Hit Chance', cost: 2, icon: <Zap className="w-5 h-5" /> },
];

interface LeaderboardEntry {
  id: string;
  uid: string;
  displayName: string;
  score: number;
  timestamp: any;
}

interface Particle {
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  color: string;
  type: 'stardust' | 'enemy' | 'planet' | 'miniboss' | 'boss' | 'bullet' | 'powerup' | 'visual' | 'playerBullet' | 'floatingText' | 'blackhole' | 'kamikaze' | 'sniper';
  hp?: number;
  maxHp?: number;
  lastFire?: number;
  life?: number;
  maxLife?: number;
  text?: string;
  powerupType?: 'shield' | 'speed' | 'magnet';
  rotation?: number;
  rotationSpeed?: number;
  hasRings?: boolean;
  state?: 'idle' | 'charging' | 'dashing' | 'sniping';
  chargeTime?: number;
}

interface Mission {
  id: string;
  title: string;
  description: string;
  goal: number;
  type: 'score' | 'total' | 'destroy' | 'survive';
}

const MISSIONS: Mission[] = [
  { id: 'm1', title: 'First Steps', description: 'Collect 10 stardust in one run', goal: 10, type: 'score' },
  { id: 'm2', title: 'Stardust Master', description: 'Collect 50 stardust in one run', goal: 50, type: 'score' },
  { id: 'm3', title: 'Void Veteran', description: 'Collect 100 total stardust', goal: 100, type: 'total' },
  { id: 'm4', title: 'Cosmic Legend', description: 'Collect 500 total stardust', goal: 500, type: 'total' },
  { id: 'm5', title: 'Black Hole Survivor', description: 'Reach 150 points in one run', goal: 150, type: 'score' },
  { id: 'm6', title: 'Galaxy Conqueror', description: 'Reach 300 points in one run', goal: 300, type: 'score' },
  { id: 'm7', title: 'Void Hunter', description: 'Destroy 50 enemies in one run', goal: 50, type: 'destroy' },
  { id: 'm8', title: 'Cosmic Guardian', description: 'Destroy 100 enemies in one run', goal: 100, type: 'destroy' },
];

// --- Components ---

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<any, any> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-center">
          <div className="bg-slate-900 border border-red-500/50 p-8 rounded-2xl max-w-md">
            <h2 className="text-2xl font-bold text-red-400 mb-4">Something went wrong</h2>
            <p className="text-slate-400 mb-6">
              {(this.state.error as any)?.message || "An unexpected error occurred."}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

const Game = ({ user, shipColor = '#38bdf8', shipType = 'scout', unlockedSkills = [], onGameOver }: { 
  user: User | { uid: string, displayName: string }, 
  shipColor?: string,
  shipType?: string,
  unlockedSkills?: string[],
  onGameOver: (score: number, enemiesDestroyed: number) => void 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [health, setHealth] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  const [playerSize, setPlayerSize] = useState(15);
  const [bossWarning, setBossWarning] = useState<string | null>(null);
  const [activePowerups, setActivePowerups] = useState<{shield?: number, speed?: number, magnet?: number}>({});
  const [combo, setCombo] = useState(0);
  const [unlockedAbilities, setUnlockedAbilities] = useState<string[]>([]);
  const [abilityCooldowns, setAbilityCooldowns] = useState<Record<string, number>>({});
  
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const comboTimerRef = useRef(0);
  const screenShakeRef = useRef(0);
  const healthRef = useRef(100);
  const playerSizeRef = useRef(15);
  const lastBossSpawn = useRef(0);
  const lastMiniBossSpawn = useRef(0);
  const enemiesDestroyedRef = useRef(0);
  const timeDilationRef = useRef(0);
  const gravityWellRef = useRef(0);
  const requestRef = useRef<number>(null);
  const mousePos = useRef({ x: 0, y: 0 });
  const shipPos = useRef({ x: 0, y: 0 });
  const shipTrail = useRef<{x: number, y: number, size: number}[]>([]);
  const particles = useRef<Particle[]>([]);
  const visualParticles = useRef<Particle[]>([]);
  const backgroundStars = useRef<{x: number, y: number, size: number, depth: number}[]>([]);
  const nebulae = useRef<{x: number, y: number, size: number, color: string}[]>([]);
  const spaceDust = useRef<{x: number, y: number, size: number, vx: number, vy: number}[]>([]);
  const powerupsRef = useRef<{shield: number, speed: number, magnet: number}>({ shield: 0, speed: 0, magnet: 0 });
  const abilitiesRef = useRef<Record<string, number>>({ jump: 0, shoot: 0, nova: 0, timeDilation: 0, gravityWell: 0, phaseShift: 0 });
  const phaseShiftRef = useRef<number>(0);
  const lastDamageTime = useRef<number>(0);
  const lastTime = useRef<number>(0);
  const spawnTimer = useRef<number>(0);

  const spawnExplosion = useCallback((x: number, y: number, color: string, count = 10) => {
    for (let i = 0; i < count; i++) {
      visualParticles.current.push({
        x, y,
        size: Math.random() * 3 + 1,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10,
        color,
        type: 'visual',
        life: 1.0,
        maxLife: 1.0
      });
    }
  }, []);

  const spawnFloatingText = useCallback((x: number, y: number, text: string, color: string) => {
    visualParticles.current.push({
      x, y,
      size: 16,
      vx: (Math.random() - 0.5) * 2,
      vy: -2,
      color,
      type: 'floatingText',
      text,
      life: 1.5,
      maxLife: 1.5
    });
  }, []);

  const spawnParticle = useCallback((width: number, height: number, type: Particle['type'] = 'stardust', scale = 1) => {
    // Spawn in a ring around the player
    const angle = Math.random() * Math.PI * 2;
    const dist = (Math.max(width, height) / scale) * (0.8 + Math.random() * 0.4);
    const x = shipPos.current.x + Math.cos(angle) * dist;
    const y = shipPos.current.y + Math.sin(angle) * dist;

    let size = 0;
    let color = '';
    let hp = 0;
    let powerupType: Particle['powerupType'] = undefined;

    switch(type) {
      case 'enemy':
        size = Math.random() * 15 + 15;
        color = '#ef4444';
        break;
      case 'kamikaze':
        size = 20;
        color = '#f87171';
        hp = 4;
        break;
      case 'sniper':
        size = 25;
        color = '#fb7185';
        hp = 6;
        break;
      case 'planet':
        size = Math.random() * 40 + 30;
        color = `hsl(${Math.random() * 360}, 70%, 60%)`;
        const hasRings = Math.random() > 0.5;
        return { 
          x, y, size, vx: (Math.random() - 0.5) * 1, vy: (Math.random() - 0.5) * 1, 
          color, type, rotation: Math.random() * Math.PI * 2, rotationSpeed: (Math.random() - 0.5) * 0.02,
          hasRings, hp: 3, maxHp: 3
        };
      case 'blackhole':
        size = 200 + Math.random() * 200; // Even larger
        color = '#000000';
        return { 
          x, y, size, vx: (Math.random() - 0.5) * 0.1, vy: (Math.random() - 0.5) * 0.1, 
          color, type, rotation: 0, rotationSpeed: 0.01 
        };
      case 'miniboss':
        size = 80;
        color = '#f97316';
        hp = 10;
        break;
      case 'boss':
        size = 150;
        color = '#a855f7';
        hp = 50;
        break;
      case 'bullet':
        size = 8;
        color = '#facc15';
        break;
      case 'playerBullet':
        size = 10;
        color = '#38bdf8';
        break;
      case 'powerup':
        size = 20;
        const pRand = Math.random();
        if (pRand < 0.33) powerupType = 'shield';
        else if (pRand < 0.66) powerupType = 'speed';
        else powerupType = 'magnet';
        
        color = powerupType === 'shield' ? '#34d399' : (powerupType === 'speed' ? '#fbbf24' : '#a855f7');
        break;
      default:
        size = Math.random() * 4 + 3;
        color = `hsl(${Math.random() * 60 + 180}, 100%, 70%)`;
    }

    const difficultyMult = 1 + (scoreRef.current / 300);
    const speedMult = type === 'stardust' ? 1 : 1.2 * difficultyMult;

    return {
      x, y,
      size,
      vx: (Math.random() - 0.5) * 2 * speedMult,
      vy: (Math.random() - 0.5) * 2 * speedMult,
      color,
      type,
      hp: hp * difficultyMult,
      maxHp: hp * difficultyMult,
      powerupType
    };
  }, []);

  const update = useCallback((time: number) => {
    if (isPaused) {
      requestRef.current = requestAnimationFrame(update);
      return;
    }
    
    const dt = lastTime.current === 0 ? 0 : (time - lastTime.current) / 1000;
    lastTime.current = time;

    const timeScale = timeDilationRef.current > 0 ? 0.2 : 1;
    if (timeDilationRef.current > 0) timeDilationRef.current -= dt;
    if (gravityWellRef.current > 0) gravityWellRef.current -= dt;
    if (phaseShiftRef.current > 0) phaseShiftRef.current -= dt;
    const pDt = dt * timeScale;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Camera & Scaling
    const scale = Math.max(0.3, 1 - (playerSizeRef.current - 15) / 500);

    // Update ship
    const hasSkill = (id: string) => unlockedSkills.includes(id);

    // Update ship
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const dx = (mousePos.current.x - centerX) / scale;
    const dy = (mousePos.current.y - centerY) / scale;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    let baseSpeed = 350;
    if (shipType === 'tank') baseSpeed = 280;
    if (shipType === 'scout') baseSpeed = 350;
    if (shipType === 'fighter') baseSpeed = 420;

    if (hasSkill('engines')) baseSpeed *= 1.15;

    const speed = powerupsRef.current.speed > 0 ? baseSpeed * 1.8 : baseSpeed;
    if (dist > 5) {
      shipPos.current.x += (dx / dist) * speed * dt;
      shipPos.current.y += (dy / dist) * speed * dt;
      
      // Update trail
      shipTrail.current.unshift({ x: shipPos.current.x, y: shipPos.current.y, size: playerSizeRef.current });
      if (shipTrail.current.length > 15) shipTrail.current.pop();
    }

    // Update powerups
    if (powerupsRef.current.shield > 0) {
      powerupsRef.current.shield -= dt;
      if (powerupsRef.current.shield <= 0) setActivePowerups(prev => ({ ...prev, shield: 0 }));
    }
    if (powerupsRef.current.speed > 0) {
      powerupsRef.current.speed -= dt;
      if (powerupsRef.current.speed <= 0) setActivePowerups(prev => ({ ...prev, speed: 0 }));
    }
    if (powerupsRef.current.magnet > 0) {
      powerupsRef.current.magnet -= dt;
      if (powerupsRef.current.magnet <= 0) setActivePowerups(prev => ({ ...prev, magnet: 0 }));
    }

    // Health regeneration
    const maxHealth = hasSkill('hull') ? 120 : 100;
    if (healthRef.current < maxHealth) {
      healthRef.current += dt * 0.5; // Slow regen
      setHealth((healthRef.current / maxHealth) * 100);
    }

    // Update ability cooldowns
    Object.keys(abilitiesRef.current).forEach(key => {
      if (abilitiesRef.current[key] > 0) {
        let cooldownDt = dt;
        if (hasSkill('cooldowns')) cooldownDt *= 1.25; // Effectively reduces cooldown by 20%
        abilitiesRef.current[key] -= cooldownDt;
        if (abilitiesRef.current[key] <= 0) {
          abilitiesRef.current[key] = 0;
          setAbilityCooldowns(prev => ({ ...prev, [key]: 0 }));
        } else {
          // Throttle state update for performance
          if (Math.random() < 0.1) {
            setAbilityCooldowns(prev => ({ ...prev, [key]: abilitiesRef.current[key] }));
          }
        }
      }
    });

    // Unlock abilities based on score
    if (scoreRef.current >= 30 && !unlockedAbilities.includes('jump')) {
      setUnlockedAbilities(prev => [...prev, 'jump']);
      setBossWarning("TEMPORAL JUMP UNLOCKED! (SPACE)");
      setTimeout(() => setBossWarning(null), 3000);
    }
    if (scoreRef.current >= 60 && !unlockedAbilities.includes('shoot')) {
      setUnlockedAbilities(prev => [...prev, 'shoot']);
      setBossWarning("PLASMA CANNON UNLOCKED! (E)");
      setTimeout(() => setBossWarning(null), 3000);
    }
    if (scoreRef.current >= 100 && !unlockedAbilities.includes('nova')) {
      setUnlockedAbilities(prev => [...prev, 'nova']);
      setBossWarning("NOVA BLAST UNLOCKED! (Q)");
      setTimeout(() => setBossWarning(null), 3000);
    }
    if (scoreRef.current >= 150 && !unlockedAbilities.includes('timeDilation')) {
      setUnlockedAbilities(prev => [...prev, 'timeDilation']);
      setBossWarning("TIME DILATION UNLOCKED! (R)");
      setTimeout(() => setBossWarning(null), 3000);
    }
    if (scoreRef.current >= 200 && !unlockedAbilities.includes('gravityWell')) {
      setUnlockedAbilities(prev => [...prev, 'gravityWell']);
      setBossWarning("GRAVITY WELL UNLOCKED! (F)");
      setTimeout(() => setBossWarning(null), 3000);
    }
    if (scoreRef.current >= 250 && !unlockedAbilities.includes('phaseShift')) {
      setUnlockedAbilities(prev => [...prev, 'phaseShift']);
      setBossWarning("PHASE SHIFT UNLOCKED! (SHIFT)");
      setTimeout(() => setBossWarning(null), 3000);
    }

    // Update combo
    if (comboTimerRef.current > 0) {
      comboTimerRef.current -= dt;
      if (comboTimerRef.current <= 0) {
        comboRef.current = 0;
        setCombo(0);
      }
    }

    // Shield Recharge (3.1)
    if (time - lastDamageTime.current > 5000 && healthRef.current < 100) {
      healthRef.current += dt * 5;
      setHealth(Math.min(100, healthRef.current));
    }

    // Update screen shake
    if (screenShakeRef.current > 0) {
      screenShakeRef.current -= dt * 10;
    }

    // Growth logic
    const targetSize = 15 + Math.floor(scoreRef.current / 2);
    const oldLevel = Math.floor(playerSizeRef.current / 10);
    if (playerSizeRef.current < targetSize) {
      playerSizeRef.current += dt * 5;
      setPlayerSize(playerSizeRef.current);
      
      const newLevel = Math.floor(playerSizeRef.current / 10);
      if (newLevel > oldLevel) {
        spawnFloatingText(shipPos.current.x, shipPos.current.y - 50, `LEVEL UP!`, "#38bdf8");
        screenShakeRef.current = 10;
      }
    }

    // Draw background parallax stars
    ctx.save();
    
    // Draw Nebulae
    nebulae.current.forEach(neb => {
      const nx = (neb.x - shipPos.current.x * 0.05) % (canvas.width * 2);
      const ny = (neb.y - shipPos.current.y * 0.05) % (canvas.height * 2);
      const finalX = nx < 0 ? nx + canvas.width * 2 : nx;
      const finalY = ny < 0 ? ny + canvas.height * 2 : ny;
      
      const grad = ctx.createRadialGradient(finalX, finalY, 0, finalX, finalY, neb.size);
      grad.addColorStop(0, neb.color);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.15;
      ctx.fillRect(finalX - neb.size, finalY - neb.size, neb.size * 2, neb.size * 2);
    });
    
    // Draw Space Dust (3.0)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    spaceDust.current.forEach(dust => {
      dust.x = (dust.x + dust.vx) % canvas.width;
      dust.y = (dust.y + dust.vy) % canvas.height;
      if (dust.x < 0) dust.x += canvas.width;
      if (dust.y < 0) dust.y += canvas.height;
      ctx.fillRect(dust.x, dust.y, dust.size, dust.size);
    });

    // Layer 1: Far stars
    backgroundStars.current.forEach(star => {
      const sx = (star.x - shipPos.current.x * star.depth * 0.1) % canvas.width;
      const sy = (star.y - shipPos.current.y * star.depth * 0.1) % canvas.height;
      const finalX = sx < 0 ? sx + canvas.width : sx;
      const finalY = sy < 0 ? sy + canvas.height : sy;
      ctx.fillStyle = `rgba(255, 255, 255, ${0.1 + star.depth * 0.3})`;
      ctx.beginPath();
      ctx.arc(finalX, finalY, star.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Layer 2: Mid stars
    ctx.fillStyle = '#38bdf8';
    for (let i = 0; i < 40; i++) {
      const sx = (i * 300 - shipPos.current.x * 0.2) % canvas.width;
      const sy = (i * 250 - shipPos.current.y * 0.2) % canvas.height;
      const finalX = sx < 0 ? sx + canvas.width : sx;
      const finalY = sy < 0 ? sy + canvas.height : sy;
      ctx.globalAlpha = 0.1;
      ctx.fillRect(finalX, finalY, 2, 2);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.save();
    const shakeX = (Math.random() - 0.5) * screenShakeRef.current;
    const shakeY = (Math.random() - 0.5) * screenShakeRef.current;
    ctx.translate(canvas.width / 2 + shakeX, canvas.height / 2 + shakeY);
    ctx.scale(scale, scale);
    ctx.translate(-shipPos.current.x, -shipPos.current.y);

    // Draw ship trail
    ctx.save();
    shipTrail.current.forEach((t, i) => {
      const alpha = 1 - (i / shipTrail.current.length);
      ctx.globalAlpha = alpha * 0.3;
      ctx.fillStyle = powerupsRef.current.speed > 0 ? '#fbbf24' : shipColor;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.size * (1 - i / 20), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // Draw ship
    ctx.save();
    ctx.translate(shipPos.current.x, shipPos.current.y);
    ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
    
    // Phase Shift effect (3.0)
    if (phaseShiftRef.current > 0) {
      ctx.globalAlpha = 0.5 + Math.sin(time / 50) * 0.3;
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#34d399';
    }
    
    // Shield effect
    if (powerupsRef.current.shield > 0) {
      const pulse = Math.sin(time / 200) * 0.2 + 0.8;
      ctx.strokeStyle = `rgba(52, 211, 153, ${pulse})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, playerSizeRef.current * (1.4 + Math.sin(time/500)*0.1), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(52, 211, 153, ${pulse * 0.1})`;
      ctx.fill();
    }

    ctx.fillStyle = powerupsRef.current.speed > 0 ? '#fbbf24' : shipColor;
    ctx.beginPath();
    
    if (shipType === 'tank') {
      // Tank: Heavier, blockier ship
      ctx.rect(-playerSizeRef.current, -playerSizeRef.current, playerSizeRef.current * 2, playerSizeRef.current * 2);
    } else if (shipType === 'fighter') {
      // Fighter: Sleek, dual-pointed
      ctx.moveTo(0, -playerSizeRef.current * 1.2);
      ctx.lineTo(playerSizeRef.current * 0.8, playerSizeRef.current);
      ctx.lineTo(0, playerSizeRef.current * 0.5);
      ctx.lineTo(-playerSizeRef.current * 0.8, playerSizeRef.current);
    } else {
      // Scout: Classic triangle
      ctx.moveTo(0, -playerSizeRef.current);
      ctx.lineTo(playerSizeRef.current * 0.7, playerSizeRef.current * 0.7);
      ctx.lineTo(-playerSizeRef.current * 0.7, playerSizeRef.current * 0.7);
    }
    
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 15;
    ctx.shadowColor = ctx.fillStyle as string;
    ctx.stroke();
    ctx.restore();

    // Spawn logic
    spawnTimer.current += dt;
    const baseSpawnInterval = 0.3;
    const difficultySpawnInterval = Math.max(0.08, baseSpawnInterval - (scoreRef.current / 800));
    
    if (spawnTimer.current > difficultySpawnInterval) {
      const rand = Math.random();
      // More stardust, very rare blackholes
      if (rand < 0.2) particles.current.push(spawnParticle(canvas.width, canvas.height, 'enemy', scale));
      else if (rand < 0.3) particles.current.push(spawnParticle(canvas.width, canvas.height, 'kamikaze', scale));
      else if (rand < 0.35) particles.current.push(spawnParticle(canvas.width, canvas.height, 'sniper', scale));
      else if (rand < 0.45) particles.current.push(spawnParticle(canvas.width, canvas.height, 'planet', scale));
      else if (rand < 0.52) particles.current.push(spawnParticle(canvas.width, canvas.height, 'powerup', scale));
      else if (rand < 0.53 && scoreRef.current > 50) particles.current.push(spawnParticle(canvas.width, canvas.height, 'blackhole', scale)); // Very Rare
      else {
        // Spawn multiple stardust at once for "more points" feel
        const count = Math.floor(Math.random() * 3) + 2;
        for(let i=0; i<count; i++) {
          particles.current.push(spawnParticle(canvas.width, canvas.height, 'stardust', scale));
        }
      }
      spawnTimer.current = 0;
    }

    // Boss spawning (Limited)
    const activeBosses = particles.current.filter(p => p.type === 'boss').length;
    const activeMiniBosses = particles.current.filter(p => p.type === 'miniboss').length;

    if (scoreRef.current >= lastMiniBossSpawn.current + 15 && activeMiniBosses < 3) {
      particles.current.push(spawnParticle(canvas.width, canvas.height, 'miniboss', scale));
      lastMiniBossSpawn.current = Math.floor(scoreRef.current / 15) * 15;
      setBossWarning("MINI BOSS INCOMING!");
      setTimeout(() => setBossWarning(null), 3000);
    }
    if (scoreRef.current >= lastBossSpawn.current + 80 && activeBosses < 2) {
      particles.current.push(spawnParticle(canvas.width, canvas.height, 'boss', scale));
      lastBossSpawn.current = Math.floor(scoreRef.current / 80) * 80;
      setBossWarning("ULTIMATE BOSS INCOMING!");
      setTimeout(() => setBossWarning(null), 5000);
    }

    // Update & Draw visual particles
    for (let i = visualParticles.current.length - 1; i >= 0; i--) {
      const vp = visualParticles.current[i];
      vp.x += vp.vx;
      vp.y += vp.vy;
      vp.life! -= dt;
      if (vp.life! <= 0) {
        visualParticles.current.splice(i, 1);
        continue;
      }

      if (vp.type === 'floatingText') {
        ctx.save();
        ctx.globalAlpha = vp.life! / vp.maxLife!;
        ctx.fillStyle = vp.color;
        ctx.font = `bold ${vp.size}px Inter`;
        ctx.textAlign = 'center';
        ctx.fillText(vp.text!, vp.x, vp.y);
        ctx.restore();
      } else {
        ctx.globalAlpha = vp.life!;
        ctx.fillStyle = vp.color;
        ctx.beginPath();
        ctx.arc(vp.x, vp.y, vp.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Update & Draw particles
    for (let i = particles.current.length - 1; i >= 0; i--) {
      const p = particles.current[i];

      // Tracking logic for bosses
      if (p.type === 'miniboss' || p.type === 'boss' || p.type === 'enemy') {
        const tdx = shipPos.current.x - p.x;
        const tdy = shipPos.current.y - p.y;
        const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
        const trackingSpeed = p.type === 'boss' ? 0.5 : (p.type === 'miniboss' ? 1.2 : 1.5);
        
        if (tdist > 0) {
          p.vx += (tdx / tdist) * trackingSpeed * pDt;
          p.vy += (tdy / tdist) * trackingSpeed * pDt;
          
          // Limit velocity
          const maxV = p.type === 'boss' ? 1.5 : 2.5;
          const currentV = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          if (currentV > maxV) {
            p.vx = (p.vx / currentV) * maxV;
            p.vy = (p.vy / currentV) * maxV;
          }
        }

        // Firing logic
        if (p.type !== 'enemy') {
          if (!p.lastFire) p.lastFire = time;
          const fireRate = p.type === 'boss' ? 1500 : 2500; // ms
          if (time - p.lastFire > fireRate) {
            p.lastFire = time;
            const bdx = shipPos.current.x - p.x;
            const bdy = shipPos.current.y - p.y;
            const bdist = Math.sqrt(bdx * bdx + bdy * bdy);
            const bSpeed = 2.5; // Slower enemy projectiles
            
            particles.current.push({
              x: p.x,
              y: p.y,
              size: 8,
              vx: (bdx / bdist) * bSpeed,
              vy: (bdy / bdist) * bSpeed,
              color: '#facc15',
              type: 'bullet'
            });
          }
        }
      }

      // Kamikaze AI (3.0)
      if (p.type === 'kamikaze') {
        const tdx = shipPos.current.x - p.x;
        const tdy = shipPos.current.y - p.y;
        const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
        
        if (p.state === 'idle' || !p.state) {
          if (tdist < 400) {
            p.state = 'charging';
            p.chargeTime = time;
          } else {
            p.vx += (tdx / tdist) * 2 * pDt;
            p.vy += (tdy / tdist) * 2 * pDt;
          }
        } else if (p.state === 'charging') {
          p.vx *= 0.95;
          p.vy *= 0.95;
          if (time - p.chargeTime! > 1000) {
            p.state = 'dashing';
            p.vx = (tdx / tdist) * 15;
            p.vy = (tdy / tdist) * 15;
          }
        } else if (p.state === 'dashing') {
          if (tdist < 50) p.state = 'idle';
        }
      }

      // Sniper AI (3.0)
      if (p.type === 'sniper') {
        const tdx = shipPos.current.x - p.x;
        const tdy = shipPos.current.y - p.y;
        const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
        
        if (tdist > 500) {
          p.vx += (tdx / tdist) * 1.5 * pDt;
          p.vy += (tdy / tdist) * 1.5 * pDt;
        } else if (tdist < 300) {
          p.vx -= (tdx / tdist) * 1.5 * pDt;
          p.vy -= (tdy / tdist) * 1.5 * pDt;
        } else {
          p.vx *= 0.9;
          p.vy *= 0.9;
        }
        
        if (!p.lastFire) p.lastFire = time;
        if (time - p.lastFire > 3000) {
          p.lastFire = time;
          const bSpeed = 8;
          particles.current.push({
            x: p.x, y: p.y, size: 6,
            vx: (tdx / tdist) * bSpeed,
            vy: (tdy / tdist) * bSpeed,
            color: '#fb7185',
            type: 'bullet'
          });
        }
      }

      p.x += p.vx * timeScale;
      p.y += p.vy * timeScale;

      // Black Hole Gravity
      if (p.type === 'blackhole') {
        p.rotation! += p.rotationSpeed! * timeScale;
        particles.current.forEach(other => {
          if (other === p || other.type === 'visual' || other.type === 'floatingText' || other.type === 'blackhole') return;
          const gdx = p.x - other.x;
          const gdy = p.y - other.y;
          const gdist = Math.sqrt(gdx * gdx + gdy * gdy);
          if (gdist < p.size * 5) {
            const force = (1 - gdist / (p.size * 5)) * 10;
            other.vx += (gdx / gdist) * force * pDt * 60;
            other.vy += (gdy / gdist) * force * pDt * 60;
            
            // Sucked in!
            if (gdist < p.size * 0.8) {
              if (other.type === 'enemy' || other.type === 'bullet' || other.type === 'planet') {
                spawnExplosion(other.x, other.y, other.color, 5);
                other.hp = -1; // Mark for removal
              }
            }
          }
        });

        // Pull player
        const pdx = p.x - shipPos.current.x;
        const pdy = p.y - shipPos.current.y;
        const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
        if (pdist < p.size * 6) {
          const force = (1 - pdist / (p.size * 6)) * 8;
          shipPos.current.x += (pdx / pdist) * force * dt * 60;
          shipPos.current.y += (pdy / pdist) * force * dt * 60;
          
          if (pdist < p.size * 0.7 && powerupsRef.current.shield <= 0) {
            healthRef.current -= dt * 100; // Rapid damage
            setHealth(Math.max(0, healthRef.current));
            screenShakeRef.current = 5;
          }
        }
      }

      // Magnet logic / Gravity Well
      if (p.type === 'stardust') {
        const mdx = shipPos.current.x - p.x;
        const mdy = shipPos.current.y - p.y;
        const mdist = Math.sqrt(mdx * mdx + mdy * mdy);
        
        const magnetActive = powerupsRef.current.magnet > 0;
        const gravityWellActive = gravityWellRef.current > 0;
        
        if (gravityWellActive) {
          const force = 18; // Balanced pull
          p.vx += (mdx / mdist) * force * pDt * 60;
          p.vy += (mdy / mdist) * force * pDt * 60;
        } else if (magnetActive) {
          const magnetRange = 400 * (hasSkill('magnet') ? 1.5 : 1);
          if (mdist < magnetRange) {
            const force = (1 - mdist / magnetRange) * 15;
            p.vx += (mdx / mdist) * force * pDt * 60;
            p.vy += (mdy / mdist) * force * pDt * 60;
          }
        }
      }

      // Wrap or remove (extended bounds for larger world feel)
      const bounds = 8000;
      if (Math.abs(p.x - shipPos.current.x) > bounds || Math.abs(p.y - shipPos.current.y) > bounds) {
        if (p.type === 'stardust') {
          p.x = shipPos.current.x + (Math.random() - 0.5) * bounds * 1.5;
          p.y = shipPos.current.y + (Math.random() - 0.5) * bounds * 1.5;
        } else if (p.type === 'enemy' || p.type === 'planet' || p.type === 'bullet' || p.type === 'playerBullet') {
          particles.current.splice(i, 1);
          continue;
        }
      }

      // Player bullet collision with enemies
      if (p.type === 'playerBullet') {
        for (let j = particles.current.length - 1; j >= 0; j--) {
          const target = particles.current[j];
          if (target.type === 'enemy' || target.type === 'miniboss' || target.type === 'boss' || target.type === 'planet') {
            const tdx = target.x - p.x;
            const tdy = target.y - p.y;
            const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
            if (tdist < target.size + p.size) {
              if (target.hp !== undefined && target.hp > 0) {
                target.hp -= 1;
                spawnExplosion(p.x, p.y, target.color, 5);
                if (target.hp <= 0) {
                  const baseScore = target.type === 'boss' ? 50 : (target.type === 'miniboss' ? 10 : 5);
                  scoreRef.current += baseScore;
                  enemiesDestroyedRef.current += 1;
                  setScore(scoreRef.current);
                  spawnExplosion(target.x, target.y, target.color, 20);
                  
                  // Drop stardust
                  const dropCount = target.type === 'boss' ? 20 : (target.type === 'miniboss' ? 10 : 5);
                  for (let k = 0; k < dropCount; k++) {
                    particles.current.push({
                      x: target.x + (Math.random() - 0.5) * 50,
                      y: target.y + (Math.random() - 0.5) * 50,
                      size: Math.random() * 3 + 2,
                      vx: (Math.random() - 0.5) * 5,
                      vy: (Math.random() - 0.5) * 5,
                      color: `hsl(${Math.random() * 60 + 180}, 100%, 70%)`,
                      type: 'stardust'
                    });
                  }
                  
                  particles.current.splice(j, 1);
                }
              } else {
                scoreRef.current += target.type === 'planet' ? 3 : 1;
                if (target.type !== 'planet') enemiesDestroyedRef.current += 1;
                setScore(scoreRef.current);
                spawnExplosion(target.x, target.y, target.color, 10);
                
                // Drop stardust
                const dropCount = target.type === 'planet' ? 8 : 3;
                for (let k = 0; k < dropCount; k++) {
                  particles.current.push({
                    x: target.x + (Math.random() - 0.5) * 30,
                    y: target.y + (Math.random() - 0.5) * 30,
                    size: Math.random() * 3 + 2,
                    vx: (Math.random() - 0.5) * 4,
                    vy: (Math.random() - 0.5) * 4,
                    color: `hsl(${Math.random() * 60 + 180}, 100%, 70%)`,
                    type: 'stardust'
                  });
                }
                
                particles.current.splice(j, 1);
              }
              particles.current.splice(i, 1);
              break;
            }
          }
        }
        if (!particles.current[i]) continue;
      }

      // Collision
      const pdx = p.x - shipPos.current.x;
      const pdy = p.y - shipPos.current.y;
      const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
      const collisionRadius = p.size + playerSizeRef.current;

      if (pdist < collisionRadius * 0.8) {
        if (phaseShiftRef.current > 0 && (p.type === 'enemy' || p.type === 'kamikaze' || p.type === 'sniper' || p.type === 'bullet')) {
          // Pass through in phase shift
          continue;
        }
        if (p.type === 'stardust') {
          comboRef.current += 1;
          comboTimerRef.current = 2.0; // 2 seconds to keep combo
          setCombo(comboRef.current);
          
          const comboBonus = Math.floor(comboRef.current / 10);
          const points = 1 + comboBonus;
          scoreRef.current += points;
          setScore(scoreRef.current);
          
          if (comboBonus > 0 && comboRef.current % 10 === 0) {
            spawnFloatingText(p.x, p.y, `+${points} COMBO!`, '#fbbf24');
          }

          p.x = shipPos.current.x + (Math.random() - 0.5) * bounds * 1.5;
          p.y = shipPos.current.y + (Math.random() - 0.5) * bounds * 1.5;
        } else if (p.type === 'powerup') {
          powerupsRef.current[p.powerupType!] = 10; // 10 seconds
          setActivePowerups(prev => ({ ...prev, [p.powerupType!]: 10 }));
          spawnExplosion(p.x, p.y, p.color, 15);
          spawnFloatingText(p.x, p.y, p.powerupType!.toUpperCase(), p.color);
          screenShakeRef.current = 5;
          particles.current.splice(i, 1);
          continue;
        } else {
          // Can we destroy it?
          const canDestroy = playerSizeRef.current > p.size * 1.1 && p.type !== 'bullet';
          
          if (canDestroy) {
            if (p.hp !== undefined && p.hp > 0) {
              p.hp -= 1;
              spawnExplosion(p.x, p.y, p.color, 3);
              screenShakeRef.current = 2;
              // Bounce back a bit
              p.vx += (pdx / pdist) * 5;
              p.vy += (pdy / pdist) * 5;
              if (p.hp <= 0) {
                const critChance = hasSkill('crit') ? 0.25 : 0.1;
                const isCrit = Math.random() < critChance;
                const baseScore = p.type === 'boss' ? 50 : (p.type === 'miniboss' ? 10 : 5);
                const points = baseScore * (1 + Math.floor(comboRef.current / 20)) * (isCrit ? 2 : 1);
                scoreRef.current += points;
                setScore(scoreRef.current);
                spawnFloatingText(p.x, p.y, isCrit ? `CRITICAL! +${points}` : `+${points}`, isCrit ? "#f87171" : p.color);
                spawnExplosion(p.x, p.y, p.color, 30);
                screenShakeRef.current = p.type === 'boss' ? 20 : 10;
                
                // Drop stardust
                const dropCount = p.type === 'boss' ? 30 : (p.type === 'miniboss' ? 15 : 8);
                for (let k = 0; k < dropCount; k++) {
                  particles.current.push({
                    x: p.x + (Math.random() - 0.5) * 60,
                    y: p.y + (Math.random() - 0.5) * 60,
                    size: Math.random() * 3 + 2,
                    vx: (Math.random() - 0.5) * 6,
                    vy: (Math.random() - 0.5) * 6,
                    color: `hsl(${Math.random() * 60 + 180}, 100%, 70%)`,
                    type: 'stardust'
                  });
                }
                
                particles.current.splice(i, 1);
              }
            } else {
              const baseScore = p.type === 'planet' ? 3 : 1;
              const points = baseScore * (1 + Math.floor(comboRef.current / 20));
              scoreRef.current += points;
              setScore(scoreRef.current);
              spawnFloatingText(p.x, p.y, `+${points}`, p.color);
              spawnExplosion(p.x, p.y, p.color, 15);
              screenShakeRef.current = 5;
              
              // Drop stardust
              const dropCount = p.type === 'planet' ? 10 : 5;
              for (let k = 0; k < dropCount; k++) {
                particles.current.push({
                  x: p.x + (Math.random() - 0.5) * 40,
                  y: p.y + (Math.random() - 0.5) * 40,
                  size: Math.random() * 3 + 2,
                  vx: (Math.random() - 0.5) * 5,
                  vy: (Math.random() - 0.5) * 5,
                  color: `hsl(${Math.random() * 60 + 180}, 100%, 70%)`,
                  type: 'stardust'
                });
              }
              
              particles.current.splice(i, 1);
            }
            continue;
          } else {
            // Take damage
            if (powerupsRef.current.shield > 0) {
              // Shield absorbs damage
              if (p.type === 'bullet') {
                particles.current.splice(i, 1);
              } else {
                shipPos.current.x -= (pdx / pdist) * 10;
                shipPos.current.y -= (pdy / pdist) * 10;
              }
              spawnExplosion(shipPos.current.x, shipPos.current.y, '#34d399', 5);
              screenShakeRef.current = 3;
              continue;
            }

            let damage = 0;
            if (p.type === 'bullet') damage = 10;
            else if (p.type === 'boss') damage = 1;
            else if (p.type === 'miniboss') damage = 0.5;
            else damage = 20 * dt * 60;

            healthRef.current -= damage;
            lastDamageTime.current = time;
            setHealth(Math.max(0, healthRef.current));
            screenShakeRef.current = 15;
            spawnFloatingText(shipPos.current.x, shipPos.current.y, "OUCH!", "#ef4444");
            
            // Break combo on damage
            comboRef.current = 0;
            setCombo(0);

            if (healthRef.current <= 0) {
              onGameOver(scoreRef.current, enemiesDestroyedRef.current);
              ctx.restore();
              return;
            }
            // Bounce away from enemy
            if (p.type !== 'bullet') {
              shipPos.current.x -= (pdx / pdist) * 5;
              shipPos.current.y -= (pdy / pdist) * 5;
            } else {
              particles.current.splice(i, 1);
              continue;
            }
          }
        }
      }

      ctx.fillStyle = p.color;
      ctx.shadowBlur = p.type === 'enemy' || p.type === 'boss' || p.type === 'miniboss' || p.type === 'bullet' || p.type === 'powerup' || p.type === 'playerBullet' ? 20 : 10;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      
      if (p.type === 'enemy' || p.type === 'miniboss' || p.type === 'boss') {
        const spikes = p.type === 'boss' ? 12 : (p.type === 'miniboss' ? 10 : 8);
        for (let j = 0; j < spikes * 2; j++) {
          const angle = (j / (spikes * 2)) * Math.PI * 2;
          const r = j % 2 === 0 ? p.size : p.size / 2;
          ctx.lineTo(p.x + Math.cos(angle) * r, p.y + Math.sin(angle) * r);
        }
        ctx.closePath();
      } else if (p.type === 'planet') {
        ctx.save();
        ctx.translate(p.x, p.y);
        p.rotation! += p.rotationSpeed!;
        ctx.rotate(p.rotation!);
        
        // Planet body
        const grad = ctx.createRadialGradient(-p.size/3, -p.size/3, 0, 0, 0, p.size);
        grad.addColorStop(0, p.color);
        grad.addColorStop(1, '#000');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
        
        // Rings
        if (p.hasRings) {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 4;
          ctx.globalAlpha = 0.6;
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size * 1.8, p.size * 0.4, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.restore();
        continue;
      } else if (p.type === 'blackhole') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation!);
        
        // Event horizon glow
        const grad = ctx.createRadialGradient(0, 0, p.size * 0.5, 0, 0, p.size * 1.2);
        grad.addColorStop(0, '#a855f7');
        grad.addColorStop(0.5, '#3b82f6');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 1.2, 0, Math.PI * 2);
        ctx.fill();
        
        // Accretion disk
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.9, 0, Math.PI * 0.8);
        ctx.stroke();
        
        // Black core
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      } else if (p.type === 'powerup') {
        // Draw a diamond shape for powerups
        ctx.moveTo(p.x, p.y - p.size);
        ctx.lineTo(p.x + p.size, p.y);
        ctx.lineTo(p.x, p.y + p.size);
        ctx.lineTo(p.x - p.size, p.y);
        ctx.closePath();
        // Inner icon
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      }
      ctx.fill();

      // Draw HP bar for bosses
      if (p.hp !== undefined && p.maxHp !== undefined && p.hp < p.maxHp) {
        const barWidth = p.size * 2;
        ctx.fillStyle = '#334155';
        ctx.fillRect(p.x - p.size, p.y - p.size - 20, barWidth, 6);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(p.x - p.size, p.y - p.size - 20, barWidth * (p.hp / p.maxHp), 6);
      }
    }

    ctx.restore();
    requestRef.current = requestAnimationFrame(update);
  }, [isPaused, spawnParticle, onGameOver]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      if (shipPos.current.x === 0) {
        shipPos.current = { x: canvas.width / 2, y: canvas.height / 2 };
        mousePos.current = { x: canvas.width / 2, y: canvas.height / 2 };
      }
      
      // Initialize background stars
      if (backgroundStars.current.length === 0) {
        for (let i = 0; i < 100; i++) {
          backgroundStars.current.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 2,
            depth: Math.random() * 0.5
          });
        }
        
        // Initialize nebulae
        const nebulaColors = ['rgba(168, 85, 247, 0.4)', 'rgba(56, 189, 248, 0.4)', 'rgba(244, 63, 94, 0.4)'];
        for (let i = 0; i < 5; i++) {
          nebulae.current.push({
            x: Math.random() * canvas.width * 2,
            y: Math.random() * canvas.height * 2,
            size: 300 + Math.random() * 400,
            color: nebulaColors[Math.floor(Math.random() * nebulaColors.length)]
          });
        }

        // Initialize space dust (3.0)
        for (let i = 0; i < 50; i++) {
          spaceDust.current.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 1 + 0.5,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5
          });
        }
      }

      // Initialize particles only if empty
      if (particles.current.length === 0) {
        const count = 500;
        const newParticles: Particle[] = [];
        const bounds = 6000;
        for (let i = 0; i < count; i++) {
          newParticles.push({
            x: shipPos.current.x + (Math.random() - 0.5) * bounds,
            y: shipPos.current.y + (Math.random() - 0.5) * bounds,
            size: Math.random() * 3 + 2,
            vx: (Math.random() - 0.5) * 2,
            vy: (Math.random() - 0.5) * 2,
            color: `hsl(${Math.random() * 60 + 180}, 100%, 70%)`,
            type: 'stardust'
          });
        }
        particles.current = newParticles;
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    const handleMouseMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY };
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) {
        mousePos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPaused) return;

      const key = e.key.toLowerCase();
      
      // Warp Dash (Space) - Instant blink with damage trail
      if (key === ' ' && scoreRef.current >= 30 && abilitiesRef.current.jump <= 0) {
        e.preventDefault();
        abilitiesRef.current.jump = 4; // 4s cooldown
        setAbilityCooldowns(prev => ({ ...prev, jump: 4 }));
        
        const dx = mousePos.current.x - canvas.width / 2;
        const dy = mousePos.current.y - canvas.height / 2;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const dashDist = 300;
        
        const moveX = (dx / dist) * dashDist;
        const moveY = (dy / dist) * dashDist;
        
        // Explosion at start
        spawnExplosion(shipPos.current.x, shipPos.current.y, '#fbbf24', 20);
        
        shipPos.current.x += moveX;
        shipPos.current.y += moveY;
        
        // Explosion at end
        spawnExplosion(shipPos.current.x, shipPos.current.y, '#fbbf24', 20);
        screenShakeRef.current = 15;
        spawnFloatingText(shipPos.current.x, shipPos.current.y, "WARP!", "#fbbf24");
      }

      // Hyper Beam (E) - Piercing blast
      if (key === 'e' && scoreRef.current >= 60 && abilitiesRef.current.shoot <= 0) {
        abilitiesRef.current.shoot = 1.5; // 1.5s cooldown
        setAbilityCooldowns(prev => ({ ...prev, shoot: 1.5 }));
        
        const bdx = mousePos.current.x - canvas.width / 2;
        const bdy = mousePos.current.y - canvas.height / 2;
        const bdist = Math.sqrt(bdx * bdx + bdy * bdy);
        const bSpeed = 14; // Slower projectiles
        
        // Spawn 5 piercing bullets in a line
        for (let i = 0; i < 5; i++) {
          setTimeout(() => {
            particles.current.push({
              x: shipPos.current.x,
              y: shipPos.current.y,
              size: 15,
              vx: (bdx / bdist) * bSpeed,
              vy: (bdy / bdist) * bSpeed,
              color: '#38bdf8',
              type: 'playerBullet',
              hp: 5 // Piercing!
            });
          }, i * 50);
        }
        screenShakeRef.current = 5;
        spawnFloatingText(shipPos.current.x, shipPos.current.y, "HYPER BEAM!", "#38bdf8");
      }

      // Singularity (Q) - Sucks in and destroys
      if (key === 'q' && scoreRef.current >= 100 && abilitiesRef.current.nova <= 0) {
        abilitiesRef.current.nova = 20; // 20s cooldown
        setAbilityCooldowns(prev => ({ ...prev, nova: 20 }));
        
        const targetX = shipPos.current.x + (mousePos.current.x - canvas.width / 2);
        const targetY = shipPos.current.y + (mousePos.current.y - canvas.height / 2);

        spawnFloatingText(shipPos.current.x, shipPos.current.y, "SINGULARITY!", "#a855f7");
        
        // Visual effect for singularity
        for (let i = 0; i < 30; i++) {
          const angle = Math.random() * Math.PI * 2;
          const r = 200 + Math.random() * 100;
          visualParticles.current.push({
            x: targetX + Math.cos(angle) * r,
            y: targetY + Math.sin(angle) * r,
            size: 5,
            vx: -Math.cos(angle) * 10,
            vy: -Math.sin(angle) * 10,
            color: '#a855f7',
            type: 'visual',
            life: 0.5,
            maxLife: 0.5
          });
        }

        // Destroy nearby enemies
        const novaRadius = 500;
        for (let i = particles.current.length - 1; i >= 0; i--) {
          const p = particles.current[i];
          if (p.type === 'enemy' || p.type === 'kamikaze' || p.type === 'sniper' || p.type === 'bullet' || p.type === 'planet' || p.type === 'miniboss') {
            const dx = p.x - targetX;
            const dy = p.y - targetY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < novaRadius) {
              spawnExplosion(p.x, p.y, p.color, 10);
              particles.current.splice(i, 1);
              scoreRef.current += 1;
              enemiesDestroyedRef.current += 1;
            }
          }
        }
        setScore(scoreRef.current);
        screenShakeRef.current = 40;
      }

      // Phase Shift (Shift) - Invulnerability (3.0)
      if (key === 'shift' && scoreRef.current >= 250 && abilitiesRef.current.phaseShift <= 0) {
        e.preventDefault();
        abilitiesRef.current.phaseShift = 15; // 15s cooldown
        setAbilityCooldowns(prev => ({ ...prev, phaseShift: 15 }));
        phaseShiftRef.current = 3; // 3s duration
        spawnFloatingText(shipPos.current.x, shipPos.current.y, "PHASE SHIFT!", "#34d399");
      }

      // Time Dilation (R) - Slows down time for everything but player
      if (key === 'r' && scoreRef.current >= 150 && abilitiesRef.current.timeDilation <= 0) {
        abilitiesRef.current.timeDilation = 30; // 30s cooldown
        setAbilityCooldowns(prev => ({ ...prev, timeDilation: 30 }));
        timeDilationRef.current = 5; // 5s duration
        spawnFloatingText(shipPos.current.x, shipPos.current.y, "TIME DILATION!", "#34d399");
      }

      // Gravity Well (F) - Pulls all stardust to player
      if (key === 'f' && scoreRef.current >= 200 && abilitiesRef.current.gravityWell <= 0) {
        abilitiesRef.current.gravityWell = 40; // 40s cooldown (Balanced)
        setAbilityCooldowns(prev => ({ ...prev, gravityWell: 40 }));
        gravityWellRef.current = 5; // 5s duration (Balanced)
        spawnFloatingText(shipPos.current.x, shipPos.current.y, "GRAVITY WELL!", "#fbbf24");
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('keydown', handleKeyDown);

    requestRef.current = requestAnimationFrame(update);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('keydown', handleKeyDown);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [update]);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-950">
      <canvas ref={canvasRef} className="block w-full h-full" />

      <AnimatePresence>
        {bossWarning && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.5, y: -50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.5, y: 50 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div className="bg-red-600/20 backdrop-blur-xl border-y-4 border-red-500 py-8 w-full text-center">
              <h2 className="text-6xl font-black text-red-500 tracking-widest animate-pulse">
                {bossWarning}
              </h2>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      <div className="absolute top-6 left-6 flex flex-col gap-4 pointer-events-none">
        <div className="flex items-center gap-3 bg-slate-900/50 backdrop-blur-md border border-white/10 px-6 py-3 rounded-2xl">
          <Star className="w-6 h-6 text-yellow-400 fill-yellow-400" />
          <span className="text-2xl font-bold text-white font-mono">{score}</span>
        </div>

        <div className="flex items-center gap-3 bg-slate-900/50 backdrop-blur-md border border-white/10 px-6 py-3 rounded-2xl">
          <div className="w-6 h-6 rounded-full bg-sky-400 shadow-[0_0_10px_#38bdf8]"></div>
          <div className="flex flex-col">
            <span className="text-xl font-bold text-white font-mono leading-none">Size: {Math.floor(playerSize)}</span>
            <span className="text-[10px] text-sky-400 font-bold uppercase tracking-tighter">Level {Math.floor(playerSize / 10)}</span>
          </div>
        </div>

        {combo > 1 && (
          <motion.div 
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex items-center gap-3 bg-indigo-500/20 backdrop-blur-md border border-indigo-500 px-6 py-2 rounded-2xl"
          >
            <span className="text-xl font-black text-indigo-400 italic">COMBO x{combo}</span>
          </motion.div>
        )}
        
        <div className="w-48 h-3 bg-slate-900/50 rounded-full overflow-hidden border border-white/10">
          <motion.div 
            initial={{ width: '100%' }}
            animate={{ width: `${health}%` }}
            className={`h-full ${health > 30 ? 'bg-emerald-500' : 'bg-red-500'}`}
          />
        </div>

        {/* Powerup Indicators */}
        <div className="flex gap-2">
          {activePowerups.shield! > 0 && (
            <div className="px-3 py-1 bg-emerald-500/20 border border-emerald-500 rounded-full text-emerald-400 text-xs font-bold flex items-center gap-2">
              <Shield className="w-3 h-3" />
              SHIELD {Math.ceil(activePowerups.shield!)}s
            </div>
          )}
          {activePowerups.speed! > 0 && (
            <div className="px-3 py-1 bg-amber-500/20 border border-amber-500 rounded-full text-amber-400 text-xs font-bold flex items-center gap-2">
              <Zap className="w-3 h-3" />
              SPEED {Math.ceil(activePowerups.speed!)}s
            </div>
          )}
          {activePowerups.magnet! > 0 && (
            <div className="px-3 py-1 bg-purple-500/20 border border-purple-500 rounded-full text-purple-400 text-xs font-bold flex items-center gap-2">
              <Star className="w-3 h-3" />
              MAGNET {Math.ceil(activePowerups.magnet!)}s
            </div>
          )}
        </div>

        {/* Ability Icons */}
        <div className="flex gap-4 mt-2">
          {unlockedAbilities.includes('jump') && (
            <div className={`flex flex-col items-center gap-1 ${abilityCooldowns.jump > 0 ? 'opacity-40' : 'opacity-100'}`}>
              <div className="w-10 h-10 bg-slate-900/80 border border-amber-500 rounded-lg flex items-center justify-center text-amber-500">
                <Zap className="w-6 h-6" />
                {abilityCooldowns.jump > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg text-[10px] font-bold text-white">
                    {Math.ceil(abilityCooldowns.jump)}s
                  </div>
                )}
              </div>
              <span className="text-[10px] text-white font-bold">SPACE</span>
            </div>
          )}
          {unlockedAbilities.includes('shoot') && (
            <div className={`flex flex-col items-center gap-1 ${abilityCooldowns.shoot > 0 ? 'opacity-40' : 'opacity-100'}`}>
              <div className="w-10 h-10 bg-slate-900/80 border border-sky-500 rounded-lg flex items-center justify-center text-sky-500">
                <Rocket className="w-6 h-6" />
                {abilityCooldowns.shoot > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg text-[10px] font-bold text-white">
                    {Math.ceil(abilityCooldowns.shoot)}s
                  </div>
                )}
              </div>
              <span className="text-[10px] text-white font-bold">E</span>
            </div>
          )}
          {unlockedAbilities.includes('nova') && (
            <div className={`flex flex-col items-center gap-1 ${abilityCooldowns.nova > 0 ? 'opacity-40' : 'opacity-100'}`}>
              <div className="w-10 h-10 bg-slate-900/80 border border-purple-500 rounded-lg flex items-center justify-center text-purple-500 relative">
                <Star className="w-6 h-6" />
                {abilityCooldowns.nova > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg text-[10px] font-bold text-white">
                    {Math.ceil(abilityCooldowns.nova)}s
                  </div>
                )}
              </div>
              <span className="text-[10px] text-white font-bold">Q</span>
            </div>
          )}
          {unlockedAbilities.includes('timeDilation') && (
            <div className={`flex flex-col items-center gap-1 ${abilityCooldowns.timeDilation > 0 ? 'opacity-40' : 'opacity-100'}`}>
              <div className="w-10 h-10 bg-slate-900/80 border border-emerald-500 rounded-lg flex items-center justify-center text-emerald-500 relative">
                <Zap className="w-6 h-6" />
                {abilityCooldowns.timeDilation > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg text-[10px] font-bold text-white">
                    {Math.ceil(abilityCooldowns.timeDilation)}s
                  </div>
                )}
              </div>
              <span className="text-[10px] text-white font-bold">R</span>
            </div>
          )}
          {unlockedAbilities.includes('gravityWell') && (
            <div className={`flex flex-col items-center gap-1 ${abilityCooldowns.gravityWell > 0 ? 'opacity-40' : 'opacity-100'}`}>
              <div className="w-10 h-10 bg-slate-900/80 border border-amber-500 rounded-lg flex items-center justify-center text-amber-500 relative">
                <Star className="w-6 h-6" />
                {abilityCooldowns.gravityWell > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg text-[10px] font-bold text-white">
                    {Math.ceil(abilityCooldowns.gravityWell)}s
                  </div>
                )}
              </div>
              <span className="text-[10px] text-white font-bold">F</span>
            </div>
          )}
          {unlockedAbilities.includes('phaseShift') && (
            <div className={`flex flex-col items-center gap-1 ${abilityCooldowns.phaseShift > 0 ? 'opacity-40' : 'opacity-100'}`}>
              <div className="w-10 h-10 bg-slate-900/80 border border-emerald-400 rounded-lg flex items-center justify-center text-emerald-400 relative">
                <Shield className="w-6 h-6" />
                {abilityCooldowns.phaseShift > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg text-[10px] font-bold text-white">
                    {Math.ceil(abilityCooldowns.phaseShift)}s
                  </div>
                )}
              </div>
              <span className="text-[10px] text-white font-bold">SHIFT</span>
            </div>
          )}
        </div>
      </div>

      <div className="absolute top-6 right-6 flex gap-3">
        <button 
          onClick={() => setIsPaused(!isPaused)}
          className="p-3 bg-slate-900/50 backdrop-blur-md border border-white/10 rounded-xl text-white hover:bg-white/10 transition-colors"
        >
          {isPaused ? <Play className="w-6 h-6" /> : <Settings className="w-6 h-6" />}
        </button>
        <button 
          onClick={() => onGameOver(score, enemiesDestroyedRef.current)}
          className="px-6 py-3 bg-red-500/80 hover:bg-red-500 text-white font-bold rounded-xl backdrop-blur-md transition-colors"
        >
          End Game
        </button>
      </div>

      {isPaused && (
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-4xl font-bold text-white mb-8">Paused</h2>
            <button 
              onClick={() => setIsPaused(false)}
              className="px-8 py-3 bg-sky-500 hover:bg-sky-600 text-white font-bold rounded-xl transition-colors"
            >
              Resume
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const AppContent = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [gameUser, setGameUser] = useState<GameUser | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'results' | 'missions' | 'skills'>('menu');
  const [lastScore, setLastScore] = useState(0);
  const [loading, setLoading] = useState(true);

  // Auth listener
  useEffect(() => {
    console.log("Setting up auth listener...");
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log("Auth state changed:", firebaseUser?.uid);
      setUser(firebaseUser);
      if (firebaseUser) {
        setIsGuest(false);
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        try {
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            const data = userDoc.data() as GameUser;
            setGameUser({
              ...data,
              completedMissions: data.completedMissions || [],
              totalStardust: data.totalStardust || 0,
              highScore: data.highScore || 0
            });
          } else {
            const newUser: GameUser = {
              uid: firebaseUser.uid,
              displayName: firebaseUser.displayName || 'Explorer',
              totalStardust: 0,
              highScore: 0,
              completedMissions: [],
              shipColor: '#38bdf8',
              shipType: 'scout',
              skillPoints: 0,
              unlockedSkills: []
            };
            await setDoc(userDocRef, newUser);
            setGameUser(newUser);
          }
        } catch (error) {
          console.error("Error fetching user doc:", error);
          handleFirestoreError(error, OperationType.GET, 'users');
        }
      } else {
        setGameUser(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Leaderboard listener (MySQL version)
  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await fetch('./api/game.php');
        const data = await res.json();
        if (Array.isArray(data)) {
          setLeaderboard(data.map((entry: any, index: number) => ({
            id: index.toString(),
            uid: entry.displayName,
            displayName: entry.displayName,
            score: entry.score,
            timestamp: new Date()
          })));
        }
      } catch (e) {
        console.error("Error loading leaderboard:", e);
      }
    };
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const handleLogin = async () => {
    try {
      await login();
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        console.log("User closed the login popup.");
        return;
      }
      console.error("Login error:", error);
    }
  };

  const updateShipCustomization = async (color: string, type: 'scout' | 'fighter' | 'tank') => {
    if (!gameUser) return;
    const updatedUser: GameUser = {
      ...gameUser,
      shipColor: color,
      shipType: type
    };
    setGameUser(updatedUser);
    if (user) {
      try {
        await setDoc(doc(db, 'users', user.uid), updatedUser);
      } catch (error) {
        console.error("Error updating customization:", error);
      }
    }
  };

  const buySkill = async (skillId: string) => {
    if (!gameUser || !gameUser.skillPoints) return;
    const skill = SKILLS.find(s => s.id === skillId);
    if (!skill || gameUser.skillPoints < skill.cost) return;
    if (gameUser.unlockedSkills?.includes(skillId)) return;

    const updatedUser: GameUser = {
      ...gameUser,
      skillPoints: gameUser.skillPoints - skill.cost,
      unlockedSkills: [...(gameUser.unlockedSkills || []), skillId]
    };
    setGameUser(updatedUser);
    if (user) {
      try {
        await setDoc(doc(db, 'users', user.uid), updatedUser);
      } catch (error) {
        console.error("Error buying skill:", error);
      }
    }
  };

  const startGuestGame = useCallback(() => {
    setIsGuest(true);
    setGameUser({
      uid: 'guest',
      displayName: 'Guest Explorer',
      totalStardust: 0,
      highScore: 0,
      completedMissions: []
    });
    setGameState('playing');
  }, []);

  const handleGameOver = useCallback(async (score: number, enemiesDestroyed = 0) => {
    setLastScore(score);
    setGameState('results');

    const playerName = user?.displayName || (isGuest ? 'Guest' : 'Explorer');

    // Check missions
    const newlyCompletedMissions: string[] = [];
    MISSIONS.forEach(mission => {
      if (gameUser && !gameUser.completedMissions.includes(mission.id)) {
        if (mission.type === 'score' && score >= mission.goal) {
          newlyCompletedMissions.push(mission.id);
        } else if (mission.type === 'total' && (gameUser.totalStardust + score) >= mission.goal) {
          newlyCompletedMissions.push(mission.id);
        } else if (mission.type === 'destroy' && enemiesDestroyed >= mission.goal) {
          newlyCompletedMissions.push(mission.id);
        }
      }
    });

    if (gameUser) {
      // Calculate skill points earned (1 per 100 total stardust)
      const oldPoints = Math.floor(gameUser.totalStardust / 100);
      const newPoints = Math.floor((gameUser.totalStardust + score) / 100);
      const earnedPoints = newPoints - oldPoints;

      const updatedUser: GameUser = {
        ...gameUser,
        highScore: Math.max(gameUser.highScore, score),
        totalStardust: gameUser.totalStardust + score,
        completedMissions: [...gameUser.completedMissions, ...newlyCompletedMissions],
        skillPoints: (gameUser.skillPoints || 0) + earnedPoints
      };
      setGameUser(updatedUser);

      if (user) {
        try {
          await setDoc(doc(db, 'users', user.uid), updatedUser);
        } catch (error) {
          console.error("Error updating user missions:", error);
        }
      }
    }

    try {
      // Guardar en MySQL vía PHP
      await fetch('./api/game.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: playerName,
          score: score
        })
      });

      // Recargar ranking inmediatamente
      const lbRes = await fetch('./api/game.php');
      const lbData = await lbRes.json();
      if (Array.isArray(lbData)) {
        setLeaderboard(lbData.map((entry: any, index: number) => ({
          id: index.toString(),
          uid: entry.displayName,
          displayName: entry.displayName,
          score: entry.score,
          timestamp: new Date()
        })));
      }
    } catch (error) {
      console.error("Error saving to MySQL:", error);
    }
  }, [user, isGuest]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const isNotSecure = window.location.protocol !== 'https:' && window.location.hostname !== 'localhost';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-sky-500/30">
      {isNotSecure && (
        <div className="fixed top-0 left-0 w-full bg-red-500 text-white text-center py-2 z-[100] text-sm font-bold">
          ⚠️ Firebase Auth requires HTTPS. Please enable SSL in your hosting (InfinityFree/Cloudflare).
        </div>
      )}
      <AnimatePresence mode="wait">
        {gameState === 'menu' && (
          <motion.div 
            key="menu"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-6xl mx-auto px-6 py-12 lg:py-24 grid lg:grid-cols-3 gap-12 items-start"
          >
            <div className="lg:col-span-2 space-y-12">
              <div className="space-y-6">
                <motion.div 
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  className="w-16 h-16 bg-sky-500/20 rounded-2xl flex items-center justify-center border border-sky-500/30"
                >
                  <Rocket className="w-8 h-8 text-sky-400" />
                </motion.div>
                <h1 className="text-7xl font-black tracking-tighter text-white leading-none">
                  STARDUST<br /><span className="text-sky-500">VOID</span>
                  <span className="ml-4 text-xs bg-sky-600 px-2 py-1 rounded-full font-bold align-middle">v5.0</span>
                </h1>
                <p className="text-xl text-slate-400 max-w-md">
                  Navigate the void, gather stardust, avoid cosmic spikes, and etch your name among the stars.
                </p>
              </div>

              <div className="flex flex-wrap gap-4">
                {user ? (
                  <button 
                    onClick={() => setGameState('playing')}
                    className="group px-8 py-4 bg-white text-slate-950 font-bold rounded-2xl flex items-center gap-3 hover:bg-sky-400 transition-all hover:scale-105"
                  >
                    Launch Mission <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </button>
                ) : (
                  <>
                    <button 
                      onClick={handleLogin}
                      className="px-8 py-4 bg-sky-500 text-white font-bold rounded-2xl flex items-center gap-3 hover:bg-sky-600 transition-all"
                    >
                      <LogIn className="w-5 h-5" /> Sign in to Play
                    </button>
                    <button 
                      onClick={startGuestGame}
                      className="px-8 py-4 bg-slate-900 border border-white/10 text-white font-bold rounded-2xl flex items-center gap-3 hover:bg-white/5 transition-all"
                    >
                      Play as Guest
                    </button>
                  </>
                )}
                <button 
                  onClick={() => setGameState('missions')}
                  className="px-8 py-4 bg-slate-900 border border-white/10 text-white font-bold rounded-2xl flex items-center gap-3 hover:bg-white/5 transition-all"
                >
                  Missions
                </button>
                <button 
                  onClick={() => setGameState('skills')}
                  className="px-8 py-4 bg-purple-500/20 border border-purple-500/50 text-purple-400 font-bold rounded-2xl flex items-center gap-3 hover:bg-purple-500/30 transition-all"
                >
                  <Zap className="w-5 h-5" /> Skill Tree
                </button>
                {user && (
                  <button 
                    onClick={logout}
                    className="px-8 py-4 bg-slate-900 border border-white/10 text-white font-bold rounded-2xl flex items-center gap-3 hover:bg-white/5 transition-all"
                  >
                    <LogOut className="w-5 h-5" /> Sign Out
                  </button>
                )}
              </div>

              {/* Hangar Customization */}
              <div className="bg-slate-900/50 border border-white/5 p-8 rounded-[2.5rem] space-y-6 max-w-xl">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <Settings className="w-5 h-5 text-sky-400" /> Hangar Customization
                </h3>
                
                <div className="grid md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ship Color</label>
                    <div className="flex flex-wrap gap-3">
                      {['#38bdf8', '#f87171', '#fbbf24', '#a855f7', '#34d399'].map(color => (
                        <button
                          key={color}
                          onClick={() => updateShipCustomization(color, gameUser?.shipType || 'scout')}
                          className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${gameUser?.shipColor === color ? 'border-white scale-110' : 'border-transparent'}`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ship Type</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['scout', 'fighter', 'tank'] as const).map(type => (
                        <button
                          key={type}
                          onClick={() => updateShipCustomization(gameUser?.shipColor || '#38bdf8', type)}
                          className={`py-2 px-3 rounded-xl border text-[10px] font-bold capitalize transition-all ${gameUser?.shipType === type ? 'bg-sky-500 border-sky-400 text-white' : 'bg-slate-800 border-white/5 text-slate-400 hover:bg-slate-700'}`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2 italic">
                      {gameUser?.shipType === 'tank' && "Tank: High HP, Slower speed"}
                      {gameUser?.shipType === 'fighter' && "Fighter: High speed, Lower HP"}
                      {gameUser?.shipType === 'scout' && "Scout: Balanced performance"}
                      {!gameUser?.shipType && "Select a ship type"}
                    </p>
                  </div>
                </div>
              </div>

              {gameUser && (
                <div className="p-8 bg-slate-900/50 border border-white/5 rounded-[2rem] grid grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 text-white font-bold">
                      <UserIcon className="w-5 h-5 text-sky-400" />
                      {gameUser.displayName}
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-widest text-slate-500 font-bold">High Score</p>
                      <p className="text-4xl font-mono text-white">{gameUser.highScore}</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 text-white font-bold opacity-0">.</div>
                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-widest text-slate-500 font-bold">Total Dust</p>
                      <p className="text-4xl font-mono text-white">{gameUser.totalStardust}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-8">
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <Trophy className="w-6 h-6 text-yellow-500" />
                  <h2 className="text-xl font-bold text-white">Galactic Leaders</h2>
                </div>
                <div className="bg-slate-900/30 border border-white/5 rounded-3xl overflow-hidden">
                  {leaderboard.length > 0 ? (
                    leaderboard.map((entry, i) => (
                      <div 
                        key={entry.id}
                        className={`flex items-center justify-between p-4 border-b border-white/5 last:border-0 ${i === 0 ? 'bg-yellow-500/5' : ''}`}
                      >
                        <div className="flex items-center gap-4">
                          <span className={`w-6 text-sm font-bold ${i < 3 ? 'text-yellow-500' : 'text-slate-500'}`}>
                            {i + 1}
                          </span>
                          <span className="font-medium text-slate-200">{entry.displayName}</span>
                        </div>
                        <span className="font-mono font-bold text-white">{entry.score}</span>
                      </div>
                    ))
                  ) : (
                    <div className="p-8 text-center text-slate-500 italic">
                      No records found yet. Be the first!
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {gameState === 'missions' && (
          <motion.div 
            key="missions"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="max-w-2xl mx-auto px-6 py-12 lg:py-24 space-y-8"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-3xl font-bold text-white">Missions</h2>
              <button 
                onClick={() => setGameState('menu')}
                className="text-slate-400 hover:text-white transition-colors"
              >
                Back to Menu
              </button>
            </div>

            <div className="grid gap-4">
              {MISSIONS.map(mission => {
                const isCompleted = gameUser?.completedMissions?.includes(mission.id) || false;
                return (
                  <div 
                    key={mission.id}
                    className={`p-6 rounded-3xl border transition-all ${isCompleted ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-slate-900 border-white/5'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className={`font-bold ${isCompleted ? 'text-emerald-400' : 'text-white'}`}>{mission.title}</h3>
                      {isCompleted && <Star className="w-5 h-5 text-emerald-400 fill-emerald-400" />}
                    </div>
                    <p className="text-slate-400 text-sm">{mission.description}</p>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {gameState === 'playing' && (user || isGuest) && (
          <motion.div 
            key="playing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Game 
              user={user || { uid: 'guest', displayName: 'Guest' }} 
              shipColor={gameUser?.shipColor}
              shipType={gameUser?.shipType}
              unlockedSkills={gameUser?.unlockedSkills}
              onGameOver={handleGameOver} 
            />
          </motion.div>
        )}

        {gameState === 'results' && (
          <motion.div 
            key="results"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="min-h-screen flex items-center justify-center p-6"
          >
            <div className="bg-slate-900 border border-white/10 p-12 rounded-[2.5rem] max-w-md w-full text-center space-y-8 shadow-2xl shadow-sky-500/10">
              <div className="space-y-2">
                <h2 className="text-slate-400 uppercase tracking-[0.2em] font-bold text-sm">Mission Complete</h2>
                <p className="text-7xl font-black text-white tracking-tighter">{lastScore}</p>
                <p className="text-sky-400 font-bold">Stardust Collected</p>
              </div>

              {gameUser && lastScore > gameUser.highScore && (
                <div className="py-2 px-4 bg-yellow-500/10 border border-yellow-500/20 rounded-full inline-block">
                  <span className="text-yellow-500 font-bold text-sm">✨ NEW PERSONAL BEST! ✨</span>
                </div>
              )}

              <div className="grid gap-3">
                <button 
                  onClick={() => setGameState('playing')}
                  className="w-full py-4 bg-sky-500 hover:bg-sky-600 text-white font-bold rounded-2xl transition-all"
                >
                  New Mission
                </button>
                <button 
                  onClick={() => setGameState('menu')}
                  className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-2xl transition-all"
                >
                  Return to Base
                </button>
              </div>
            </div>
          </motion.div>
        )}
        {gameState === 'skills' && (
          <motion.div 
            key="skills"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="min-h-screen flex items-center justify-center p-6"
          >
            <div className="bg-slate-900 border border-white/10 p-8 rounded-[2.5rem] max-w-4xl w-full space-y-8">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-3xl font-black text-white tracking-tighter">Skill Tree</h2>
                  <p className="text-slate-500 text-sm">Enhance your ship with permanent upgrades</p>
                </div>
                <div className="bg-purple-500/10 border border-purple-500/20 px-6 py-3 rounded-2xl">
                  <p className="text-xs text-purple-400 font-bold uppercase tracking-widest">Skill Points</p>
                  <p className="text-3xl font-black text-white">{gameUser?.skillPoints || 0}</p>
                </div>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {SKILLS.map(skill => {
                  const isUnlocked = gameUser?.unlockedSkills?.includes(skill.id);
                  const canAfford = (gameUser?.skillPoints || 0) >= skill.cost;
                  
                  return (
                    <div 
                      key={skill.id}
                      className={`p-6 rounded-3xl border transition-all ${isUnlocked ? 'bg-purple-500/10 border-purple-500/50' : 'bg-slate-800/50 border-white/5'}`}
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isUnlocked ? 'bg-purple-500 text-white' : 'bg-slate-700 text-slate-400'}`}>
                          {skill.icon}
                        </div>
                        <div>
                          <h3 className="font-bold text-white">{skill.name}</h3>
                          <p className="text-xs text-purple-400 font-bold">{skill.cost} SP</p>
                        </div>
                      </div>
                      <p className="text-sm text-slate-400 mb-6 leading-relaxed">{skill.description}</p>
                      <button
                        onClick={() => buySkill(skill.id)}
                        disabled={isUnlocked || !canAfford}
                        className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${isUnlocked ? 'bg-emerald-500/20 text-emerald-400 cursor-default' : (canAfford ? 'bg-purple-500 hover:bg-purple-600 text-white' : 'bg-slate-700 text-slate-500 cursor-not-allowed')}`}
                      >
                        {isUnlocked ? 'UNLOCKED' : (canAfford ? 'UNLOCK' : 'NOT ENOUGH SP')}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-center pt-4">
                <button 
                  onClick={() => setGameState('menu')}
                  className="px-12 py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-2xl transition-all"
                >
                  Return to Base
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
