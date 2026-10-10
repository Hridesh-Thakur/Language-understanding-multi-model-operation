import { float32ToInt16, pcm16ToBase64, base64ToPCM24kFloat32, calculateRmsVolume } from './pcmUtils';

/**
 * Manages Microphone Audio Input capture (16kHz PCM16)
 */
export class AudioInputManager {
  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private isMuted: boolean = false;
  private onAudioChunk: ((base64Pcm: string) => void) | null = null;
  private onVolumeChange: ((volume: number) => void) | null = null;

  constructor(
    onAudioChunk: (base64Pcm: string) => void,
    onVolumeChange?: (volume: number) => void
  ) {
    this.onAudioChunk = onAudioChunk;
    this.onVolumeChange = onVolumeChange || null;
  }

  public async start(): Promise<void> {
    if (this.audioCtx) {
      await this.stop();
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });

      // Initialize AudioContext at 16000Hz for Gemini Live input
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass({ sampleRate: 16000 });

      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);
      // Process in 2048-sample buffer chunks (~128ms at 16kHz for ultra-fast response)
      this.processorNode = this.audioCtx.createScriptProcessor(2048, 1, 1);

      this.processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!this.audioCtx || this.isMuted) {
          if (this.onVolumeChange) this.onVolumeChange(0);
          return;
        }

        const inputBuffer = e.inputBuffer.getChannelData(0);
        const vol = calculateRmsVolume(inputBuffer);
        if (this.onVolumeChange) {
          this.onVolumeChange(vol);
        }

        const int16Pcm = float32ToInt16(inputBuffer);
        const base64 = pcm16ToBase64(int16Pcm);
        if (this.onAudioChunk) {
          this.onAudioChunk(base64);
        }
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioCtx.destination);
    } catch (err) {
      console.error('Failed to access microphone input:', err);
      throw err;
    }
  }

  public setMute(muted: boolean): void {
    this.isMuted = muted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public async stop(): Promise<void> {
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch (_) {}
      this.audioCtx = null;
    }

    if (this.onVolumeChange) {
      this.onVolumeChange(0);
    }
  }
}

/**
 * Manages Model Audio Output Playback (24kHz Web Audio API) with gapless queue
 */
export class AudioOutputManager {
  private audioCtx: AudioContext | null = null;
  private nextStartTime: number = 0;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private onVolumeChange: ((volume: number) => void) | null = null;
  private onSpeakingStateChange: ((isSpeaking: boolean) => void) | null = null;
  private checkSpeakingInterval: number | null = null;

  constructor(
    onVolumeChange?: (volume: number) => void,
    onSpeakingStateChange?: (isSpeaking: boolean) => void
  ) {
    this.onVolumeChange = onVolumeChange || null;
    this.onSpeakingStateChange = onSpeakingStateChange || null;
  }

  private ensureAudioContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass({ sampleRate: 24000 });
      this.nextStartTime = 0;
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  public playAudioChunk(base64Pcm: string): void {
    const ctx = this.ensureAudioContext();
    const float32Data = base64ToPCM24kFloat32(base64Pcm);

    if (float32Data.length === 0) return;

    // Report volume for visualizer
    const vol = calculateRmsVolume(float32Data);
    if (this.onVolumeChange) {
      this.onVolumeChange(vol);
    }

    const buffer = ctx.createBuffer(1, float32Data.length, 24000);
    buffer.getChannelData(0).set(float32Data);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const currentTime = ctx.currentTime;
    const startTime = Math.max(currentTime, this.nextStartTime);
    source.start(startTime);
    this.nextStartTime = startTime + buffer.duration;

    this.activeSources.add(source);
    if (this.onSpeakingStateChange) {
      this.onSpeakingStateChange(true);
    }

    source.onended = () => {
      this.activeSources.delete(source);
      if (this.activeSources.size === 0) {
        this.nextStartTime = 0;
        if (this.onSpeakingStateChange) {
          this.onSpeakingStateChange(false);
        }
        if (this.onVolumeChange) {
          this.onVolumeChange(0);
        }
      }
    };
  }

  // Instantly stops all queued audio (for user interruptions)
  public stopAll(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch (_) {}
    }
    this.activeSources.clear();
    this.nextStartTime = 0;

    if (this.onSpeakingStateChange) {
      this.onSpeakingStateChange(false);
    }
    if (this.onVolumeChange) {
      this.onVolumeChange(0);
    }
  }

  public close(): void {
    this.stopAll();
    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch (_) {}
      this.audioCtx = null;
    }
  }
}
