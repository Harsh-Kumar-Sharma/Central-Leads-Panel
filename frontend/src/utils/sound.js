// Short, soft two-note chime generated with Web Audio (no audio file to load).
let ctx = null;

export function playChime() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    [[880, 0], [1318.5, 0.12]].forEach(([freq, offset]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.08, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.4);
    });
  } catch { /* audio not available: ignore */ }
}
