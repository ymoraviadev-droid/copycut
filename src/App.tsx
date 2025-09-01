import { useEffect } from "react";
import "./App.css";
import Pane from "./components/Pane";
import TopMenu from "./components/menus/TopMenu";

function App() {
  useEffect(() => {
    window.addEventListener(
      "contextmenu",
      (e) => {
        if ((e as MouseEvent).altKey) return;
        e.preventDefault();
      },
      { capture: true }
    );
  })

  return (
    <main>
      <TopMenu />
      <div className="h-[96vh] bg-blue-500 flex gap-20 p-5">
        <Pane id="left" />
        <Pane id="right" />
      </div>
    </main>
  );
}

export default App;
