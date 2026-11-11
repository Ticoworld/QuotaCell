import type { PocketMetadata } from './domain';

type ExportFile = { format: 'quotacell-participants'; version: 1; genesis: string; pocket: string; participants: PocketMetadata };

function storageKey(genesis: string, pocket: string) {
  return `quotacell:participants:v1:${genesis}:${pocket}`;
}

export function loadMetadata(genesis: string, pocket: string): PocketMetadata {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(genesis, pocket)) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, item]) => /^0x0[23][0-9a-f]{64}$/i.test(key) && item && typeof item === 'object' && typeof item.name === 'string').map(([key, item]) => [key, {
      name: String((item as { name: string }).name).slice(0, 32),
      description: typeof (item as { description?: unknown }).description === 'string' ? String((item as { description: string }).description).slice(0, 72) : undefined,
    }]));
  } catch { return {}; }
}

export function saveMetadata(genesis: string, pocket: string, value: PocketMetadata) {
  localStorage.setItem(storageKey(genesis, pocket), JSON.stringify(value));
}

export function exportMetadata(genesis: string, pocket: string, participants: PocketMetadata) {
  return JSON.stringify({ format: 'quotacell-participants', version: 1, genesis, pocket, participants } satisfies ExportFile, null, 2);
}

export function importMetadata(text: string, genesis: string, pocket: string, validKeys: string[]): PocketMetadata {
  const file = JSON.parse(text) as Partial<ExportFile>;
  if (file.format !== 'quotacell-participants' || file.version !== 1 || file.genesis !== genesis || file.pocket !== pocket || !file.participants || typeof file.participants !== 'object') {
    throw new Error('This participant file belongs to a different Pocket or network.');
  }
  const allowed = new Set(validKeys.map((key) => key.toLowerCase()));
  return Object.fromEntries(Object.entries(file.participants).filter(([key, item]) => allowed.has(key.toLowerCase()) && /^0x0[23][0-9a-f]{64}$/i.test(key) && item && typeof item.name === 'string').map(([key, item]) => [key, { name: item.name.slice(0, 32), description: item.description?.slice(0, 72) }]));
}
