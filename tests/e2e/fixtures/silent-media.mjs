// Deterministic 8kHz mono16-bit PCM; no recording, dependency or external media.
export function silentWav(seconds=30){
  const sampleRate=8000,dataSize=sampleRate*seconds*2,buffer=Buffer.alloc(44+dataSize);
  buffer.write('RIFF',0);buffer.writeUInt32LE(36+dataSize,4);buffer.write('WAVE',8);buffer.write('fmt ',12);
  buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);
  buffer.writeUInt32LE(sampleRate,24);buffer.writeUInt32LE(sampleRate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);
  buffer.write('data',36);buffer.writeUInt32LE(dataSize,40);return buffer;
}
