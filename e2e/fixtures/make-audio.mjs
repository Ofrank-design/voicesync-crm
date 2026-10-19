// Generates a 4 second 440Hz mono WAV used as Chromium's fake microphone input.
import { writeFileSync } from "node:fs";
const rate = 16000, secs = 4, n = rate * secs, data = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
const h = Buffer.alloc(44);
h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16);
h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
h.write("data", 36); h.writeUInt32LE(data.length, 40);
writeFileSync(new URL("./voice-note.wav", import.meta.url), Buffer.concat([h, data]));
console.log("wrote fixtures/voice-note.wav");
