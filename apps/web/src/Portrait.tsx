import type { GameView } from "@wyrd/core";
import { createContext, useContext, useState } from "react";

/** Picture URLs for the open campaign (First Light); empty until the media worker finds some. */
export const MediaContext = createContext<GameView["media"]>({ portraits: {}, banners: {} });

const PLACES = new Set(["location", "site", "region"]);

/**
 * An entity's picture: its portrait (people) or banner (places), or a placeholder initial on the entity's
 * tint. A picture that fails to load falls back to the placeholder.
 */
export function Portrait({
  id,
  name,
  kind,
  size = 48,
  className,
}: {
  id: string;
  name: string;
  kind: string;
  size?: number;
  className?: string;
}) {
  const media = useContext(MediaContext);
  const src = PLACES.has(kind) ? media.banners[id] : media.portraits[id];
  const [broken, setBroken] = useState(false);
  const cls = `entity-portrait${className ? ` ${className}` : ""}`;
  if (src && !broken)
    return (
      <img
        className={cls}
        src={src}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        data-kind={kind}
        onError={() => setBroken(true)}
      />
    );
  const initial = name.replace(/^the /i, "").charAt(0).toUpperCase();
  return (
    <span
      className={`${cls} placeholder`}
      data-kind={kind}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
