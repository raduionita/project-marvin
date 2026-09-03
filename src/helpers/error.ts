
// read error message + fist line
export function readError(error: unknown): string {
  if (error instanceof Error) {
    const lines = error.stack?.split('\n');
    if (lines && lines.length > 0) {
      return error.message + ' ' + (lines[0] || 'N/A');
    }
    return error.message;
  }
  return error?.toString() || 'N/A';
}
