import { DelegateArgs } from "@wyrd/core";
import { assignTask } from "@wyrd/engine";
import { registerGmTool } from "../registry.ts";

registerGmTool({
  name: "delegate",
  description:
    "Assign a goal to an active companion, using their actor ID as assignee. Due is an absolute future game minute. Specify opposition level/actor, skill, owned abilityId or a cited exploit when relevant. Reassign a blocked task using taskId and a revised plan. The engine resolves it when time advances.",
  schema: DelegateArgs,
  run: (a, x) => {
    const id = a.taskId ?? x.newId();
    const result = assignTask(x.state, { ...a, id }, x.ctx);
    return result.ok
      ? { ok: true, body: { taskId: id, status: "active" }, effects: { drafts: result.value } }
      : { ok: false, body: { errors: result.errors } };
  },
});
