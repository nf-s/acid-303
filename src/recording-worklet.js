class RecordingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(Math.ceil(sampleRate * 10));
    this.frames = 0;
    this.finished = false;
    this.lastProgress = 0;
    this.port.onmessage = (event) => {
      if (event.data === "stop") this.finish();
    };
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    const samples = this.samples.slice(0, this.frames);
    this.port.postMessage({ type: "complete", samples, sampleRate }, [
      samples.buffer,
    ]);
  }
  process(inputs) {
    if (this.finished) return false;
    const channels = inputs[0];
    const frames = channels?.[0]?.length ?? 0;
    for (
      let frame = 0;
      frame < frames && this.frames < this.samples.length;
      frame++
    ) {
      let value = 0;
      for (const channel of channels) value += channel[frame] ?? 0;
      this.samples[this.frames++] = value / channels.length;
    }
    if (this.frames - this.lastProgress >= sampleRate / 10) {
      this.lastProgress = this.frames;
      this.port.postMessage({
        type: "progress",
        seconds: this.frames / sampleRate,
      });
    }
    if (this.frames >= this.samples.length) this.finish();
    return !this.finished;
  }
}
registerProcessor("grain-recording", RecordingProcessor);
