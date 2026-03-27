import Fastify from 'fastify';
import { mkdirSync } from 'node:fs';
import type { SessionManager } from './session-manager.js';

/**
 * Start a lightweight internal HTTP API on a separate port for the MCP Server process.
 * This API exposes SessionManager operations as REST endpoints.
 */
export async function startMcpApi(
  sessionManager: SessionManager,
  port: number,
): Promise<void> {
  const app = Fastify({ logger: false });

  // List all sessions
  app.get('/api/sessions', async () => {
    return sessionManager.listSessions();
  });

  // Discover unmanaged CLI sessions (must be before :id route)
  app.get<{ Querystring: { cwd?: string } }>(
    '/api/sessions/discover',
    async (request) => {
      const discovered = await sessionManager.discoverSessions(request.query.cwd);
      return discovered;
    },
  );

  // Get session info
  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const info = sessionManager.getSessionInfo(request.params.id);
    if (!info) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return info;
  });

  // Create session
  app.post<{
    Body: {
      adapter: string;
      cwd: string;
      name?: string;
      model?: string;
      initialPrompt?: string;
    };
  }>('/api/sessions', async (request, reply) => {
    const { adapter, cwd, name, model, initialPrompt } = request.body;
    try {
      // Auto-create directory if not exists
      mkdirSync(cwd, { recursive: true });

      const session = await sessionManager.createSession(
        adapter,
        { cwd, model },
        name,
      );

      // Send initial prompt if provided
      if (initialPrompt) {
        await sessionManager.sendMessage(session.id, initialPrompt);
      }

      return {
        id: session.id,
        adapterName: session.adapterName,
        displayName: session.displayName,
        status: session.status,
        cwd: session.cwd,
      };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Rename session
  app.patch<{
    Params: { id: string };
    Body: { displayName: string };
  }>('/api/sessions/:id', async (request, reply) => {
    const { displayName } = request.body;
    try {
      sessionManager.renameSession(request.params.id, displayName);
      return { ok: true };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Destroy session
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    try {
      await sessionManager.destroySession(request.params.id);
      return { ok: true };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Cleanup idle sessions
  app.post<{
    Body: { maxIdleMinutes?: number };
  }>('/api/sessions/cleanup', async (request) => {
    const maxIdleMinutes = request.body?.maxIdleMinutes ?? 60;
    const destroyed = await sessionManager.cleanupIdle(maxIdleMinutes);
    return { destroyed, count: destroyed.length };
  });

  // Import a CLI session
  app.post<{
    Body: {
      sessionId: string;
      adapterName: string;
      displayName?: string;
      cwd: string;
      jsonlPath?: string;
    };
  }>('/api/sessions/import', async (request) => {
    return sessionManager.importSession(request.body);
  });

  // Navigate web UI to a specific session
  app.post<{ Body: { sessionId: string } }>(
    '/api/sessions/navigate',
    async (request, reply) => {
      const { sessionId } = request.body;
      const info = sessionManager.getSessionInfo(sessionId);
      if (!info) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      sessionManager.broadcastNavigate(sessionId);
      return { ok: true, sessionId };
    },
  );

  await app.listen({ port, host: '127.0.0.1' });
  console.log(`MCP internal API running on http://127.0.0.1:${port}`);
}
