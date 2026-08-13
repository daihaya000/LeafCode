export function stripJsonc(text: string): string;

export function readJsonc(path: string): Record<string, unknown>;

export function writeJsonc(path: string, value: Record<string, unknown>): void;
