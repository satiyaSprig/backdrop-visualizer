import React from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ReplayVis } from "./ReplayVis";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<ReplayVis />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
