/**
 * Audio processing utilities for PCM16 audio streaming with Gemini Live API
 */

// Converts Float32 audio samples (from AudioContext input) to PCM16 Int16Array
export function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

// Converts Int16Array PCM data to Base64 string for WebSocket transmission
export function pcm16ToBase64(int16Array: Int16Array): string {
  const bytes = new Uint8Array(int16Array.buffer, int16Array.byteOffset, int16Array.byteLength);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Converts Base64 string from Gemini Live (24kHz PCM16) to Float32Array for Web Audio API playback
export function base64ToPCM24kFloat32(base64: string): Float32Array {
  try {
    if (!base64) return new Float32Array(0);
    const binary = atob(base64);
    const len = binary.length;
    const evenLen = len - (len % 2); // Ensure length is even for 16-bit PCM
    if (evenLen <= 0) return new Float32Array(0);

    const bytes = new Uint8Array(evenLen);
    for (let i = 0; i < evenLen; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const dataView = new DataView(bytes.buffer);
    const sampleCount = evenLen / 2;
    const float32Array = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const int16 = dataView.getInt16(i * 2, true); // Little-endian PCM
      float32Array[i] = int16 / (int16 < 0 ? 0x8000 : 0x7fff);
    }
    return float32Array;
  } catch (err) {
    console.warn('[pcmUtils] Failed to decode PCM base64 chunk:', err);
    return new Float32Array(0);
  }
}

// Calculates RMS volume level (0.0 to 1.0) from Float32 PCM buffer
export function calculateRmsVolume(buffer: Float32Array): number {
  if (!buffer || buffer.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(sum / buffer.length);
  // Scale & amplify slightly for visual clarity
  return Math.min(1.0, rms * 4.0);
}
