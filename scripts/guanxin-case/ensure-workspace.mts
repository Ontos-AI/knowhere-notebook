/**
 * Ensure the dedicated 观心 case workspace exists in the Notebook database.
 * Requires DATABASE_URL (Notebook Neon/Postgres), not the Knowhere eval DSN.
 *
 *   DATABASE_URL=... node --experimental-strip-types scripts/guanxin-case/ensure-workspace.mts
 */
import { workspaceService } from "../../src/domains/workspace/service.ts"
import { GUANXIN_CASE_USER_ID } from "./constants.ts"

const workspace = await workspaceService.ensureWorkspace(GUANXIN_CASE_USER_ID)
console.log(
  JSON.stringify(
    {
      userId: workspace.userId,
      workspaceId: workspace.id,
      namespace: workspace.namespace,
    },
    null,
    2,
  ),
)
