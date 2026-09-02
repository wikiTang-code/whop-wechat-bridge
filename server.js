import express from 'express';
import https from 'https';
import { spawn, exec, execSync } from 'child_process';

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.stack || err);
  setTimeout(() => process.exit(1), 1000);
});
