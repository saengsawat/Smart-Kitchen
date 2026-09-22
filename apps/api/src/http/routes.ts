/**
 * Route registrations (M2-T1).
 *
 * Every route here declares its authorization in the same object that declares
 * its method and path, which is the point: the declaration is impossible to
 * miss when reading the route and impossible to omit when writing it (the
 * `onRoute` guard in `authorization.ts` refuses the registration).
 *
 * Handlers never see the pool. They are handed the caller's session and a
 * {@link TenantSessionRunner}, so the only SQL they can issue is SQL inside a
 * transaction already scoped to that caller's household.
 */

import { INVENTORY_ITEMS_PATH, type InventoryItemsResponseDto } from "@smart-kitchen/contracts";
import type { FastifyInstance } from "fastify";
import { householdRoute, publicRoute, requireSession } from "./authorization.js";
import { readInventorySnapshot } from "./inventory-snapshot.js";
import type { TenantSessionRunner } from "./tenant-session.js";

export interface RouteDeps {
  readonly tenantSession: TenantSessionRunner;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    "/healthz",
    {
      config: {
        authorization: publicRoute(
          "liveness probe: answers with a fixed literal and reads nothing, so there is no " +
            "household state for a session to scope",
        ),
      },
    },
    () => ({ status: "ok" }),
  );

  app.get(
    INVENTORY_ITEMS_PATH,
    { config: { authorization: householdRoute() } },
    async (request): Promise<InventoryItemsResponseDto> => {
      const session = requireSession(request);
      const items = await deps.tenantSession(session, (client) =>
        readInventorySnapshot(client, session.householdId),
      );
      return { items };
    },
  );
}
