/**
 * A browser launch command that keeps the URL intact. `cmd /c start` splits OAuth query
 * parameters at ampersands, even when Bun receives the URL as one argument.
 */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") {
    // A literal PowerShell string prevents query parameters from becoming commands.
    // Encoding also avoids a second layer of command-line quoting on Windows.
    const script = `Start-Process -FilePath '${url.replace(/'/g, "''")}'`;
    return [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ];
  }
  return [platform === "darwin" ? "open" : "xdg-open", url];
}
