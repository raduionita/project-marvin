import { readdirSync } from 'fs';

export function tryJsonParse<T>(str: string): T {
  try {
    return JSON.parse(str) as T;
  } catch (error) {
    console.warn('[tryJsonParse]', `"${str}"`, error);
    return {} as T;
  }
}

export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function rand(min:number, max:number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getRootDir() {
  return import.meta.dirname.replace(/\/src.*/, '')
}

// #endregion
