import { Hono } from 'hono';

export const app = new Hono();

app.get('/health', (context) => {
  return context.json({ status: 'ok' });
});
