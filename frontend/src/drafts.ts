export type SavedPocketDraft = { id: string; updatedAt: number };

const draftIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function pocketDraftIndexKey(genesis: string, ownerPublicKey: string) {
  return `quotacell.drafts.v1:${genesis.toLowerCase()}:${ownerPublicKey.toLowerCase()}`;
}

export function listPocketDrafts(indexKey: string): SavedPocketDraft[] {
  try {
    const value = JSON.parse(localStorage.getItem(indexKey) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SavedPocketDraft => item && draftIdPattern.test(item.id) && Number.isFinite(item.updatedAt))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } catch { return []; }
}

export function touchPocketDraft(indexKey: string, id: string) {
  if (!draftIdPattern.test(id)) throw new Error('Invalid local Pocket draft identity.');
  const drafts = listPocketDrafts(indexKey).filter((draft) => draft.id !== id);
  drafts.unshift({ id, updatedAt: Date.now() });
  localStorage.setItem(indexKey, JSON.stringify(drafts.slice(0, 32)));
}

export function removePocketDraft(indexKey: string, id: string) {
  if (!draftIdPattern.test(id)) throw new Error('Invalid local Pocket draft identity.');
  const drafts = listPocketDrafts(indexKey).filter((draft) => draft.id !== id);
  localStorage.setItem(indexKey, JSON.stringify(drafts));
  localStorage.removeItem(`${indexKey}:draft:${id}`);
}

export function createPocketDraft(indexKey: string) {
  const id = crypto.randomUUID();
  touchPocketDraft(indexKey, id);
  return id;
}
