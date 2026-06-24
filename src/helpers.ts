import { readdirSync } from 'fs';

export function tryJsonParse(str: string): any {
  try {
    return JSON.parse(str);
  } catch (error) {
    console.warn('[marvin]', 'tryJsonParse', error);
    return {};
  }
}

export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function rand(min:number, max:number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// #endregion
