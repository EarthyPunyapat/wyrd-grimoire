import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MediaSettingsPanel } from "../src/MediaSettings.tsx";
import { MediaContext, Portrait } from "../src/Portrait.tsx";

const media = { portraits: { "npc:bat": "/api/media/abc" }, banners: { "loc:alley": "/api/media/def" } };

test("a portrait is the image with its name as alt text, or a placeholder initial", () => {
  const withImage = renderToStaticMarkup(
    <MediaContext.Provider value={media}>
      <Portrait id="npc:bat" name="Batman" kind="npc" />
    </MediaContext.Provider>,
  );
  expect(withImage).toContain('src="/api/media/abc"');
  expect(withImage).toContain('alt="Batman"');
  const placeholder = renderToStaticMarkup(
    <MediaContext.Provider value={media}>
      <Portrait id="npc:magda" name="the Old Magda" kind="npc" />
    </MediaContext.Provider>,
  );
  expect(placeholder).not.toContain("<img");
  expect(placeholder).toContain(">O<");
  expect(placeholder).toContain('data-kind="npc"');
});

test("places use their banner", () => {
  const html = renderToStaticMarkup(
    <MediaContext.Provider value={media}>
      <Portrait id="loc:alley" name="Wet Alleys" kind="location" />
    </MediaContext.Provider>,
  );
  expect(html).toContain('src="/api/media/def"');
});

test("media settings offer web images, a ComfyUI address with a test, and say where pictures live", () => {
  const html = renderToStaticMarkup(
    <MediaSettingsPanel
      initial={{
        webImages: true,
        comfyUrl: "http://192.168.1.20:8188",
        workflowsDir: "/home/me/.wyrd/media/workflows",
      }}
    />,
  );
  expect(html).toContain("Pictures from the web");
  expect(html).toContain('value="http://192.168.1.20:8188"');
  expect(html).toContain("Test generation");
  expect(html).toContain("/home/me/.wyrd/media/workflows");
  expect(html).toContain("media-cache");
});
