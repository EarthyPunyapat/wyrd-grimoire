import { expect, test } from "bun:test";
import { z } from "zod";
import { FakeProvider } from "../src/fake.ts";
import { RoleRouter } from "../src/router.ts";
import { proposeStructured } from "../src/structured.ts";
import { ProviderError } from "../src/types.ts";

const schema = z.object({ name: z.string().min(1) });

function setup(rules: ConstructorParameters<typeof FakeProvider>[0]) {
  const fake = new FakeProvider(rules);
  const router = new RoleRouter({
    providers: { fake },
    routing: { worldGen: { provider: "fake", model: "test", fallbacks: [] } },
  });
  return { fake, router };
}

const spec = (overrides: Partial<Parameters<typeof proposeStructured>[1]> = {}) => ({
  role: "worldGen" as const,
  tool: "propose_thing",
  schema,
  instructions: "Propose one thing.",
  input: '{"pitch":"a lantern"}',
  promptVersion: "thing@1",
  ...overrides,
});

test("returns the first valid call", async () => {
  const { fake, router } = setup([
    { role: "worldGen", reply: { toolCall: { name: "propose_thing", args: { name: "x" } } } },
  ]);
  const result = await proposeStructured(router, spec());
  expect(result).toEqual({ name: "x" });
  expect(fake.calls("worldGen").length).toBe(1);
});

test("repairs a bad call with the validation error", async () => {
  const { fake, router } = setup([
    { role: "worldGen", reply: { toolCall: { name: "propose_thing", args: { name: "" } } }, times: 1 },
    { role: "worldGen", reply: { toolCall: { name: "propose_thing", args: { name: "good" } } }, times: 1 },
  ]);
  const result = await proposeStructured(router, spec());
  expect(result).toEqual({ name: "good" });
  const second = fake.calls("worldGen")[1]!;
  const last = second.messages.at(-1)!;
  expect(last.role).toBe("tool");
  expect(last.content).toContain("rejected");
  expect(last.content).toContain("name");
});

test("repairs after a provider invalid_output", async () => {
  const { fake, router } = setup([
    { role: "worldGen", reply: { error: { code: "invalid_output", retryable: true } }, times: 1 },
    { role: "worldGen", reply: { toolCall: { name: "propose_thing", args: { name: "after" } } } },
  ]);
  const result = await proposeStructured(router, spec());
  expect(result).toEqual({ name: "after" });
  expect(fake.calls("worldGen").length).toBe(2);
});

test("gives up after the configured repairs", async () => {
  const { fake, router } = setup([
    { role: "worldGen", reply: { toolCall: { name: "propose_thing", args: { name: "" } } } },
  ]);
  const error = await proposeStructured(router, spec({ repairs: 2 })).catch((e) => e);
  expect(error).toBeInstanceOf(ProviderError);
  expect((error as ProviderError).code).toBe("invalid_output");
  expect((error as ProviderError).retryable).toBe(false);
  expect(fake.calls("worldGen").length).toBe(3);
});

test("rethrows non-output errors", async () => {
  const { fake, router } = setup([{ role: "worldGen", reply: { error: { code: "auth" } } }]);
  const error = await proposeStructured(router, spec({ repairs: 2 })).catch((e) => e);
  expect((error as ProviderError).code).toBe("auth");
  expect(fake.calls("worldGen").length).toBe(1);
});
