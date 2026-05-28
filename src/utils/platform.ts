export type Platform = 'windows' | 'macos' | 'linux';

export function detectPlatform(): Platform {
  switch (process.platform) {
    case 'win32': return 'windows';
    case 'darwin': return 'macos';
    default: return 'linux';
  }
}
