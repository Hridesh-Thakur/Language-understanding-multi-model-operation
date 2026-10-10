import React, { useEffect, useState } from 'react';

interface ParticleEffectsProps {
  effectName: string | null;
  onFinished: () => void;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  symbol: string;
  speedY: number;
  speedX: number;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
}

export const ParticleEffects: React.FC<ParticleEffectsProps> = ({ effectName, onFinished }) => {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (!effectName) return;

    let symbol = '💖';
    if (effectName === 'sparkles') symbol = '✨';
    if (effectName === 'fireworks') symbol = '🎆';
    if (effectName === 'lightning') symbol = '⚡';

    const count = 35;
    const newParticles: Particle[] = Array.from({ length: count }, (_, i) => ({
      id: i,
      x: Math.random() * window.innerWidth,
      y: window.innerHeight + Math.random() * 50,
      size: Math.random() * 24 + 16,
      symbol: Math.random() > 0.3 ? symbol : '💕',
      speedY: Math.random() * -4 - 3,
      speedX: (Math.random() - 0.5) * 3,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 4,
      opacity: 1,
    }));

    setParticles(newParticles);

    const timer = setTimeout(() => {
      setParticles([]);
      onFinished();
    }, 3500);

    return () => clearTimeout(timer);
  }, [effectName, onFinished]);

  if (particles.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute transition-transform duration-100 ease-linear animate-float-up"
          style={{
            left: `${p.x}px`,
            bottom: `${window.innerHeight - p.y}px`,
            fontSize: `${p.size}px`,
            opacity: p.opacity,
            transform: `rotate(${p.rotation}deg)`,
          }}
        >
          {p.symbol}
        </div>
      ))}
    </div>
  );
};
