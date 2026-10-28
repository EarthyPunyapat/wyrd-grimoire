import { expect, test } from "bun:test";
import { browserCommand } from "../src/browser.ts";

const url =
  "https://auth.openai.com/api/accounts/authorize?response_type=code&client_id=dynamic_agent_client&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback&scope=openid+profile+email&state=test-state&nonce=test-nonce&agent_name_hint=Wyrd+Grimoire";

test("Windows browser launch preserves the complete OAuth URL through PowerShell", () => {
  const command = browserCommand(url, "win32");
  expect(command[0]).toBe("powershell.exe");
  expect(command).toContain("-EncodedCommand");
  const script = Buffer.from(command.at(-1)!, "base64").toString("utf16le");
  // Exercise the actual Windows parser, replacing only the browser side effect.
  if (process.platform === "win32") {
    const capture = "function Start-Process { param([string]$FilePath) [Console]::Out.Write($FilePath) };\n";
    const result = Bun.spawnSync([
      ...command.slice(0, -1),
      Buffer.from(capture + script, "utf16le").toString("base64"),
    ]);
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toBe(url);
    expect(new URL(new TextDecoder().decode(result.stdout)).searchParams.get("client_id")).toBe(
      "dynamic_agent_client",
    );
  }
  expect(script).toContain("Start-Process -FilePath '");
});

test("Windows treats apostrophes and shell metacharacters as URL data", () => {
  const tricky = "https://example.test/?name=traveller's&next=$(throw 'bad');&percent=%25";
  const command = browserCommand(tricky, "win32");
  const script = Buffer.from(command.at(-1)!, "base64").toString("utf16le");
  expect(script).toContain("traveller''s");
  if (process.platform === "win32") {
    const capture = "function Start-Process { param([string]$FilePath) [Console]::Out.Write($FilePath) };\n";
    const result = Bun.spawnSync([
      ...command.slice(0, -1),
      Buffer.from(capture + script, "utf16le").toString("base64"),
    ]);
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toBe(tricky);
  }
});

test("macOS and Linux pass the full URL as a single argument", () => {
  expect(browserCommand(url, "darwin")).toEqual(["open", url]);
  expect(browserCommand(url, "linux")).toEqual(["xdg-open", url]);
});
