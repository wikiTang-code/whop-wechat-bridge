console.log('Diagnostic starting...');
try {
  await import('../server.js');
  console.log('Diagnostic imported successfully!');
} catch (e) {
  console.error('DIAGNOSTIC ERROR:', e);
}
