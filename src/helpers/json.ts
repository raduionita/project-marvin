import logger from '../logger.js';
import { readError } from './error.js';

export function tryJsonParse<T>(str: string): T {
  try {
    return JSON.parse(str) as T;
  } catch (error) {
    logger.warn('[tryJsonParse]', `"${str.slice(0,1024)}"`, readError(error));
    return null as T;
  }
}

export function fixJson(str: string): string {
  return str.replaceAll('\\n', '\n');
}
