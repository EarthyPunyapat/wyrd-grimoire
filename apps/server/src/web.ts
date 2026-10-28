import { join } from "node:path";
import type { MiddlewareHandler } from "hono";
import { serveStatic } from "hono/bun";
import type { SecureHeadersVariables } from "hono/secure-headers";
export const webAssets = (root: string): MiddlewareHandler<{ Variables: SecureHeadersVariables }> => {
  const assets = serveStatic({ root });
  return async (c, next) => {
    if (c.req.path === "/" || c.req.path === "/index.html") {
      const html = await Bun.file(join(root, "index.html")).text();
      c.header("Cache-Control", "no-store");
      return c.html(
        html.replace(
          "<head>",
          `<head><meta name="wyrd-style-nonce" content="${c.get("secureHeadersNonce") ?? ""}">`,
        ),
      );
    }
    return assets(c, next);
  };
};
