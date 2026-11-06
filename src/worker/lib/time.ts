export const nowIso = () => new Date().toISOString();
export const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);
export const addDays = (date: Date, days: number) => addMinutes(date, days * 24 * 60);
