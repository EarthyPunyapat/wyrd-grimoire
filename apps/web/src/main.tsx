import { setNonce } from "get-nonce";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./style.css";

const root = document.getElementById("root");
const nonce = document.querySelector<HTMLMetaElement>('meta[name="wyrd-style-nonce"]')?.content;
if (nonce) setNonce(nonce);
if (!root) throw new Error("Missing application root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
