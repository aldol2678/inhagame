export class WaveformView {
  constructor(canvas) {
    this.canvas = canvas;
    this.buffer = null;
    this.loop = { enabled: false, startSeconds: 0, endSeconds: 0 };
    this.currentTime = 0;
    this.onSeek = null;
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener("pointerdown", event => {
      if (!this.buffer || typeof this.onSeek !== "function") return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
      this.onSeek(ratio * this.buffer.duration);
    });
  }

  setBuffer(buffer) {
    this.buffer = buffer || null;
    this.currentTime = 0;
    if (buffer && (!this.loop.endSeconds || this.loop.endSeconds > buffer.duration)) {
      this.loop = { enabled: false, startSeconds: 0, endSeconds: buffer.duration };
    }
    this.draw();
  }

  setLoop(loop) {
    this.loop = { ...this.loop, ...loop };
    this.draw();
  }

  setCurrentTime(seconds) {
    this.currentTime = Math.max(0, Number(seconds) || 0);
    this.draw();
  }

  draw() {
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0a1117";
    ctx.fillRect(0, 0, width, height);

    if (!this.buffer) {
      ctx.fillStyle = "#617684";
      ctx.font = `${12 * dpr}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText("음원을 선택하면 waveform이 표시됩니다.", width / 2, height / 2);
      return;
    }

    const data = this.buffer.getChannelData(0);
    const columns = Math.max(64, Math.floor(width / Math.max(1, 2 * dpr)));
    const step = Math.max(1, Math.floor(data.length / columns));
    ctx.strokeStyle = "#72c5e8";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    for (let x = 0; x < columns; x += 1) {
      const start = x * step;
      const end = Math.min(data.length, start + step);
      let peak = 0;
      for (let i = start; i < end; i += 1) peak = Math.max(peak, Math.abs(data[i]));
      const px = x / Math.max(1, columns - 1) * width;
      const amp = peak * height * 0.44;
      ctx.moveTo(px, height / 2 - amp);
      ctx.lineTo(px, height / 2 + amp);
    }
    ctx.stroke();

    const duration = Math.max(0.001, this.buffer.duration);
    if (this.loop.enabled && this.loop.endSeconds > this.loop.startSeconds) {
      const x1 = this.loop.startSeconds / duration * width;
      const x2 = this.loop.endSeconds / duration * width;
      ctx.fillStyle = "rgba(239, 184, 111, .12)";
      ctx.fillRect(x1, 0, x2 - x1, height);
      ctx.strokeStyle = "#efb86f";
      ctx.lineWidth = Math.max(1, dpr);
      for (const x of [x1, x2]) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
    }

    const playX = Math.min(width, this.currentTime / duration * width);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath(); ctx.moveTo(playX, 0); ctx.lineTo(playX, height); ctx.stroke();
  }

  destroy() {
    this.resizeObserver.disconnect();
  }
}
