import { generatePersonaPlaybook } from '../persona-engine.js';

console.log('[Runner] Starting remote persona playbook generation...');
generatePersonaPlaybook({ provider: 'gemini', forceRefresh: true })
  .then(() => {
    console.log('[Runner] Persona generation tasks enqueued successfully!');
    process.exit(0);
  })
  .catch(err => {
    console.error('[Runner] Failed to trigger persona playbook generation:', err);
    process.exit(1);
  });
