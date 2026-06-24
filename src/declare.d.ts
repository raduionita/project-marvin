declare module 'bun:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function test(fn: () => void | Promise<void>): void;
  export function test(name: string, options: unknown, fn: () => void | Promise<void>): void;

  interface BasicMatchers<T> {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
    toBeCloseTo(expected: number, tolerance?: number): void;
    toMatch(pattern: RegExp | string): void;
    toThrow(expected?: string | RegExp): void;
    toBeInstanceOf(expected: Function): void;
    toBeUndefined(): void;
    toBeNull(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
  }

  interface ArrayMatchers<T> extends BasicMatchers<T> {
    toContain(expected: T[number]): void;
    toContain(expected: T): void;
  }

  interface Negated<T> {
    not: BasicMatchers<T>;
  }

  interface ArrayNegated<T> {
    not: ArrayMatchers<T>;
  }

  type ExpectResult<T> = T & BasicMatchers<T> & (T extends any[] ? ArrayMatchers<T> & ArrayNegated<T> : Negated<T>);

  export function expect<T>(value: T[]): ExpectResult<T[]>;
  export function expect<T>(value: T): ExpectResult<T>;
}
