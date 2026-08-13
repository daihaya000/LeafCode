export function isWindowsPeExecutable(
  filePath: string,
  io?: {
    existsSync?: (path: string) => boolean;
    readHeader?: (path: string) => Uint8Array;
  },
): boolean;

export function npmOpencodeSiblingExe(shimPath: string): string;

export function wingetLinkPath(
  name: string,
  localAppData: string | undefined,
): string | null;

export function pickOpencodePath(
  whereLines: string[],
  opts?: {
    localAppData?: string;
    existsSync?: (path: string) => boolean;
    isPe?: (path: string) => boolean;
  },
): string | null;
