export async function execClient() {
  console.log('[marvin] Starting Client...');

  // Process handlers for client
  process.on('SIGINT', () => {
    console.log('[marvin] Client interrupted. Terminating...');
    process.exit(0);
  });

  // Placeholder for interaction logic
  console.log('[marvin] Client is running. Press Ctrl+C to exit.');

  // Keep the client alive for demonstration
  return new Promise((resolve) => {
    setTimeout(() => {
      console.log('[marvin] Finished.');
      resolve(null);
    }, 1000);
  });
}
