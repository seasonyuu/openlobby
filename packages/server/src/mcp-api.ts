import Fastify from 'fastify';
import { mkdirSync } from 'node:fs';
import type { SessionManager } from './session-manager.js';
import type { ChannelRouterImpl } from './channel-router.js';

export interface McpApiHandle {
  setChannelRouter(router: ChannelRouterImpl): void;
}

/**
 * Start a lightweight internal HTTP API on a separate port for the MCP Server process.
 * This API exposes SessionManager operations as REST endpoints.
 */
export async function startMcpApi(
  sessionManager: SessionManager,
  port: number,
): Promise<McpApiHandle> {
  const app = Fastify({ logger: false });

  // Channel router is injected after construction (initialization order)
  let channelRouter: ChannelRouterImpl | null = null;

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

  // ─── Channel Provider Endpoints ────────────────────────────────────

  // List all channel providers
  app.get('/api/channels/providers', async (_request, reply) => {
    if (!channelRouter) {
      return reply.status(503).send({ error: 'Channel router not initialized' });
    }
    return channelRouter.listProviders();
  });

  // Add a channel provider
  app.post<{
    Body: {
      channelName: string;
      accountId: string;
      credentials: Record<string, string>;
      webhook?: { path: string; secret?: string };
      enabled?: boolean;
    };
  }>('/api/channels/providers', async (request, reply) => {
    if (!channelRouter) {
      return reply.status(503).send({ error: 'Channel router not initialized' });
    }
    try {
      await channelRouter.addProviderConfig(request.body);
      return { ok: true, providers: channelRouter.listProviders() };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Remove a channel provider
  app.delete<{ Params: { id: string } }>(
    '/api/channels/providers/:id',
    async (request, reply) => {
      if (!channelRouter) {
        return reply.status(503).send({ error: 'Channel router not initialized' });
      }
      try {
        await channelRouter.removeProviderConfig(decodeURIComponent(request.params.id));
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // Toggle (enable/disable) a channel provider
  app.patch<{
    Params: { id: string };
    Body: { enabled: boolean };
  }>('/api/channels/providers/:id', async (request, reply) => {
    if (!channelRouter) {
      return reply.status(503).send({ error: 'Channel router not initialized' });
    }
    try {
      await channelRouter.toggleProviderConfig(
        decodeURIComponent(request.params.id),
        request.body.enabled,
      );
      return { ok: true };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ─── Channel Binding Endpoints ─────────────────────────────────────

  // List all channel bindings
  app.get('/api/channels/bindings', async (_request, reply) => {
    if (!channelRouter) {
      return reply.status(503).send({ error: 'Channel router not initialized' });
    }
    return channelRouter.listBindings();
  });

  // Bind an IM user to a session
  app.post<{
    Body: { identityKey: string; sessionId: string };
  }>('/api/channels/bindings', async (request, reply) => {
    if (!channelRouter) {
      return reply.status(503).send({ error: 'Channel router not initialized' });
    }
    const { identityKey, sessionId } = request.body;
    const result = channelRouter.bindSession(identityKey, sessionId);
    if (!result.ok) {
      return reply.status(400).send({ error: result.error });
    }
    return { ok: true, bindings: channelRouter.listBindings() };
  });

  // Unbind an IM user
  app.delete<{ Params: { key: string } }>(
    '/api/channels/bindings/:key',
    async (request, reply) => {
      if (!channelRouter) {
        return reply.status(503).send({ error: 'Channel router not initialized' });
      }
      try {
        channelRouter.unbindSession(decodeURIComponent(request.params.key));
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  await app.listen({ port, host: '127.0.0.1' });
  console.log(`MCP internal API running on http://127.0.0.1:${port}`);

  return {
    setChannelRouter(router: ChannelRouterImpl) {
      channelRouter = router;
    },
  };
}
