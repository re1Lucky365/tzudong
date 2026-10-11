export function reviewIntentStorage(): Storage {
    const items = new Map<string, string>();
    return { get length() { return items.size; }, key: index => [...items.keys()][index] ?? null,
        getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); },
        removeItem: key => { items.delete(key); }, clear: () => items.clear() };
}
