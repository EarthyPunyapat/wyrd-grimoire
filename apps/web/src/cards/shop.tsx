import { useContext } from "react";
import { ChromeIcon } from "../icons.tsx";
import { ShopContext } from "../shop-context.ts";
import type { CardProps } from "./types.ts";

/** The GM's "browse the wares" card: it opens the vendor here, and says so plainly when they've gone. */
export function ShopCard({ view }: CardProps<"shop">) {
  const open = useContext(ShopContext);
  const shop = view.shop;
  return (
    <section className="gm-card shop-card">
      <div className="eyebrow">Vendor</div>
      {shop ? (
        <>
          <h3>{shop.name}</h3>
          {shop.merchant && <p className="small muted">Sold by {shop.merchant}</p>}
          {open && (
            <button type="button" onClick={open}>
              <ChromeIcon name="coins" size={16} /> Browse wares
            </button>
          )}
        </>
      ) : (
        <p className="small muted">No vendor is trading here now.</p>
      )}
    </section>
  );
}
