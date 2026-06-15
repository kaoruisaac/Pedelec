import { render } from "solid-js/web";
import App from "./App";
import "./style.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found.");
}

const dispose = render(() => <App />, root);

if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}
