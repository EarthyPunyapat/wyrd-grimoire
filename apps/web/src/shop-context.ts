import { createContext } from "react";

/** Opens the vendor pop-up for the shop at the PC's location; the shop card and the composer pill use it. */
export const ShopContext = createContext<(() => void) | null>(null);
