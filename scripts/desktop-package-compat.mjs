// The bundled NSIS 7z decoder predates the compressor's automatic ARM64 filter.
// BCJ is lossless for arbitrary bytes and is supported by that decoder. Keep the
// choice explicit in the build hook rather than altering a global machine setting.
export default function desktopPackageCompatibility(context, env = process.env) {
  if (context.electronPlatformName === 'win32') env.ELECTRON_BUILDER_7Z_FILTER = 'BCJ';
}
