export async function api<T>(
  path: string,
  parse: (data: unknown) => T,
  body?: unknown,
  method: "POST" | "PUT" | "PATCH" = "POST",
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          method,
          headers: { "Content-Type": "application/json", "X-Wyrd": "1" },
          body: JSON.stringify(body),
        }),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("wyrd:locked"));
    const message =
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : "Could not reach the grimoire";
    throw new Error(message);
  }
  return parse(data);
}
