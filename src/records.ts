// Keys originating from profiles or telemetry must never resolve a prototype.
export function own<T>(values: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(values, key) ? values[key] : undefined;
}

export function dictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
