import React, { useEffect, useRef } from 'react';
import { SessionState, MoodTheme, MOOD_THEMES } from '../types';

interface AuraVisualizerProps {
  state: SessionState;
  userVolume: number;
  anushkaVolume: number;
  mood: MoodTheme;
}

export const AuraVisualizer: React.FC<AuraVisualizerProps> = ({
  state,
  userVolume,
  anushkaVolume,
  mood,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let time = 0;

    // Shockwaves stack
    const shockwaves: Array<{ r: number; maxR: number; alpha: number; color: string }> = [];

    // Floating 3D holographic dust particles
    const particles = Array.from({ length: 80 }, () => ({
      x: (Math.random() - 0.5) * 350,
      y: (Math.random() - 0.5) * 350,
      z: (Math.random() - 0.5) * 300,
      size: Math.random() * 2.5 + 1,
      speedX: (Math.random() - 0.5) * 0.8,
      speedY: (Math.random() - 0.5) * 0.8,
      speedZ: (Math.random() - 0.5) * 0.8,
      alpha: Math.random() * 0.8 + 0.2,
    }));

    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    let lastAudioPeak = 0;

    // Helper: Draw Capsule / Stadium Pill Path
    const drawCapsulePath = (
      context: CanvasRenderingContext2D,
      width: number,
      height: number
    ) => {
      const r = height / 2;
      const halfW = width / 2;
      context.beginPath();
      context.arc(-halfW + r, 0, r, Math.PI / 2, (Math.PI * 3) / 2);
      context.lineTo(halfW - r, -r);
      context.arc(halfW - r, 0, r, (Math.PI * 3) / 2, Math.PI / 2);
      context.lineTo(-halfW + r, r);
      context.closePath();
    };

    const render = () => {
      if (canvas.width <= 0 || canvas.height <= 0) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      time += 0.025;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      const theme = MOOD_THEMES[mood] || MOOD_THEMES.flirty_pink;
      const primaryColor = theme.primaryColor;
      const secondaryColor = theme.secondaryColor;

      // Active volume with smooth response
      let activeVolume = 0;
      if (state === 'speaking') {
        activeVolume = Math.max(anushkaVolume, 0.15);
      } else if (state === 'listening') {
        activeVolume = Math.max(userVolume, 0.1);
      } else if (state === 'connecting' || state === 'reconnecting') {
        activeVolume = 0.25 + Math.sin(time * 3.5) * 0.15;
      } else {
        activeVolume = 0.05 + Math.sin(time * 1.5) * 0.03;
      }

      // Shockwave trigger on audio peaks
      if (activeVolume - lastAudioPeak > 0.18 && activeVolume > 0.25) {
        shockwaves.push({
          r: Math.max(10, Math.min(canvas.width, canvas.height) * 0.12),
          maxR: Math.max(30, Math.min(canvas.width, canvas.height) * 0.45),
          alpha: 0.85,
          color: primaryColor,
        });
      }
      lastAudioPeak = activeVolume;

      const baseRadius = Math.max(10, Math.min(canvas.width, canvas.height) * 0.2);

      // Subtle Heartbeat Rhythm Calculation (Simulating living personality when session active)
      let heartbeatScale = 0;
      if (state !== 'disconnected') {
        // Double-beat (lub-dub) human pulse rhythm cycle at ~75 BPM
        const heartbeatCycle = (time * 1.25) % 1.0;
        if (heartbeatCycle < 0.12) {
          // Primary pulse (lub)
          heartbeatScale = Math.sin((heartbeatCycle / 0.12) * Math.PI) * 0.15;
        } else if (heartbeatCycle > 0.18 && heartbeatCycle < 0.32) {
          // Secondary pulse (dub)
          heartbeatScale = Math.sin(((heartbeatCycle - 0.18) / 0.14) * Math.PI) * 0.08;
        }
      }

      const dynamicScale = 1 + activeVolume * 0.6 + heartbeatScale * 0.4;

      // 1. Expanding Audio Shockwaves
      for (let i = shockwaves.length - 1; i >= 0; i--) {
        const sw = shockwaves[i];
        sw.r += 6 + activeVolume * 12;
        sw.alpha -= 0.02;

        if (sw.alpha <= 0 || sw.r >= sw.maxR) {
          shockwaves.splice(i, 1);
          continue;
        }

        ctx.strokeStyle = sw.color;
        ctx.lineWidth = 2.5;
        ctx.globalAlpha = sw.alpha;
        ctx.beginPath();
        ctx.arc(centerX, centerY, sw.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 2. Ambient Background Hologram Glow & Heartbeat Pulse
      ctx.globalAlpha = 1.0;
      const glowRadiusMultiplier = 2.8 + heartbeatScale * 1.2;
      const innerGlowRadius = Math.max(1, baseRadius * 0.05);
      const outerGlowRadius = Math.max(innerGlowRadius + 2, baseRadius * glowRadiusMultiplier);

      const ambientGlow = ctx.createRadialGradient(
        centerX,
        centerY,
        innerGlowRadius,
        centerX,
        centerY,
        outerGlowRadius
      );
      ambientGlow.addColorStop(0, primaryColor + Math.floor((0.35 + heartbeatScale * 0.35) * 255).toString(16).padStart(2, '0'));
      ambientGlow.addColorStop(0.5, secondaryColor + '22');
      ambientGlow.addColorStop(1, 'transparent');

      ctx.fillStyle = ambientGlow;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * (3.0 + heartbeatScale * 1.0), 0, Math.PI * 2);
      ctx.fill();

      // Subtle Living Heartbeat Aura Pulse Ring
      if (heartbeatScale > 0.01) {
        ctx.save();
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 1.5 + heartbeatScale * 3;
        ctx.globalAlpha = heartbeatScale * 0.8;
        ctx.shadowColor = primaryColor;
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius * (1.1 + heartbeatScale * 0.8), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 3. 3D HOLOGRAPHIC RINGS (Angled Perspective Orbitals)
      ctx.save();
      ctx.translate(centerX, centerY);

      // Ring 1: Top-Left Tilt 3D Ring
      ctx.save();
      ctx.rotate(time * 0.4);
      ctx.scale(1, 0.45); // Perspective flattening
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6;
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(0, 0, baseRadius * 1.55 * dynamicScale, 0, Math.PI * 2);
      ctx.stroke();

      // Holographic tick marks on Ring 1
      const ticks = 36;
      for (let t = 0; t < ticks; t++) {
        const angle = (t / ticks) * Math.PI * 2;
        const r1 = baseRadius * 1.55 * dynamicScale;
        const r2 = r1 + (t % 3 === 0 ? 12 : 6);
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * r1, Math.sin(angle) * r1);
        ctx.lineTo(Math.cos(angle) * r2, Math.sin(angle) * r2);
        ctx.stroke();
      }
      ctx.restore();

      // Ring 2: Reverse Counter-Clockwise Angled Ring
      ctx.save();
      ctx.rotate(-time * 0.6 + 0.8);
      ctx.scale(0.5, 1); // Reverse axis tilt
      ctx.strokeStyle = secondaryColor;
      ctx.setLineDash([8, 14]);
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.7;
      ctx.shadowColor = secondaryColor;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(0, 0, baseRadius * 1.75 * dynamicScale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Ring 3: Outer Precision HUD Gyroscope Ring
      ctx.save();
      ctx.rotate(time * 0.25);
      ctx.scale(1, 0.35);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(0, 0, baseRadius * 2.1 * dynamicScale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.restore(); // Restore center translation

      // 4. 360° RADIAL AUDIO WAVEFORM
      const numSpectrumBars = 120; // High density 360° circle
      const waveRadius = baseRadius * 1.25 * dynamicScale;
      ctx.save();
      ctx.translate(centerX, centerY);

      // Continuous 360° Filled Waveform Base Path
      ctx.beginPath();
      for (let i = 0; i <= numSpectrumBars; i++) {
        const angle = (i / numSpectrumBars) * Math.PI * 2;

        // Dynamic 360° Audio Frequency Wave calculation
        const freq1 = Math.sin(angle * 6 + time * 5) * 0.35;
        const freq2 = Math.cos(angle * 10 - time * 4) * 0.35;
        const freq3 = Math.sin(angle * 16 + time * 8) * 0.3;

        const waveHeight =
          state === 'speaking' || state === 'listening'
            ? Math.max(6, activeVolume * 85 * (0.4 + Math.abs(freq1 + freq2 + freq3)))
            : 4 + Math.sin(angle * 8 + time * 3) * 4;

        const r = waveRadius + waveHeight;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      // Outer 360° Glowing Wave Outline
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 15;
      ctx.globalAlpha = 0.85;
      ctx.stroke();

      // 360° Radial Equalizer Vector Bars
      for (let i = 0; i < numSpectrumBars; i++) {
        const angle = (i / numSpectrumBars) * Math.PI * 2;

        const freqVal =
          Math.sin(angle * 8 + time * 6) * 0.4 +
          Math.cos(angle * 14 - time * 3) * 0.4 +
          Math.sin(angle * 20 + time * 9) * 0.2;

        const barLength =
          state === 'speaking' || state === 'listening'
            ? Math.max(3, activeVolume * 70 * (0.3 + Math.abs(freqVal)))
            : 2 + Math.sin(angle * 6 + time * 2) * 3;

        const x1 = Math.cos(angle) * waveRadius;
        const y1 = Math.sin(angle) * waveRadius;
        const x2 = Math.cos(angle) * (waveRadius + barLength);
        const y2 = Math.sin(angle) * (waveRadius + barLength);

        const barGrad = ctx.createLinearGradient(x1, y1, x2, y2);
        barGrad.addColorStop(0, primaryColor);
        barGrad.addColorStop(1, secondaryColor);

        ctx.strokeStyle = barGrad;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.9;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      ctx.restore(); // Restore center

      // 5. TWO GIANT CAPSULES ROTATING IN OPPOSITE DIRECTIONS
      ctx.save();
      ctx.translate(centerX, centerY);

      const capsuleWidth = baseRadius * 1.7 * dynamicScale;
      const capsuleHeight = baseRadius * 0.75 * dynamicScale;

      // --- GIANT CAPSULE 1 (Clockwise Rotation & Neon Glow) ---
      ctx.save();
      ctx.rotate(time * 0.5); // Clockwise angle
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 30 + activeVolume * 40;

      // Gradient Fill for Capsule 1
      const capGrad1 = ctx.createLinearGradient(
        -capsuleWidth / 2,
        -capsuleHeight / 2,
        capsuleWidth / 2,
        capsuleHeight / 2
      );
      capGrad1.addColorStop(0, primaryColor + 'dd');
      capGrad1.addColorStop(0.5, secondaryColor + '88');
      capGrad1.addColorStop(1, primaryColor + 'ff');

      drawCapsulePath(ctx, capsuleWidth, capsuleHeight);
      ctx.fillStyle = capGrad1;
      ctx.globalAlpha = 0.75;
      ctx.fill();

      // Bright Glass Holographic Border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.9;
      ctx.stroke();

      // Specular Glint Highlight on Capsule 1
      ctx.save();
      ctx.clip();
      const glintGrad1 = ctx.createLinearGradient(
        -capsuleWidth / 2,
        -capsuleHeight / 2,
        0,
        0
      );
      glintGrad1.addColorStop(0, '#ffffffaa');
      glintGrad1.addColorStop(1, 'transparent');
      ctx.fillStyle = glintGrad1;
      ctx.fillRect(-capsuleWidth, -capsuleHeight, capsuleWidth * 2, capsuleHeight);
      ctx.restore();

      ctx.restore(); // End Capsule 1

      // --- GIANT CAPSULE 2 (Counter-Clockwise Opposite Rotation) ---
      ctx.save();
      ctx.rotate(-time * 0.65 + Math.PI / 2); // Opposite rotation direction!
      ctx.shadowColor = secondaryColor;
      ctx.shadowBlur = 35 + activeVolume * 45;

      const capsuleWidth2 = capsuleWidth * 1.1;
      const capsuleHeight2 = capsuleHeight * 0.9;

      const capGrad2 = ctx.createLinearGradient(
        capsuleWidth2 / 2,
        -capsuleHeight2 / 2,
        -capsuleWidth2 / 2,
        capsuleHeight2 / 2
      );
      capGrad2.addColorStop(0, secondaryColor + 'ee');
      capGrad2.addColorStop(0.5, primaryColor + '77');
      capGrad2.addColorStop(1, secondaryColor + 'ee');

      drawCapsulePath(ctx, capsuleWidth2, capsuleHeight2);
      ctx.fillStyle = capGrad2;
      ctx.globalAlpha = 0.7;
      ctx.fill();

      // Neon Holographic Stroke Capsule 2
      ctx.strokeStyle = secondaryColor;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.95;
      ctx.stroke();

      // Glass Glint Highlight Capsule 2
      ctx.save();
      ctx.clip();
      const glintGrad2 = ctx.createLinearGradient(
        0,
        -capsuleHeight2 / 2,
        capsuleWidth2 / 2,
        capsuleHeight2 / 2
      );
      glintGrad2.addColorStop(0, '#ffffff88');
      glintGrad2.addColorStop(1, 'transparent');
      ctx.fillStyle = glintGrad2;
      ctx.fillRect(-capsuleWidth2, -capsuleHeight2, capsuleWidth2 * 2, capsuleHeight2);
      ctx.restore();

      ctx.restore(); // End Capsule 2

      // Central Core Energy Node inside intersecting capsules
      ctx.save();
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 25 + activeVolume * 30;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(0, 0, (baseRadius * 0.22 + activeVolume * 15), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.restore(); // Restore Center Translation

      // 6. Floating 3D Holographic Dust Particles
      particles.forEach((p) => {
        p.x += p.speedX * (1 + activeVolume * 3);
        p.y += p.speedY * (1 + activeVolume * 3);
        p.z += p.speedZ * (1 + activeVolume * 2);

        // Simple 3D projection: scale by focal distance
        const perspective = 300 / (300 + p.z);
        const projectedX = centerX + p.x * perspective;
        const projectedY = centerY + p.y * perspective;
        const projectedSize = Math.max(0.5, p.size * perspective + activeVolume * 2);

        const maxDist = baseRadius * 2.8;
        if (p.x * p.x + p.y * p.y > maxDist * maxDist) {
          p.x = (Math.random() - 0.5) * baseRadius * 1.5;
          p.y = (Math.random() - 0.5) * baseRadius * 1.5;
          p.z = (Math.random() - 0.5) * 200;
        }

        ctx.fillStyle = Math.random() > 0.35 ? '#ffffff' : primaryColor;
        ctx.globalAlpha = p.alpha * perspective * (state === 'disconnected' ? 0.3 : 0.85);
        ctx.beginPath();
        ctx.arc(projectedX, projectedY, projectedSize, 0, Math.PI * 2);
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [state, userVolume, anushkaVolume, mood]);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden pointer-events-none">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
};
