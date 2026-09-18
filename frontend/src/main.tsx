import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import { Login } from "./pages/Login";
import { PasajeroApp } from "./pages/pasajero/PasajeroApp";
import { ConductorApp } from "./pages/conductor/ConductorApp";
import { AdminApp } from "./pages/admin/AdminApp";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/pasajero/*" element={<PasajeroApp />} />
        <Route path="/conductor/*" element={<ConductorApp />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
