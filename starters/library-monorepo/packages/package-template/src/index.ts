export type Item = Readonly<{ id: string; label: string }>
export const createItem = (id: string, label: string): Item => ({ id, label })
